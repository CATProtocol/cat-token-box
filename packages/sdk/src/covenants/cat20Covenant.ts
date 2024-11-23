import { ByteString, FixedArray, Ripemd160, fill } from "scrypt-ts";
import { CAT20, GuardInfo } from "../contracts/token/cat20";
import { CAT20Proto, CAT20State } from "../contracts/token/cat20Proto";
import { Covenant } from "../lib/covenant";
import { addrToP2trLockingScript, getTxId, pubKeyPrefix, toXOnly } from "../lib/utils";
import { Cat20GuardCovenant } from "./cat20GuardCovenant";
import { CatPsbt, SubContractCall } from "../lib/catPsbt";
import { TapLeafSmartContract } from "../lib/tapLeafSmartContract";
import { InputContext } from "../contracts/utils/sigHashUtils";
import { emptyFixedArray, emptyOutputByteStrings, getBackTraceInfo_ } from "../lib/proof";
import { ProtocolState } from "../lib/state";
import { int32, MAX_INPUT, MAX_STATE } from "../contracts/utils/txUtil";
import { Cat20Utxo, ChainProvider } from "../lib/provider";
import { Transaction } from "bitcoinjs-lib";
import { SupportedNetwork } from "../lib/constants";

interface TraceableCat20Utxo extends Cat20Utxo {
  minterAddr: string
}

export type InputTrace = {
  prevTxHex: string,
  prevTxInput: number,
  prevTxState: ProtocolState,
  prevPrevTxHex: string,
}

export type TracedCat20Token = {
  token: CAT20Covenant,
  trace: InputTrace,
}

export class CAT20Covenant extends Covenant<CAT20State> {

  // locked CAT20 artifact md5
  static readonly LOCKED_ASM_VERSION = '36eb7d5819c558e74512693c33a8f309'

  constructor(
    readonly minterAddr: string,
    state?: CAT20State,
    network?: SupportedNetwork,
  ) {
    super(
      [{
        contract: new CAT20(
          addrToP2trLockingScript(minterAddr),
          new Cat20GuardCovenant().lockingScriptHex,
        )
      }],
      {
        lockedAsmVersion: CAT20Covenant.LOCKED_ASM_VERSION,
        network,
      },
    )
    this.state = state
  }

  static createTransferGuard(
    inputInfos: {
      token: CAT20Covenant,
      inputIndex: number,
    }[],
    receivers: {
      address: Ripemd160,
      amount: int32,
      outputIndex: number,
    }[],
    changeInfo?: {
      address: Ripemd160,
    }
  ): {
    guard: Cat20GuardCovenant,
    outputTokens: FixedArray<(CAT20Covenant | undefined), typeof MAX_STATE>,
    changeTokenOutputIndex: number
  } {
    if (inputInfos.length === 0) {
      throw new Error('No spent tokens')
    }

    if (inputInfos.length > MAX_INPUT - 1) {
      throw new Error(`Too many token inputs that exceed the maximum limit of ${MAX_INPUT}`)
    }

    const totalTokenInputAmount = inputInfos.reduce((acc, info) => {
      if (!info.token.state) {
        throw new Error('Token state is missing')
      }
      return acc + info.token.state.amount
    }, 0n)

    const totalTokenOutputAmount = receivers.reduce((acc, receiver) => acc + receiver.amount, 0n)

    if (totalTokenInputAmount < totalTokenOutputAmount) {
      throw new Error('Insufficient token input amount')
    }

    if (totalTokenInputAmount > totalTokenOutputAmount && !changeInfo) {
      throw new Error('Unbalanced token output amount, change address is missing')
    }

    const changeTokenAmount = totalTokenInputAmount - totalTokenOutputAmount
    let changeTokenOutputIndex = -1
    if (changeTokenAmount > 0) {
      changeTokenOutputIndex = receivers.length + 1
    }

    const minterAddr = inputInfos[0].token.minterAddr

    const guard = new Cat20GuardCovenant(
      {
        tokenScript: inputInfos[0].token.lockingScriptHex,
        inputTokenAmountArray: emptyFixedArray().map((_, i) => {
          const input = inputInfos.find(info => info.inputIndex === i)
          if (input) {
            if (!input.token.state) {
              throw new Error(`Token state is missing for token input ${i}`)
            }
            return input.token.state.amount
          } else {
            return 0n
          }
        }) as FixedArray<int32, typeof MAX_INPUT>
      }
    )

    const outputTokens = emptyOutputByteStrings().map((_, index) => {
      const receiver = receivers.find(r => r.outputIndex === index + 1)
      if (receiver) {
        if (receiver.amount <= 0) {
          throw new Error(`Invalid token amount ${receiver.amount} for output ${index + 1}`)
        }
        return new CAT20Covenant(
          minterAddr,
          CAT20Proto.create(
            receiver.amount,
            receiver.address,
          )
        )

      } else if (changeTokenAmount > 0 && index + 1 === changeTokenOutputIndex) {
        return new CAT20Covenant(
          minterAddr,
          CAT20Proto.create(
            changeTokenAmount,
            changeInfo.address,
          )
        )
      } else {
        return undefined
      }
    }) as FixedArray<(CAT20Covenant | undefined), typeof MAX_STATE>

    return {
      guard,
      outputTokens,
      changeTokenOutputIndex,
    }
  }

