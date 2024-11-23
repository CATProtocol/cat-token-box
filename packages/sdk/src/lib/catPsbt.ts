import { ProtocolState } from './state'
import { ByteString, DummyProvider, FixedArray, int2ByteString, Sig, TestWallet, toByteString, UTXO } from 'scrypt-ts'
import { contractTxToWitness, getE, getPrevouts, getSigHashSchnorr, getSpentScripts, splitSighashPreimage, toSHPreimageObj } from './txTools'
import { Tap } from '@cmdcode/tapscript' // Requires node >= 19
import { Covenant } from './covenant'
import { MAX_STATE } from '../contracts/utils/txUtil'
import { getDummyUtxo, isFinalized, isTaprootInput, script2Addr, toBtcTransaction, toXOnly, uint8ArrayToHex, validteSupportedAddress, witnessStackToScriptWitness, xPubkeyToAddr } from './utils'
import { PSBTOptions, ToSignInput } from './signer'
import { Psbt, Network, Transaction } from 'bitcoinjs-lib'

import { btc, LEAF_VERSION_TAPSCRIPT } from './btc'

import {
  PsbtInput,
  checkForInput,
} from 'bip174'

import { ChangeInfo, MAX_INPUT, MAX_OUTPUT } from '../contracts/utils/txUtil'

import { PreTxStatesInfo } from '../contracts/utils/stateUtils'
import { InputContext, PrevoutsCtx } from '../contracts/utils/sigHashUtils'
import { TapLeafSmartContract } from './tapLeafSmartContract'
import { emptyOutputByteStrings } from './proof'
export interface PsbtOptsOptional {
  network?: Network;
  maximumFeeRate?: number;
}

export interface TransactionInput {
  hash: string | Uint8Array;
  index: number;
  sequence?: number;
}

type Witness = Buffer[]

type Finalizer = (
  self: CatPsbt,
  inputIndex: number, // Which input is it?
  input: PsbtInput, // The PSBT input contents
  tapLeafHashToFinalize?: Uint8Array
) => Witness;

type FinalTaprootScriptsFunc = (inputIndex: number, // Which input is it?
  input: PsbtInput, // The PSBT input contents
  tapLeafHashToFinalize?: Uint8Array) => {
      finalScriptWitness: Uint8Array | undefined;
  };

type AsyncFinalizer = (
  self: CatPsbt,
  inputIndex: number, // Which input is it?
  input: PsbtInput, // The PSBT input contents
  tapLeafHashToFinalize?: Uint8Array
) => Promise<Witness>;

export type UnlockArgsBuilder = (
  curPsbt: CatPsbt,
  tapLeafContract: TapLeafSmartContract,
) => any[]



interface PsbtInputExtended extends PsbtInput, TransactionInput {
  finalizer?: Finalizer
}

type TxStatesInfo = PreTxStatesInfo

const SCHNORR_SIG_LEN = 0x41 // a normal schnorr signature size with sigHashType is 65 bytes

export const DUST_LIMIT = 330

export type InputIndex = number;

export type SubContractCall = {
  contractAlias?: string,
  method: string,
  argsBuilder: UnlockArgsBuilder,
}

const dummySigner = TestWallet.random(new DummyProvider())
export class CatPsbt extends Psbt {

  private _txState: ProtocolState
  private sigRequests: Map<InputIndex, Omit<ToSignInput, 'index'>[]> = new Map()
  private finalizers: Map<InputIndex, AsyncFinalizer> = new Map()
  private changeOutputIndex?: number

  constructor(
    txStates = ProtocolState.getEmptyState(),
    opts: PsbtOptsOptional = {},
  ) {
    super(opts)
    this._txState = txStates
    this.addOutput(
      {
        value: BigInt(0),
        script: this._txState.stateScript,
      }
    )
  }

  updateState(): void {
    this.unsignedTx.outs[0].script = this._txState.stateScript
  }

  get txState(): ProtocolState {
    return this._txState
  }

  static create() {
    return new CatPsbt()
  }

  toTxHex(): string {
    return this.isFinalized
      ? this.extractTransaction(true).toHex()
      : this.unsignedTx.toHex()
  }

  get unsignedTx(): Transaction {
    const c = (this as any).__CACHE;
    return c.__TX
  }

