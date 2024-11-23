import { ByteString, FixedArray, Ripemd160, fill } from 'scrypt-ts'
import { CAT721, NftGuardInfo } from '../contracts/nft/cat721'
import { CAT721Proto, CAT721State } from '../contracts/nft/cat721Proto'
import { Covenant } from '../lib/covenant'
import { addrToP2trLockingScript, pubKeyPrefix, toXOnly } from '../lib/utils'
import { CAT721GuardCovenant } from './cat721GuardCovenant'
import { CatPsbt, SubContractCall } from '../lib/catPsbt'
import { TapLeafSmartContract } from '../lib/tapLeafSmartContract'
import { InputContext } from '../contracts/utils/sigHashUtils'
import {
    emptyFixedArray,
    emptyOutputByteStrings,
    getBackTraceInfo_,
} from '../lib/proof'
import { ProtocolState } from '../lib/state'
import { int32, MAX_INPUT, MAX_STATE } from '../contracts/utils/txUtil'
import { Cat721Utxo, ChainProvider } from '../lib/provider'
import { Transaction } from 'bitcoinjs-lib'
import { SupportedNetwork } from '../lib/constants'
import { InputTrace } from './cat20Covenant'

interface TraceableCat721Utxo extends Cat721Utxo {
    minterAddr: string
}

export type TracedCat721Nft = {
    nft: CAT721Covenant
    trace: InputTrace
}

export class CAT721Covenant extends Covenant<CAT721State> {
    // locked CAT721 artifact md5
    static readonly LOCKED_ASM_VERSION = '0176b77f091a0f5bb4ef9f4ee455302f'

    constructor(
        readonly minterAddr: string,
        state?: CAT721State,
        network?: SupportedNetwork
    ) {
        super(
            [
                {
                    contract: new CAT721(
                        addrToP2trLockingScript(minterAddr),
                        new CAT721GuardCovenant().lockingScriptHex
                    ),
                },
            ],
            {
                lockedAsmVersion: CAT721Covenant.LOCKED_ASM_VERSION,
                network,
            }
        )
        this.state = state
    }

    static createTransferGuard(
        inputInfos: {
            nft: CAT721Covenant
            inputIndex: number
        }[],
        receivers: {
            address: Ripemd160
            outputIndex: number
        }[]
    ): {
        guard: CAT721GuardCovenant
        outputNfts: FixedArray<CAT721Covenant | undefined, typeof MAX_STATE>
        changeOutputIndex?: number
    } {
        if (inputInfos.length === 0) {
            throw new Error('No spent nfts')
        }

        if (inputInfos.length > MAX_INPUT - 1) {
            throw new Error(
                `Too many nft inputs that exceed the maximum limit of ${MAX_INPUT}`
            )
        }

        const minterAddr = inputInfos[0].nft.minterAddr

        const guard = new CAT721GuardCovenant({
            collectionScript: inputInfos[0].nft.lockingScriptHex,
            localIdArray: emptyFixedArray().map((_, i) => {
                const input = inputInfos.find((info) => info.inputIndex === i)
                if (input) {
                    if (!input.nft.state) {
                        throw new Error(
                            `Nft state is missing for nft input ${i}`
                        )
                    }
                    return input.nft.state.localId
                } else {
                    return 0n
                }
            }) as FixedArray<int32, typeof MAX_INPUT>,
        })

        const outputNfts = emptyOutputByteStrings().map((_, index) => {
            const receiver = receivers.find((r) => r.outputIndex === index + 1)
            if (receiver) {
                return new CAT721Covenant(
                    minterAddr,
                    CAT721Proto.create(
                        receiver.address,
                        inputInfos[index].nft.state.localId
                    )
                )
            } else {
                return undefined
            }
        }) as FixedArray<CAT721Covenant | undefined, typeof MAX_STATE>

        return {
            guard,
            outputNfts: outputNfts,
        }
    }

    static createBurnGuard(
        inputInfos: {
            nft: CAT721Covenant
            inputIndex: number
        }[]
    ): {
        guard: CAT721GuardCovenant
        outputNfts: FixedArray<CAT721Covenant | undefined, typeof MAX_STATE>
        changeOutputIndex?: number
    } {
        if (inputInfos.length === 0) {
            throw new Error('No spent nfts')
        }
        if (inputInfos.length > MAX_INPUT - 1) {
            throw new Error(
                `Too many nft inputs that exceed the maximum limit of ${MAX_INPUT}`
            )
        }
        const guard = new CAT721GuardCovenant({
            collectionScript: inputInfos[0].nft.lockingScriptHex,
            localIdArray: emptyFixedArray().map((_, i) => {
                const input = inputInfos.find((info) => info.inputIndex === i)
                if (input) {
                    if (!input.nft.state) {
                        throw new Error(
                            `Nft state is missing for nft input ${i}`
                        )
                    }
                    return input.nft.state.localId
                } else {
                    return 0n
                }
            }) as FixedArray<int32, typeof MAX_INPUT>,
        })

        const outputNfts = fill(undefined, MAX_STATE)
        return {
            guard,
            outputNfts: outputNfts,
        }
    }

