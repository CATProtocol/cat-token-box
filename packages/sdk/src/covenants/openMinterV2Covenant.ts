import { ByteString, FixedArray, int2ByteString, Ripemd160, UTXO } from "scrypt-ts";
import { Covenant } from "../lib/covenant";
import { OpenMinterCat20Meta, scaleUpAmounts } from "../lib/metadata";
import { isP2TR, outpoint2ByteString, pubKeyPrefix, scriptToP2tr, toPsbt, toTokenAddress, toXOnly } from "../lib/utils";
import { OpenMinterV2Proto, OpenMinterV2State } from "../contracts/token/openMinterV2Proto";
import { OpenMinterV2 } from "../contracts/token/openMinterV2";
import { btc, LEAF_VERSION_TAPSCRIPT } from "../lib/btc";
import { Postage, SupportedNetwork } from "../lib/constants";
import { getCatCommitScript } from "../lib/commit";
import { CAT20Covenant } from "./cat20Covenant";
import { CatPsbt } from "../lib/catPsbt";

import { Psbt, Transaction } from "bitcoinjs-lib";
import { CAT20Proto } from "../contracts/token/cat20Proto";
import { ProtocolState } from "../lib/state";
import { getBackTraceInfo_ } from "../lib/proof";
import { int32 } from "../contracts/utils/txUtil";
import { MAX_NEXT_MINTERS } from "../contracts/token/openMinter";

export class OpenMinterV2Covenant extends Covenant<OpenMinterV2State> {

  // locked OpenMinterV2 artifact md5
  static readonly LOCKED_ASM_VERSION = 'a6c2e92d74a23c07bb6220b676c6cb9b'

  readonly tokenScript: ByteString

  constructor(
    readonly tokenId: string,
    metadata: OpenMinterCat20Meta,
    state?: OpenMinterV2State,
    network?: SupportedNetwork,
  ) {
    const scaledTokenInfo = scaleUpAmounts(metadata)
    const maxCount = scaledTokenInfo.max / scaledTokenInfo.limit;
    const premineCount = scaledTokenInfo.premine / scaledTokenInfo.limit;
    if (premineCount > 0 && !metadata.preminerAddr) {
      throw new Error('Preminer public key is required for premining')
    }
    const contract = new OpenMinterV2(
      outpoint2ByteString(tokenId),
      maxCount,
      scaledTokenInfo.premine,
      premineCount,
      scaledTokenInfo.limit,
      metadata.preminerAddr || '',
    )
    super(
      [{ contract }],
      {
        lockedAsmVersion: OpenMinterV2Covenant.LOCKED_ASM_VERSION,
        network,
      }
    )
    this.state = state
    this.tokenScript = new CAT20Covenant(this.address).lockingScriptHex
  }

  serializedState(): ByteString {
    return this.state ? OpenMinterV2Proto.toByteString(this.state) : ''
  }

  static buildCommitTx(
    info: OpenMinterCat20Meta,
    address: string,
    pubkey: string,
    feeUtxos: UTXO[],
    totalOutputsAmount: number,
    changeAddress: string,
    feeRate: number,
  ): Psbt {
    const commitScript = getCatCommitScript(toXOnly(pubkey, isP2TR(address)), info);
    const { p2trLockingScript } = scriptToP2tr(Buffer.from(commitScript, 'hex'));
    const changeAddr = btc.Address.fromString(changeAddress)
    const changeScript = btc.Script.fromAddress(changeAddr);

    const commitTx = new btc.Transaction()
      .from(feeUtxos)
      .addOutput(
        /** the first utxo spent in reveal tx */
        new btc.Transaction.Output({
          satoshis: Postage.METADATA_POSTAGE,
          script: p2trLockingScript,
        }),
      )
      .addOutput(
        /** the second utxo spent in reveal tx */
        new btc.Transaction.Output({
          satoshis: totalOutputsAmount > Postage.METADATA_POSTAGE ? Math.max(546, totalOutputsAmount - Postage.METADATA_POSTAGE) : 0,
          script: changeScript,
        }),
      )
      .feePerByte(feeRate)
      .change(changeAddr);

    if (commitTx.getChangeOutput() === null) {
      throw new Error('Insufficient satoshi balance!');
    }

    commitTx.getChangeOutput().satoshis  -= 1;


    const commitTxPsbt = toPsbt(commitTx)
    feeUtxos.forEach((utxo, index) => {
      commitTxPsbt.updateInput(index, {
        witnessUtxo: {
          script: Buffer.from(utxo.script, 'hex'),
          value: BigInt(utxo.satoshis),
        }
      })
    })

    return commitTxPsbt
  }