  override addInput(inputData: PsbtInputExtended): this {
    super.addInput(inputData)
    this._checkInputCnt()
    if (inputData.finalizer) {
      const index = this.data.inputs.length - 1
      const input = this.data.inputs[index]
      const witness = inputData.finalizer(this, index, input)
      this._cacheInputWitness(index, witness)
      const finalizer = inputData.finalizer;
      this.setInputFinalizer(
        index,
        async (self, idx, inp) => {
          return finalizer(self, idx, inp)
        }
      )
    }
    return this
  }

  addCovenantInput<T>(
    covenant: Covenant<T>,
    subContractAlias?: string,
  ): this {
    const fromUtxo = covenant.utxo
    if (!fromUtxo) {
      throw new Error(`The covenant input '${covenant.constructor.name}' does not bind to an UTXO`)
    }

    const script = Buffer.from(fromUtxo.script, 'hex')
    const subContract = covenant.getTapLeafContract(subContractAlias)

    if (script.compare(covenant.lockingScript.toBuffer()) !== 0) {
      throw new Error('The covenant is not from the utxo')
    }

    this.addInput({
      hash: fromUtxo.txId,
      index: fromUtxo.outputIndex,
      witnessUtxo: {
        script,
        value: BigInt(fromUtxo.satoshis),
      },
      tapLeafScript: [
        {
          leafVersion: LEAF_VERSION_TAPSCRIPT,
          script: subContract.contractScript.toBuffer(),
          controlBlock: subContract.controlBlock,
        }
      ],
    })
    this._checkInputCnt()

    return this
  }

  updateCovenantInput<T>(
    inputIndex: number,
    covenant: Covenant<T>,
    subContractCall: SubContractCall
  ): this {
    const tapLeafContract = covenant.getTapLeafContract(subContractCall.contractAlias)

    const tapLeafWitness: Witness = [
      tapLeafContract.contractScript.toBuffer(),
      tapLeafContract.controlBlock,
    ]

    const args = subContractCall.argsBuilder(this, tapLeafContract)
    const contractCallWitness = tapLeafContract.contractCallToWitness(subContractCall.method, args)

    const witness: Witness = [
      ...contractCallWitness,
      ...tapLeafWitness,
    ]
    this._cacheInputWitness(inputIndex, witness)

    const asyncFinalizer: AsyncFinalizer = async (
      self: CatPsbt,
      _inputIndex: number, // Which input is it?
      _input: PsbtInput, // The PSBT input contents
      _tapLeafHashToFinalize?: Uint8Array
    ) => {
      const args = subContractCall.argsBuilder(self, tapLeafContract)
      // const finalContractCallWitness = tapLeafContract.contractCallToWitness(subContractCall.method, args)

      // TODO: go through subContract method call to ensure the correctness of the args
      const subContract = tapLeafContract.contract
      await subContract.connect(dummySigner)
      const contractTx = await subContract.methods[subContractCall.method](
        ...args,
        {
          fromUTXO: getDummyUtxo(),
          verify: false,
          // exec: false,
        }
      )
      const finalContractCallWitness = contractTxToWitness(contractTx)

      const witness = [
        ...finalContractCallWitness,
        ...tapLeafWitness,
      ]
      return witness
    }

    this.setInputFinalizer(inputIndex, asyncFinalizer)

    return this
  }

  get inputAmount(): number {
    return this.data.inputs.reduce((total, input) => total + Number(input.witnessUtxo!.value), 0)
  }

  get outputAmount(): number {
    return this.txOutputs.reduce((total, output) => total + Number(output.value), 0)
  }

  change(address: string, feeRate: number, estimatedVsize?: number): this {
    const estVSize = estimatedVsize
      || this.estimateVSize() // NOTE: this may be inaccurate due to the unknown witness size

    const changeAmount = this.inputAmount - this.outputAmount - estVSize * feeRate

    if (changeAmount < 0) {
      throw new Error('Insufficient input satoshis!')
    }

    if (changeAmount >= DUST_LIMIT) {
      this.addOutput({
        script: btc.Script.fromAddress(validteSupportedAddress(address)).toBuffer(),
        value: BigInt(changeAmount),
      })
      const index = this.txOutputs.length - 1
      this.changeOutputIndex = index
    }

    return this
  }

  addFeeInputs(feeUtxos: UTXO[]): this {
    for (const utxo of feeUtxos) {
      const script = Buffer.from(utxo.script, 'hex');
      this.addInput({
        hash: utxo.txId,
        index: utxo.outputIndex,
        witnessUtxo: {
          script: script,
          value: BigInt(utxo.satoshis),
        },
      })
      const index = this.txInputs.length - 1

      this._addSigRequest(index, {address: script2Addr(script)})
    }
    return this;
  }

