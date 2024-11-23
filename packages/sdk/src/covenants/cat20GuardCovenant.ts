import { ByteString, int2ByteString } from "scrypt-ts";
import { BurnGuard } from "../contracts/token/burnGuard";
import { GuardConstState, GuardProto } from "../contracts/token/guardProto";
import { TransferGuard } from "../contracts/token/transferGuard";
import { Covenant } from "../lib/covenant";
import { MAX_TOKEN_OUTPUT } from "../contracts/utils/txUtil";
import { CatPsbt, SubContractCall } from "../lib/catPsbt";
import { TapLeafSmartContract } from "../lib/tapLeafSmartContract";
import { InputContext } from "../contracts/utils/sigHashUtils";
import { getTxHeaderCheck } from "../lib/proof";
import { Postage, SupportedNetwork } from "../lib/constants";
import { btc } from "../lib/btc";
import { GuardInfo } from "../contracts/token/cat20";
import { CAT20Covenant } from "./cat20Covenant";

export enum GuardType {
  Burn = 'burn',
  Transfer = 'transfer',
}

export class Cat20GuardCovenant extends Covenant<GuardConstState> {

  // locked artifacts md5
  static readonly LOCKED_ASM_VERSION =
    Covenant.calculateAsmVersion([
      // BurnGuard md5
      'bdcfe0b013ecd9ec68098b8060234af4',
      // TransferGuard md5
      '7fc09a52492f2bd4d5f30c4f5116c0f8',
    ])

  constructor(
    state?: GuardConstState,
    network?: SupportedNetwork,
  ) {
    super(
      [
        {
          alias: GuardType.Burn,
          contract: new BurnGuard()
        },
        {
          alias: GuardType.Transfer,
          contract: new TransferGuard()
        }
      ],
      {
        lockedAsmVersion: Cat20GuardCovenant.LOCKED_ASM_VERSION,
        network,
      }
    )

    this.state = state
  }

  serializedState(): ByteString {
    return GuardProto.toByteString(this.state)
  }

  transfer(
    inputIndex: number,
    inputCtxs: Map<number, InputContext>,
    tokenOutputs:(CAT20Covenant | undefined) [],
    guardTxHex: string,
    guardTxOutputIndex?: number,
    tokenSatoshis?: ByteString,
  ): SubContractCall {
    const inputCtx = inputCtxs.get(inputIndex)
    if (!inputCtx) {
      throw new Error('Input context is not available')
    }

    const preState = this.state
    if (!preState) {
      throw new Error('Token state is not available')
    }

    if (tokenOutputs.length !== MAX_TOKEN_OUTPUT) {
      throw new Error(`Invalid token owner output length: ${tokenOutputs.length}, should be ${MAX_TOKEN_OUTPUT}`)
    }

    const tokenOwners = tokenOutputs.map((output) => output?.state!.ownerAddr)
    const tokenAmounts = tokenOutputs.map((output) => output?.state!.amount)
    const tokenMasks = tokenOutputs.map((output) => !!output)

    tokenSatoshis = tokenSatoshis || int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)

    const guardInfo = this.getGuardInfo(inputIndex, guardTxHex, guardTxOutputIndex)

    return {
      contractAlias: GuardType.Transfer,
      method: 'transfer',
      argsBuilder: (
        curPsbt: CatPsbt,
        tapLeafContract: TapLeafSmartContract,
      ) => {
        const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx

        const args = []
        args.push(curPsbt.txState.stateHashList) // curTxoStateHashes
        args.push(tokenOwners.map((ownerAddr, oidx) => {
          const output = curPsbt.txOutputs[oidx + 1]
          return ownerAddr || (output ? Buffer.from(output.script).toString('hex') : '')
        })) // ownerAddrOrScriptList
        args.push(tokenAmounts.map((amt, oidx) => {
          const output = curPsbt.txOutputs[oidx + 1]
          return amt || output?.value || 0
        })) // tokenAmountList
        args.push(tokenMasks) // tokenOutputMaskList
        args.push(curPsbt.getOutputSatoshisList()) // outputSatoshisList
        args.push(tokenSatoshis) // tokenSatoshis
        args.push(preState) // preState
        args.push(guardInfo.tx) // preTx
        args.push(shPreimage) // shPreimage
        args.push(prevoutsCtx) // prevoutsCtx
        args.push(spentScriptsCtx) // spentScriptsCtx
        return args
      }
    }
  }

  burn(
    inputIndex: number,
    inputCtxs: Map<number, InputContext>,
    guardTxHex: string,
    guardTxOutputIndex?: number
): SubContractCall {
    const inputCtx = inputCtxs.get(inputIndex)
    if (!inputCtx) {
        throw new Error('Input context is not available')
    }

    const preState = this.state
    if (!preState) {
        throw new Error('Token state is not available')
    }

    const guardInfo = this.getGuardInfo(
        inputIndex,
        guardTxHex,
        guardTxOutputIndex
    )

    return {
        contractAlias: GuardType.Burn,
        method: 'burn',
        argsBuilder: (
            curPsbt: CatPsbt,
            tapLeafContract: TapLeafSmartContract
        ) => {
            const { shPreimage, prevoutsCtx } = inputCtx
            const args = []
            args.push(curPsbt.txState.stateHashList) // curTxoStateHashes
            args.push(curPsbt.getOutputScriptList()) // outputScriptList
            args.push(curPsbt.getOutputSatoshisList()) // outputSatoshisList
            args.push(preState) // preState
            args.push(guardInfo.tx) // preTx
            args.push(shPreimage) // shPreimage
            args.push(prevoutsCtx) // prevoutsCtx
            return args
        },
    }
}

  getGuardInfo(
    inputIndex: number,
    guardTxHex: string,
    guardTxOutputIndex?: number,
  ): GuardInfo {
    guardTxOutputIndex ||= 1
    const { tx } = getTxHeaderCheck(new btc.Transaction(guardTxHex), guardTxOutputIndex)
    return {
      tx,
      inputIndexVal: BigInt(inputIndex),
      outputIndex: int2ByteString(BigInt(guardTxOutputIndex), 4n),
      guardState: this.state
    }
  }


}