  static createBurnGuard(
    inputInfos: {
        token: CAT20Covenant
        inputIndex: number
    }[]
): {
    guard: Cat20GuardCovenant
    outputTokens: FixedArray<CAT20Covenant | undefined, typeof MAX_STATE>
    changeOutputIndex?: number
} {
    if (inputInfos.length === 0) {
        throw new Error('No spent tokens')
    }
    if (inputInfos.length > MAX_INPUT - 1) {
        throw new Error(
            `Too many token inputs that exceed the maximum limit of ${MAX_INPUT}`
        )
    }
    const guard = new Cat20GuardCovenant({
        tokenScript: inputInfos[0].token.lockingScriptHex,
        inputTokenAmountArray: emptyFixedArray().map((_, i) => {
            const input = inputInfos.find((info) => info.inputIndex === i)
            if (input) {
                if (!input.token.state) {
                    throw new Error(
                        `Token state is missing for token input ${i}`
                    )
                }
                return input.token.state.amount
            } else {
                return 0n
            }
        }) as FixedArray<int32, typeof MAX_INPUT>,
    })

    const outputTokens = fill(undefined, MAX_STATE)
    return {
        guard,
        outputTokens,
    }
}


  static async backtrace(
    cat20Utxos: TraceableCat20Utxo[],
    chainProvider: ChainProvider,
  ): Promise<TracedCat20Token[]> {

    const result: TracedCat20Token[] = []

    const txCache = new Map<string, string>()
    const getRawTx = async (txId: string) => {
      let rawTxHex = txCache.get(txId)
      if (!rawTxHex) {
        rawTxHex = await chainProvider.getRawTransaction(txId)
        txCache.set(txId, rawTxHex)
      }
      return rawTxHex
    }

    for (const cat20Utxo of cat20Utxos) {

      const token = new CAT20Covenant(
        cat20Utxo.minterAddr,
        cat20Utxo.state
      ).bindToUtxo(cat20Utxo.utxo)

      if (cat20Utxo.utxo.script !== token.lockingScriptHex) {
        throw new Error(`Token utxo ${JSON.stringify(cat20Utxo)} does not match the token minter address ${cat20Utxo.minterAddr}`)
      }

      const tokenTxId = cat20Utxo.utxo.txId

      const tokenTxHex = await getRawTx(tokenTxId)
      const tokenTx = Transaction.fromHex(tokenTxHex)

      let tokenPrevTxHex = undefined
      let tokenTxInputIndex = undefined
      for (let idx = 0; idx < tokenTx.ins.length; idx++) {
        const input = tokenTx.ins[idx]
        const prevTxId = getTxId(input);
        const prevTxHex = await getRawTx(prevTxId)
        const prevTx = Transaction.fromHex(prevTxHex)
        const prevTokenTxo = prevTx.outs.find(out => {
          const outScript = Buffer.from(out.script).toString('hex')
          return outScript === cat20Utxo.utxo.script
            || outScript === token.minterScriptHex
        })
        if (prevTokenTxo) {
          tokenPrevTxHex = prevTxHex
          tokenTxInputIndex = idx
          break
        }
      }

      if (!tokenPrevTxHex || tokenTxInputIndex === undefined) {
        throw new Error(`Token utxo ${JSON.stringify(cat20Utxo)} can not be backtraced`)
      }

      result.push({
        token,
        trace: {
          prevTxHex: tokenTxHex,
          prevTxState: ProtocolState.fromStateHashList(cat20Utxo.txoStateHashes),
          prevTxInput: tokenTxInputIndex,
          prevPrevTxHex: tokenPrevTxHex,
        },
      })
    }

    return result
  }