  addCovenantOutput<T>(
    covenant: Covenant<T>,
    satoshis: number = 330
  ) {
    this.addOutput(
      {
        value: BigInt(satoshis),
        script: covenant.lockingScript.toBuffer(),
      }
    )
    this._checkOutputCnt()
    const index = this.txOutputs.length - 1
    this._txState.updateDataList(index - 1, covenant.serializedState())
    this.updateState()
    return this
  }

  getOutputScriptList(): FixedArray<ByteString, typeof MAX_STATE> {
    return emptyOutputByteStrings().map((emtpyStr, i) => {
        if (this.txOutputs[i + 1]) {
            return uint8ArrayToHex(this.txOutputs[i + 1].script)
        } else {
            return emtpyStr
        }
    }) as FixedArray<ByteString, typeof MAX_STATE>
}

  getOutputSatoshisList(): FixedArray<ByteString, typeof MAX_STATE> {
    return emptyOutputByteStrings().map((emtpyStr, i) => {
      if (this.txOutputs[i + 1]) {
        return int2ByteString(this.txOutputs[i + 1].value, 8n)
      } else {
        return emtpyStr
      }
    }) as FixedArray<ByteString, typeof MAX_STATE>
  }

  getTxStatesInfo(): TxStatesInfo {
    return {
      statesHashRoot: this._txState.hashRoot,
      txoStateHashes: this._txState.stateHashList,
    }
  }

  psbtOptions(autoFinalized = false): PSBTOptions | undefined {
    const toSignInputs: ToSignInput[] = []
    this.sigRequests.forEach((sigReqs, index) => {
      sigReqs.forEach((sigReq) => {
        toSignInputs.push({
          index,
          ...sigReq,
        })
      })
    })
    return toSignInputs.length === 0
      ? undefined
      : {
        autoFinalized,
        toSignInputs,
      }
  }

  setInputFinalizer(
    inputIndex: InputIndex,
    finalizer: AsyncFinalizer
  ): this {
    this.finalizers.set(inputIndex, finalizer)
    return this
  }

  override finalizeAllInputs(): this {
    checkForInput(this.data.inputs, 0) // making sure we have at least one
    this.data.inputs.forEach((_, idx) => {
      const finalizer = this.finalizers.get(idx)
      if (finalizer) {
        throw new Error(`Found async finalizer on input ${idx}, please call 'finalizeAllInputsAsync' instead!`)
      }
      this.finalizeInput(idx)
    })
    return this
  }

  calculateInputSHPreimages(tx: btc.Transaction, inputTapLeafHashes: { inputIndex: number, tapLeafHash: Buffer }[]) {

    let eList: Array<any> = []
    let eBuffList: Array<any> = []
    let sighashList: Array<{
      preimage: Buffer;
      hash: Buffer;
  }> = []

    let found = false

    // eslint-disable-next-line no-constant-condition
    while (true) {
      sighashList = inputTapLeafHashes.map((input) => {
        const sighash = getSigHashSchnorr(tx, input.tapLeafHash, input.inputIndex)
        return sighash
      })
      eList = sighashList.map((sighash) => getE(sighash.hash))
      eBuffList = eList.map((e) => e.toBuffer(32))

      if (
        eBuffList.every((eBuff) => {
          const lastByte = eBuff[eBuff.length - 1]
          return lastByte < 127
        })
      ) {
        found = true
        break
      }

      tx.nLockTime += 1
    }

    if (!found) {
      throw new Error('No valid preimage found!')
    }

    this.unsignedTx.locktime = tx.nLockTime

    return inputTapLeafHashes.map((_, index) => {
      const eBuff = eBuffList[index]
      const sighash = sighashList[index]
      const _e = eBuff.slice(0, eBuff.length - 1) // e' - e without last byte
      const lastByte = eBuff[eBuff.length - 1]
      const preimageParts = splitSighashPreimage(sighash.preimage)
      return {
        SHPreimageObj: toSHPreimageObj(preimageParts, _e, lastByte),
        sighash: sighash,
      }
    })
  }

