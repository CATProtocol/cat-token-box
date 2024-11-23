import { ByteString, int2ByteString } from 'scrypt-ts'
import { NftBurnGuard } from '../contracts/nft/nftBurnGuard'
import {
    NftGuardConstState,
    NftGuardProto,
} from '../contracts/nft/nftGuardProto'
import { NftTransferGuard } from '../contracts/nft/nftTransferGuard'
import { Covenant } from '../lib/covenant'
import { MAX_TOKEN_OUTPUT } from '../contracts/utils/txUtil'
import { CatPsbt, SubContractCall } from '../lib/catPsbt'
import { TapLeafSmartContract } from '../lib/tapLeafSmartContract'
import { InputContext } from '../contracts/utils/sigHashUtils'
import { getTxHeaderCheck } from '../lib/proof'
import { Postage, SupportedNetwork } from '../lib/constants'
import { btc } from '../lib/btc'
import { CAT721Covenant } from './cat721Covenant'
import { GuardType } from './cat20GuardCovenant'
import { NftGuardInfo } from '../contracts/nft/cat721'

export class CAT721GuardCovenant extends Covenant<NftGuardConstState> {
    // locked artifacts md5
    static readonly LOCKED_ASM_VERSION = Covenant.calculateAsmVersion([
        // NftBurnGuard md5
        'bdcfe0b013ecd9ec68098b8060234af4',
        // NftTransferGuard md5
        '477458c3bb4a3b586664dddf525e5060',
    ])

    constructor(state?: NftGuardConstState, network?: SupportedNetwork) {
        super(
            [
                {
                    alias: GuardType.Burn,
                    contract: new NftBurnGuard(),
                },
                {
                    alias: GuardType.Transfer,
                    contract: new NftTransferGuard(),
                },
            ],
            {
                lockedAsmVersion: CAT721GuardCovenant.LOCKED_ASM_VERSION,
                network,
            }
        )

        this.state = state
    }

    serializedState(): ByteString {
        return NftGuardProto.toByteString(this.state)
    }

    transfer(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        nftOutputs: (CAT721Covenant | undefined)[],
        guardTxHex: string,
        guardTxOutputIndex?: number,
        nftSatoshis?: ByteString
    ): SubContractCall {
        const inputCtx = inputCtxs.get(inputIndex)
        if (!inputCtx) {
            throw new Error('Input context is not available')
        }

        const preState = this.state
        if (!preState) {
            throw new Error('Nft state is not available')
        }

        if (nftOutputs.length !== MAX_TOKEN_OUTPUT) {
            throw new Error(
                `Invalid nft owner output length: ${nftOutputs.length}, should be ${MAX_TOKEN_OUTPUT}`
            )
        }

        const nftOwners = nftOutputs.map((output) => output?.state!.ownerAddr)
        const localIdList = nftOutputs.map(
            (output) => output?.state!.localId || 0n
        )
        const nftOutputMaskList = nftOutputs.map((output) => !!output)
        nftSatoshis =
            nftSatoshis || int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)

        const guardInfo = this.getGuardInfo(
            inputIndex,
            guardTxHex,
            guardTxOutputIndex
        )

        return {
            contractAlias: GuardType.Transfer,
            method: 'transfer',
            argsBuilder: (
                curPsbt: CatPsbt,
                tapLeafContract: TapLeafSmartContract
            ) => {
                const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx

                const args = []
                args.push(curPsbt.txState.stateHashList) // curTxoStateHashes
                args.push(
                    nftOwners.map((ownerAddr, oidx) => {
                        const output = curPsbt.txOutputs[oidx + 1]
                        return (
                            ownerAddr ||
                            (output
                                ? Buffer.from(output.script).toString('hex')
                                : '')
                        )
                    })
                ) // ownerAddrOrScriptList
                args.push(localIdList) // localIdList
                args.push(nftOutputMaskList) // nftOutputMaskList
                args.push(curPsbt.getOutputSatoshisList()) // outputSatoshisList
                args.push(nftSatoshis) // nftSatoshis
                args.push(preState) // preState
                args.push(guardInfo.tx) // preTx
                args.push(shPreimage) // shPreimage
                args.push(prevoutsCtx) // prevoutsCtx
                args.push(spentScriptsCtx) // spentScriptsCtx
                return args
            },
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
            throw new Error('Nft state is not available')
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
        guardTxOutputIndex?: number
    ): NftGuardInfo {
        guardTxOutputIndex ||= 1
        const { tx } = getTxHeaderCheck(
            new btc.Transaction(guardTxHex),
            guardTxOutputIndex
        )
        return {
            tx,
            inputIndexVal: BigInt(inputIndex),
            outputIndex: int2ByteString(BigInt(guardTxOutputIndex), 4n),
            guardState: this.state,
        }
    }
}