  serializedState(): ByteString {
    return CAT20Proto.toByteString(this.state)
  }

  userSpend(
    inputIndex: number,
    inputCtxs: Map<number, InputContext>,
    inputTokenTrace: InputTrace,
    guardInfo: GuardInfo,
    isP2TR: boolean,
    pubKey: ByteString,
  ): SubContractCall {
    return {
      method: 'unlock',
      argsBuilder: this.unlockArgsBuilder(
        inputIndex,
        inputCtxs,
        inputTokenTrace,
        guardInfo,
        {
          isP2TR,
          pubKey,
        }
      )
    }
  }

  contractSpend(
    inputIndex: number,
    inputCtxs: Map<number, InputContext>,
    inputTokenTrace: InputTrace,
    guardInfo: GuardInfo,
    contractInputIndex: number
  ): SubContractCall {
    return {
      method: 'unlock',
      argsBuilder: this.unlockArgsBuilder(
        inputIndex,
        inputCtxs,
        inputTokenTrace,
        guardInfo,
        undefined,
        {
          contractInputIndex,
        }
      )
    }
  }

  get minterScriptHex(): string {
    return addrToP2trLockingScript(this.minterAddr)
  }

  private unlockArgsBuilder(
    inputIndex: number,
    inputCtxs: Map<number, InputContext>,
    inputTokenTrace: InputTrace,
    guardInfo: GuardInfo,
    userSpend?: {
      isP2TR: boolean,
      pubKey: ByteString,
    },
    contractSpend?: {
      contractInputIndex: number
    }
  ) {
    const inputCtx = inputCtxs.get(inputIndex)
    if (!inputCtx) {
      throw new Error('Input context is not available')
    }

    const preTxStatesInfo = {
      statesHashRoot: inputTokenTrace.prevTxState.hashRoot,
      txoStateHashes: inputTokenTrace.prevTxState.stateHashList,
    }
    // console.log('preTxStatesInfo', preTxStatesInfo)

    const preState = this.state
    if (!preState) {
      throw new Error('Token state is not available')
    }

    const backTraceInfo = getBackTraceInfo_(
      inputTokenTrace.prevTxHex,
      inputTokenTrace.prevPrevTxHex,
      inputTokenTrace.prevTxInput,
    )

    if (userSpend && contractSpend) {
      throw new Error('Only one of userSpent or contractSpent should be provided')
    }

    if (!userSpend && !contractSpend) {
      throw new Error('Either userSpent or contractSpent should be provided')
    }

    return (
      curPsbt: CatPsbt,
      tapLeafContract: TapLeafSmartContract,
    ) => {
      const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx

      const args = []
      args.push(
        userSpend
          ? {
            isUserSpend: true,
            userPubKeyPrefix: userSpend.isP2TR ? '' : pubKeyPrefix(userSpend.pubKey),
            userPubKey: toXOnly(userSpend.pubKey, userSpend.isP2TR),
            userSig: curPsbt.getSig(inputIndex, { publicKey: userSpend.pubKey, disableTweakSigner: userSpend.isP2TR ? false : true }),
            contractInputIndex: -1,
          }
          : {
            isUserSpend: false,
            userPubKeyPrefix: '',
            userPubKey: '',
            userSig: '',
            contractInputIndex: contractSpend?.contractInputIndex,
          }
      ) // tokenUnlockArgs
      args.push(preState) // preState
      args.push(preTxStatesInfo) // preTxStatesInfo
      args.push(guardInfo) // guardInfo
      args.push(backTraceInfo) // backtraceInfo
      args.push(shPreimage) // shPreimage
      args.push(prevoutsCtx) // prevoutsCtx
      args.push(spentScriptsCtx) // spentScriptsCtx
      return args
    }
  }

}