  calculateInputCtxs(): Map<InputIndex, InputContext> {
    const tx = toBtcTransaction(this, false)

    const inputTapLeafHashes = this.data.inputs.map((input, inputIndex) => {
      if (input.tapLeafScript) {
        return {
          inputIndex,
          tapLeafHash: Buffer.from(Tap.encodeScript(input.tapLeafScript[0].script), 'hex'),
        }
      }
      return undefined
    }).filter((input) => input !== undefined)

    const preimages = this.calculateInputSHPreimages(tx, inputTapLeafHashes)

    return inputTapLeafHashes.reduce((result, { inputIndex }, index) => {
      const { SHPreimageObj, sighash } = preimages[index]
      const prevouts = getPrevouts(tx)
      const spentScriptsCtx = getSpentScripts(tx)
      const outputBuf = Buffer.alloc(4, 0)
      outputBuf.writeUInt32LE(tx.inputs[inputIndex].outputIndex)
      const prevoutsCtx: PrevoutsCtx = {
        prevouts: prevouts,
        inputIndexVal: BigInt(inputIndex),
        outputIndexVal: BigInt(tx.inputs[inputIndex].outputIndex),
        spentTxhash: Buffer.from(
          tx.inputs[inputIndex].prevTxId.toString('hex'),
          'hex'
        )
          .reverse()
          .toString('hex'),
        outputIndex: outputBuf.toString('hex'),
      }
      result.set(inputIndex, {
        shPreimage: SHPreimageObj,
        prevoutsCtx: prevoutsCtx,
        spentScriptsCtx: spentScriptsCtx,
        sighash,
      })
      return result
    }, new Map())
  }

  async finalizeAllInputsAsync(): Promise<this> {
    checkForInput(this.data.inputs, 0) // making sure we have at least one

    for (let idx = 0; idx < this.data.inputs.length; idx++) {
      const input = this.data.inputs[idx]
      let finalFunc: FinalTaprootScriptsFunc | undefined = undefined;
      const finalizer = this.finalizers.get(idx)
      if (finalizer) {
        try {
          const witness = await finalizer(this, idx, input)
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          finalFunc = (_inputIdx: number, _input: PsbtInput, _tapLeafHashToFinalize?: Uint8Array) => {
            return {
              finalScriptWitness: witnessStackToScriptWitness(witness)
            }
          }
        } catch (error) {
          console.error(`Failed to finalize input ${idx}, `, error)
          throw error
        }
      }
      this.finalizeInput(idx, finalFunc)
    }
    return this
  }

  getSig(
    inputIndex: InputIndex,
    options: Omit<ToSignInput, 'index'>,
  ): Sig {
    const input = this.data.inputs[inputIndex]
    let signature = Uint8Array.from(Buffer.alloc(SCHNORR_SIG_LEN))

    this._addSigRequest(inputIndex, options)

    if (input.tapScriptSig) {
      const tsSig = input.tapScriptSig.find((tapScriptSig) => {
        const tapleafHashMatch = !options.tapLeafHashToSign
          || Buffer.from(tapScriptSig.leafHash).toString('hex') === options.tapLeafHashToSign
        const pubKeyMatch = !options.publicKey
          || Buffer.from(tapScriptSig.pubkey).toString('hex') === toXOnly(options.publicKey, true)
          || Buffer.from(tapScriptSig.pubkey).toString('hex') === toXOnly(options.publicKey, false)
        return tapleafHashMatch && pubKeyMatch
      })
      if (tsSig) {
        signature = tsSig.signature
      }
    }

    if (input.partialSig) {
      const pSig = input.partialSig.find((partialSig) => {
        const sigAddr = xPubkeyToAddr(Buffer.from(partialSig.pubkey).toString('hex'))
        const reqAddr = options.address || (options.publicKey ? xPubkeyToAddr(options.publicKey) : undefined)
        reqAddr === undefined || sigAddr === reqAddr
      })
      if (pSig) {
        signature = pSig.signature
      }
    }

    return Sig(Buffer.from(signature).toString('hex'))
  }

  getChangeInfo(): ChangeInfo {
    if (this.changeOutputIndex !== undefined) {
      const changeOutput = this.txOutputs[this.changeOutputIndex]
      if (!changeOutput) {
        throw new Error(`Change output is not found at index ${this.changeOutputIndex}`)
      }
      return {
        script: toByteString(Buffer.from(changeOutput.script).toString('hex')),
        satoshis: int2ByteString(changeOutput.value, 8n),
      }
    } else {
      return {
        script: '',
        satoshis: int2ByteString(BigInt(0), 8n)
      }
    }
  }