  static buildRevealTx(
    commitUtxo: UTXO,
    metadata: OpenMinterCat20Meta,
    address: string,
    pubkey: string,
    feeUtxos: UTXO[],
  ): {
    tokenId: string,
    minterAddr: string,
    tokenAddr: string,
    revealPsbt: CatPsbt,
  } {

    const scaledTokenInfo = scaleUpAmounts(metadata)
    const maxCount = scaledTokenInfo.max / scaledTokenInfo.limit;
    const premineCount = scaledTokenInfo.premine / scaledTokenInfo.limit;
    const remainingSupplyCount = maxCount - premineCount;

    if (!metadata.preminerAddr && premineCount > 0) {
      metadata.preminerAddr = toTokenAddress(address);
    }

    const minter = new OpenMinterV2Covenant(
      `${commitUtxo.txId}_0`,
      metadata,
    )

    const token = new CAT20Covenant(minter.address)

    minter.state = {
      tokenScript: token.lockingScriptHex,
      isPremined: false,
      remainingSupplyCount
    }

    const commitScript = getCatCommitScript(toXOnly(pubkey, isP2TR(address)), metadata);
    const commitLockingScript = Buffer.from(commitScript, 'hex');
    const { cblock } = scriptToP2tr(commitLockingScript);

    const revealTx = CatPsbt.create()
      .addCovenantOutput(
        minter,
        Postage.MINTER_POSTAGE,
      )
      .addInput({
        hash: commitUtxo.txId,
        index: 0,
        witnessUtxo: {
          script: Buffer.from(commitUtxo.script, 'hex'),
          value: BigInt(commitUtxo.satoshis),
        },
        // tapInternalKey: Buffer.from(TAPROOT_ONLY_SCRIPT_SPENT_KEY, 'hex'),
        tapLeafScript: [{
          leafVersion: LEAF_VERSION_TAPSCRIPT,
          script: commitLockingScript,
          controlBlock: Buffer.from(cblock, 'hex'),
        }],
        finalizer: (self, inputIdx) => {
          const witness = [
            ...self.txState.stateHashList.map((hash) => Buffer.from(hash, 'hex')),
            Buffer.from(self.getSig(inputIdx, { publicKey: pubkey,  disableTweakSigner: isP2TR(address) ? false : true }), 'hex'),
            commitLockingScript,
            Buffer.from(cblock, 'hex'),
          ];
          return witness
        }
      })
      .addFeeInputs(feeUtxos)
    // NOTE: can not have a fee change output here due to the protocol

    return {
      tokenId: `${commitUtxo.txId}_0`,
      minterAddr: minter.address,
      tokenAddr: token.address,
      revealPsbt: revealTx,
    }

  }

  static buildMintTx(
    spentMinterPreTxHex: string,
    spentMinterTxHex: string,
    spentMinterTxState: ProtocolState,
    spentMinter: OpenMinterV2Covenant,
    tokenReceiver: Ripemd160,
    feeUtxos: UTXO[],
    feeRate: number,
    changeAddress: string,
    estimatedVSize?: number,
    preminterAddress?: string,
    preminerPubKey?: string,
  ) {

    if (!spentMinter.state) {
      throw new Error('Minter state is not available')
    }

    const isPremining = !spentMinter.state.isPremined
      && (spentMinter.getSubContract() as OpenMinterV2).premine > 0

    if (isPremining && !preminerPubKey) {
      throw new Error('Preminer info is required for premining')
    }

    const mintTx = new CatPsbt(
      // ProtocolState.getEmptyState(),
      // { maximumFeeRate: feeRate },
    )

    const { nextMinters, splitAmountList } = spentMinter.createNextMinters();

    // add next minters outputs
    for (const nextMinter of nextMinters) {
      mintTx.addCovenantOutput(
        nextMinter,
        Postage.MINTER_POSTAGE,
      )
    }

    const token = spentMinter.createToken(tokenReceiver);

    mintTx
      // add token output
      .addCovenantOutput(
        token,
        Postage.TOKEN_POSTAGE,
      )
      // add minter input
      .addCovenantInput(
        spentMinter,
      )
      // add fees
      .addFeeInputs(feeUtxos)
      // add change output
      .change(changeAddress, feeRate, estimatedVSize)


    const inputCtxs = mintTx.calculateInputCtxs()

    const minterInputIndex = 0

    const tokenState = token.state!
    const preState = spentMinter.state!
    // console.log('preState', preState)

    const preTxStatesInfo ={
      statesHashRoot: spentMinterTxState.hashRoot,
      txoStateHashes: spentMinterTxState.stateHashList,
    }
    // console.log('preTxStatesInfo', preTxStatesInfo)

    const backTraceInfo = getBackTraceInfo_(
      spentMinterTxHex,
      spentMinterPreTxHex,
      minterInputIndex,
    )


    mintTx.updateCovenantInput(
      minterInputIndex,
      spentMinter,
      {
        method: 'mint',
        argsBuilder: (curPsbt) => {

          const inputCtx = inputCtxs.get(minterInputIndex)
          if (!inputCtx) {
            throw new Error('Input context is not available')
          }

          const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx

          const args = []
          args.push(curPsbt.txState.stateHashList) // curTxoStateHashes
          args.push(tokenState) // tokenMint
          args.push(splitAmountList) // nextMinterCounts
          args.push(isPremining ? (isP2TR(preminterAddress) ? '' : pubKeyPrefix(preminerPubKey)) : '') // preminerPubKeyPrefix
          args.push(isPremining ? toXOnly(preminerPubKey, isP2TR(preminterAddress)) : '') // preminerPubKey
          args.push(() => {
            return isPremining
              ? curPsbt.getSig(minterInputIndex, { publicKey: preminerPubKey })
              : '' //Sig(toByteString(''))
          }) // preminerSig
          args.push(int2ByteString(BigInt(Postage.MINTER_POSTAGE), 8n)) // minterSatoshis
          args.push(int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)) // tokenSatoshis
          args.push(preState) // preState
          args.push(preTxStatesInfo) // preTxStatesInfo
          args.push(backTraceInfo) // backtraceInfo
          args.push(shPreimage) // shPreimage
          args.push(prevoutsCtx) // prevoutsCtx
          args.push(spentScriptsCtx) // spentScriptsCtx
          args.push(curPsbt.getChangeInfo()) // changeInfo

          return args
        }
      }
    )