    static async backtrace(
        cat721Utxos: TraceableCat721Utxo[],
        chainProvider: ChainProvider
    ): Promise<TracedCat721Nft[]> {
        const result: TracedCat721Nft[] = []

        const txCache = new Map<string, string>()
        const getRawTx = async (txId: string) => {
            let rawTxHex = txCache.get(txId)
            if (!rawTxHex) {
                rawTxHex = await chainProvider.getRawTransaction(txId)
                txCache.set(txId, rawTxHex)
            }
            return rawTxHex
        }

        for (const cat721Utxo of cat721Utxos) {
            const nft = new CAT721Covenant(
                cat721Utxo.minterAddr,
                cat721Utxo.state
            ).bindToUtxo(cat721Utxo.utxo)

            if (cat721Utxo.utxo.script !== nft.lockingScriptHex) {
                throw new Error(
                    `Nft utxo ${JSON.stringify(
                        cat721Utxo
                    )} does not match the nft minter address ${
                        cat721Utxo.minterAddr
                    }`
                )
            }

            const nftTxId = cat721Utxo.utxo.txId

            const nftTxHex = await getRawTx(nftTxId)
            const nftTx = Transaction.fromHex(nftTxHex)

            let nftPrevTxHex = undefined
            let nftTxInputIndex = undefined
            for (let idx = 0; idx < nftTx.ins.length; idx++) {
                const input = nftTx.ins[idx]
                const prevTxId = Buffer.from(input.hash.reverse()).toString(
                    'hex'
                )
                const prevTxHex = await getRawTx(prevTxId)
                const prevTx = Transaction.fromHex(prevTxHex)
                const prevNftTxo = prevTx.outs.find((out) => {
                    const outScript = Buffer.from(out.script).toString('hex')
                    return (
                        outScript === cat721Utxo.utxo.script ||
                        outScript === nft.minterScriptHex
                    )
                })
                if (prevNftTxo) {
                    nftPrevTxHex = prevTxHex
                    nftTxInputIndex = idx
                    break
                }
            }

            if (!nftPrevTxHex || nftTxInputIndex === undefined) {
                throw new Error(
                    `Nft utxo ${JSON.stringify(
                        cat721Utxo
                    )} can not be backtraced`
                )
            }

            result.push({
                nft: nft,
                trace: {
                    prevTxHex: nftTxHex,
                    prevTxState: ProtocolState.fromStateHashList(
                        cat721Utxo.txoStateHashes
                    ),
                    prevTxInput: nftTxInputIndex,
                    prevPrevTxHex: nftPrevTxHex,
                },
            })
        }

        return result
    }

    serializedState(): ByteString {
        return CAT721Proto.toByteString(this.state)
    }

    userSpend(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        inputNftTrace: InputTrace,
        guardInfo: NftGuardInfo,
        isP2TR: boolean,
        pubKey: ByteString
    ): SubContractCall {
        return {
            method: 'unlock',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                inputNftTrace,
                guardInfo,
                {
                    isP2TR,
                    pubKey,
                }
            ),
        }
    }

    contractSpend(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        inputNftTrace: InputTrace,
        guardInfo: NftGuardInfo,
        contractInputIndex: number
    ): SubContractCall {
        return {
            method: 'unlock',
            argsBuilder: this.unlockArgsBuilder(
                inputIndex,
                inputCtxs,
                inputNftTrace,
                guardInfo,
                undefined,
                {
                    contractInputIndex,
                }
            ),
        }
    }

    get minterScriptHex(): string {
        return addrToP2trLockingScript(this.minterAddr)
    }

    private unlockArgsBuilder(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        inputNftTrace: InputTrace,
        guardInfo: NftGuardInfo,
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
            statesHashRoot: inputNftTrace.prevTxState.hashRoot,
            txoStateHashes: inputNftTrace.prevTxState.stateHashList,
        }
        // console.log('preTxStatesInfo', preTxStatesInfo)

        const preState = this.state
        if (!preState) {
            throw new Error('Nft state is not available')
        }

        const backTraceInfo = getBackTraceInfo_(
            inputNftTrace.prevTxHex,
            inputNftTrace.prevPrevTxHex,
            inputNftTrace.prevTxInput
        )

        if (userSpend && contractSpend) {
            throw new Error(
                'Only one of userSpent or contractSpent should be provided'
            )
        }

        if (!userSpend && !contractSpend) {
            throw new Error(
                'Either userSpent or contractSpent should be provided'
            )
        }

        return (curPsbt: CatPsbt, tapLeafContract: TapLeafSmartContract) => {
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
            ) // nftUnlockArgs
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