  getChangeUTXO(): UTXO | null {
    if (this.changeOutputIndex !== undefined) {
      const changeOutput = this.txOutputs[this.changeOutputIndex]
      if (!changeOutput) {
        throw new Error(`Change output is not found at index ${this.changeOutputIndex}`)
      }
      return {
        script: Buffer.from(changeOutput.script).toString('hex'),
        satoshis: Number(changeOutput.value),
        txId: this.extractTransaction(false).getId(),
        outputIndex: this.changeOutputIndex
      }
    } else {
      return null;
    }
  }

  getUtxo(outputIndex: number): UTXO {
    if (!this.txOutputs[outputIndex]) {
      throw new Error(`Output at index ${outputIndex} is not found`)
    }
    return {
      txId: this.unsignedTx.getId(),
      outputIndex: outputIndex,
      script: Buffer.from(this.txOutputs[outputIndex].script).toString('hex'),
      satoshis: Number(this.txOutputs[outputIndex].value),
    }
  }

  estimateVSize(): number {
    const compensation = 1 // vsize diff compensation in bytes
    return (this.unsignedTx.virtualSize() + this._unfinalizedWitnessVsize() + compensation)
  }

  estimateFee(feeRate: number): number {
    return this.estimateVSize() * feeRate
  }

  get isFinalized(): boolean {
    return this.data.inputs.reduce((finalized, input) => { return finalized && isFinalized(input) }, true)
  }

  private _cacheInputWitness(inputIndex: InputIndex, witness: Witness) {
    // put witness into unknownKeyVals to support autoFinalize in signer
    witness.forEach((wit, widx) => {
      this.data.addUnknownKeyValToInput(
        inputIndex,
        {
          key: Buffer.from(widx.toString()),
          value: wit
        }
      )
    })
  }

  private _unfinalizedWitnessVsize(): number {
    let size = 0
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.data.inputs.forEach((input, _inputIndex) => {
      if (!isTaprootInput(input)) {
        // p2wpkh
        const P2WPKH_SIG_LEN = 0x49 // 73 bytes signature
        const P2WPKH_PUBKEY_LEN = 0x21 // 33 bytes pubkey
        size += P2WPKH_SIG_LEN + P2WPKH_PUBKEY_LEN
      } else {
        // p2tr
        if (!isFinalized(input)) {
          if ((input.unknownKeyVals || []).length > 0) {
            // use unknownKeyVals as a place to store witness before sign
            const unfinalizedWitness = (input.unknownKeyVals || []).map(v => Buffer.from(v.value))
            size += witnessStackToScriptWitness(unfinalizedWitness).length
          } else if ((input.tapLeafScript || []).length > 0) {
            const tapLeafScript = (input.tapLeafScript || [])[0]
            const unfinalizedWitness = [
              Buffer.alloc(SCHNORR_SIG_LEN),
              Buffer.from(tapLeafScript.script),
              Buffer.from(tapLeafScript.controlBlock),
            ]
            size += witnessStackToScriptWitness(unfinalizedWitness).length
          } else if ((input.tapKeySig || []).length > 0) {
            size += (input.tapKeySig || []).length
          } else {
            const unfinalizedWitness = [
              Buffer.alloc(SCHNORR_SIG_LEN),
            ]
            size += witnessStackToScriptWitness(unfinalizedWitness).length
          }
        } else {
          if (input.finalScriptSig) {
            size += input.finalScriptSig.length
          } else if (input.finalScriptWitness) {
            size += input.finalScriptWitness.length
          } else {
            throw new Error('The taproot input should be finalized with either finalScriptSig or finalScriptWitness')
          }
        }
      }
    })
    return Math.ceil(size / 4)
  }

  private _checkInputCnt() {
    const inputCnt = this.data.inputs.length
    if (inputCnt > MAX_INPUT) {
      throw new Error(`This CatPsbt has ${inputCnt} inputs which exceeds the limit of ${MAX_INPUT}`)
    }
  }

  private _checkOutputCnt() {
    const outputCnt = this.data.outputs.length
    if (outputCnt > MAX_OUTPUT) {
      throw new Error(`This CatPsbt has ${outputCnt} outputs which exceeds the limit of ${MAX_OUTPUT}`)
    }
  }

  private _addSigRequest(
    inputIndex: InputIndex,
    options: Omit<ToSignInput, 'index'>,
  ) {
    const sigRequests = this.sigRequests.get(inputIndex) || []
    sigRequests.push(options)
    this.sigRequests.set(inputIndex, sigRequests)
  }
}