    return mintTx
  }

  static fromMintTx(
    tokenId: string,
    info: OpenMinterCat20Meta,
    txHex: string,
    outputIndex?: number,
  ): OpenMinterV2Covenant {
    const tx = Transaction.fromHex(txHex)

    const minterOutputIndex = outputIndex || 1
    const minterOutput = tx.outs[minterOutputIndex]
    if (!minterOutput) {
      throw new Error(`Output[${minterOutputIndex}] not found in transaction`)
    }

    const minter = new OpenMinterV2Covenant(
      tokenId,
      info,
    ).bindToUtxo({
      txId: tx.getId(),
      outputIndex: minterOutputIndex,
      satoshis: Postage.MINTER_POSTAGE,
    })

    if (Buffer.from(minterOutput.script).toString('hex') !== minter.lockingScriptHex) {
      throw new Error(`Invalid minter script in outputs[${outputIndex}]`)
    }

    const minterInputIndex = 0
    const minterInput = tx.ins[minterInputIndex]

    try {
      const minterCounts = minter.getSubContractCallArg(
        minterInput.witness.map(w => Buffer.from(w)),
        'mint',
        'nextMinterCounts',
      ) as FixedArray<int32, typeof MAX_NEXT_MINTERS>

      minter.state = OpenMinterV2Proto.create(
        minter.tokenScript,
        true,
        minterCounts[minterOutputIndex - 1],
      )

    } catch (error) {
      throw new Error(`Input[${minterInputIndex}] is not a valid minter input, or the transaction is not a mint transaction`)
    }

    return minter
  }

  private createNextMinters(): {
    nextMinters: OpenMinterV2Covenant[],
    splitAmountList: FixedArray<int32, 2>,
  } {
    const contract = this.getSubContract() as OpenMinterV2
    const splitAmountList = OpenMinterV2Proto.getSplitAmountList(
      this.state!.remainingSupplyCount,
      this.state!.isPremined,
      contract.premine,
    );

    const nextMinters = splitAmountList.map((amount) => {
      if (amount > 0n) {
        const newState = OpenMinterV2Proto.create(this.tokenScript, true, amount)
        return this.next(newState)
      }
      return undefined
    }).filter((minter) => minter !== undefined) as OpenMinterV2Covenant[]

    return {
      nextMinters,
      splitAmountList,
    }
  }

  private createToken(toAddr: Ripemd160): CAT20Covenant {
    const contract = this.getSubContract() as OpenMinterV2
    let amount = contract.limit
    let receiverAddr = toAddr
    if (!this.state.isPremined && contract.premine > 0n) {
      amount = contract.premine
      receiverAddr = contract.premineAddr as Ripemd160
    }
    return new CAT20Covenant(
      this.address,
      CAT20Proto.create(
        amount,
        receiverAddr,
      )
    )
  }

}


