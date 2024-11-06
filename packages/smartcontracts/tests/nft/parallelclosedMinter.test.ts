import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import { NftParallelClosedMinter } from '../../src/contracts/nft/nftParallelClosedMinter'
import chaiAsPromised from 'chai-as-promised'
import { MethodCallOptions, hash160, toByteString } from 'scrypt-ts'
import { getOutpointString } from '../../src/lib/txTools'
import {
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from '../utils/txHelper'
import { getKeyInfoFromWif, getPrivKey } from '../utils/privateKey'
import {
    nftParallelClosedMinterCall,
    nftParallelClosedMinterDeploy,
} from './parallelClosedMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../../src/lib/catTx'
import { getBackTraceInfo } from '../../src/lib/proof'
import { unlockTaprootContractInput } from '../utils/contractUtils'
import { btc } from '../../src/lib/btc'
import {
    NftParallelClosedMinterProto,
    NftParallelClosedMinterState,
} from '../../src/contracts/nft/nftParallelClosedMinterProto'
import { CAT721Proto, CAT721State } from '../../src/contracts/nft/cat721Proto'
use(chaiAsPromised)

const DUST = toByteString('4a01000000000000')

export async function closedMinterUnlock<T>(
    callInfo: ContractCallResult<T>,
    preCatTx: CatTx,
    seckey,
    nftState,
    preNftClosedMinterState,
    pubkeyX,
    pubKeyPrefix,
    prePreTx,
    options: {
        errorSig?: boolean
    } = {}
) {
    const { shPreimage, prevoutsCtx, spentScripts, sighash } =
        callInfo.catTx.getInputCtx(
            callInfo.atInputIndex,
            callInfo.contractTaproot.tapleafBuffer
        )
    const backtraceInfo = getBackTraceInfo(
        // pre
        preCatTx.tx,
        prePreTx,
        callInfo.atInputIndex
    )
    const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
    await callInfo.contract.connect(getDummySigner())
    const closedMinterFuncCall = await callInfo.contract.methods.mint(
        callInfo.catTx.state.stateHashList,
        nftState,
        pubKeyPrefix,
        pubkeyX,
        () => (options.errorSig ? toByteString('') : sig.toString('hex')),
        DUST,
        DUST,
        // pre state
        preNftClosedMinterState,
        preCatTx.getPreState(),
        //
        backtraceInfo,
        shPreimage,
        prevoutsCtx,
        spentScripts,
        {
            script: toByteString(''),
            satoshis: toByteString('0000000000000000'),
        },
        {
            fromUTXO: getDummyUTXO(),
            verify: false,
            exec: false,
        } as MethodCallOptions<NftParallelClosedMinter>
    )
    unlockTaprootContractInput(
        closedMinterFuncCall,
        callInfo.contractTaproot,
        callInfo.catTx.tx,
        // pre tx
        preCatTx.tx,
        callInfo.atInputIndex,
        true,
        true
    )
}

// keyInfo
const keyInfo = getKeyInfoFromWif(getPrivKey())
const { addr: addrP2WPKH, seckey, xAddress, pubKeyPrefix, pubkeyX } = keyInfo
const { genesisTx, genesisUtxo } = getDummyGenesisTx(seckey, addrP2WPKH)
const genesisOutpoint = getOutpointString(genesisTx, 0)
const nftScript =
    '5120c4043a44196c410dba2d7c9288869727227e8fcec717f73650c8ceadc90877cd'

describe('Test SmartContract `NftParallelClosedMinter`', () => {
    let nftClosedMinter: NftParallelClosedMinter
    let nftClosedMinterTaproot: TaprootSmartContract
    let initNftClosedMinterState: NftParallelClosedMinterState
    let nftClosedMinterState: NftParallelClosedMinterState
    let contractIns: ContractIns<NftParallelClosedMinterState>
    const collectionMax = 100n
    before(async () => {
        await NftParallelClosedMinter.loadArtifact()
        nftClosedMinter = new NftParallelClosedMinter(
            xAddress,
            genesisOutpoint,
            collectionMax
        )
        nftClosedMinterTaproot = TaprootSmartContract.create(nftClosedMinter)
        initNftClosedMinterState = NftParallelClosedMinterProto.create(
            nftScript,
            0n
        )
        nftClosedMinterState = initNftClosedMinterState
        contractIns = await nftParallelClosedMinterDeploy(
            seckey,
            genesisUtxo,
            nftClosedMinter,
            nftClosedMinterTaproot,
            initNftClosedMinterState
        )
    })

    it('should admin mint nft pass.', async () => {
        // tx call
        // nft state
        const nftState = CAT721Proto.create(
            hash160(toByteString('00')),
            nftClosedMinterState.nextLocalId
        )
        const callInfo = await nftParallelClosedMinterCall(
            contractIns,
            nftClosedMinterTaproot,
            nftState,
            collectionMax
        )
        await closedMinterUnlock(
            callInfo,
            contractIns.catTx,
            seckey,
            nftState,
            contractIns.state,
            pubkeyX,
            pubKeyPrefix,
            genesisTx
        )
        expect(callInfo.nexts.length).to.be.equal(3)
    })

    it('should admin mint nft until end.', async () => {
        // tx call
        const nftList: ContractIns<CAT721State>[] = []
        const parallelMinter = async function (
            contractIns: ContractIns<NftParallelClosedMinterState>,
            prePreTx
        ) {
            const nftState = CAT721Proto.create(
                hash160(toByteString('00')),
                contractIns.state.nextLocalId
            )
            const callInfo = await nftParallelClosedMinterCall(
                contractIns,
                nftClosedMinterTaproot,
                nftState,
                collectionMax
            )
            await closedMinterUnlock(
                callInfo,
                contractIns.catTx,
                seckey,
                nftState,
                contractIns.state,
                pubkeyX,
                pubKeyPrefix,
                prePreTx
            )
            nftList.push(
                callInfo.nexts[
                    callInfo.nexts.length - 1
                ] as ContractIns<CAT721State>
            )
            if (callInfo.nexts.length > 1) {
                for (
                    let index = 0;
                    index < callInfo.nexts.length - 1;
                    index++
                ) {
                    await parallelMinter(
                        callInfo.nexts[
                            index
                        ] as ContractIns<NftParallelClosedMinterState>,
                        contractIns.catTx.tx
                    )
                }
            }
        }
        await parallelMinter(contractIns, genesisTx)
        const localIdSet = new Set(nftList.map((nft) => nft.state.localId))
        expect(localIdSet.size).to.be.equal(Number(collectionMax))
    })

    it('should failed mint nft with error localId', async () => {
        // tx call
        const nftList: ContractIns<CAT721State>[] = []
        const parallelMinter = async function (
            contractIns: ContractIns<NftParallelClosedMinterState>,
            prePreTx
        ) {
            const nftState = CAT721Proto.create(
                hash160(toByteString('00')),
                contractIns.state.nextLocalId + 1n
            )
            const callInfo = await nftParallelClosedMinterCall(
                contractIns,
                nftClosedMinterTaproot,
                nftState,
                collectionMax
            )
            await expect(
                closedMinterUnlock(
                    callInfo,
                    contractIns.catTx,
                    seckey,
                    nftState,
                    contractIns.state,
                    pubkeyX,
                    pubKeyPrefix,
                    prePreTx
                )
            ).to.be.rejected
            nftList.push(
                callInfo.nexts[
                    callInfo.nexts.length - 1
                ] as ContractIns<CAT721State>
            )
            if (callInfo.nexts.length > 1) {
                for (
                    let index = 0;
                    index < callInfo.nexts.length - 1;
                    index++
                ) {
                    await parallelMinter(
                        callInfo.nexts[
                            index
                        ] as ContractIns<NftParallelClosedMinterState>,
                        contractIns.catTx.tx
                    )
                }
            }
        }
        await parallelMinter(contractIns, genesisTx)
        expect(nftList).to.be.length(Number(collectionMax))
    })

    it('should failed mint nft with error nextLocalId', async () => {
        it('should admin mint nft until end.', async () => {
            // tx call
            const nftList: ContractIns<CAT721State>[] = []
            const parallelMinter = async function (
                contractIns: ContractIns<NftParallelClosedMinterState>,
                prePreTx
            ) {
                const nftState = CAT721Proto.create(
                    hash160(toByteString('00')),
                    contractIns.state.nextLocalId
                )
                const callInfo = await nftParallelClosedMinterCall(
                    contractIns,
                    nftClosedMinterTaproot,
                    nftState,
                    collectionMax,
                    true
                )
                await expect(
                    closedMinterUnlock(
                        callInfo,
                        contractIns.catTx,
                        seckey,
                        nftState,
                        contractIns.state,
                        pubkeyX,
                        pubKeyPrefix,
                        prePreTx
                    )
                ).to.be.rejected
                nftList.push(
                    callInfo.nexts[
                        callInfo.nexts.length - 1
                    ] as ContractIns<CAT721State>
                )
                if (callInfo.nexts.length > 1) {
                    for (
                        let index = 0;
                        index < callInfo.nexts.length - 1;
                        index++
                    ) {
                        await parallelMinter(
                            callInfo.nexts[
                                index
                            ] as ContractIns<NftParallelClosedMinterState>,
                            contractIns.catTx.tx
                        )
                    }
                }
            }
            await parallelMinter(contractIns, genesisTx)
            expect(nftList).to.be.length(Number(collectionMax))
        })
    })

    it('should failed mint nft with error sig', async () => {
        // tx call
        let prePreTx = genesisTx
        while (nftClosedMinterState.nextLocalId <= collectionMax) {
            // nft state
            const nftState = CAT721Proto.create(
                hash160(toByteString('00')),
                nftClosedMinterState.nextLocalId
            )
            const callInfo = await nftParallelClosedMinterCall(
                contractIns,
                nftClosedMinterTaproot,
                nftState,
                collectionMax
            )
            await expect(
                closedMinterUnlock(
                    callInfo,
                    contractIns.catTx,
                    seckey,
                    nftState,
                    contractIns.state,
                    pubkeyX,
                    pubKeyPrefix,
                    prePreTx,
                    {
                        errorSig: true,
                    }
                )
            ).to.be.rejected
            prePreTx = contractIns.catTx.tx
            if (callInfo.nexts.length > 1) {
                contractIns = callInfo
                    .nexts[0] as ContractIns<NftParallelClosedMinterState>
            } else {
                break
            }
            nftClosedMinterState.nextLocalId += 1n
        }
    })

    it('should failed genesis tx more than one minter', async () => {
        async function nftParallelClosedMinterDeploy(
            seckey,
            genesisUtxo,
            nftClosedMinter: NftParallelClosedMinter,
            nftClosedMinterTaproot: TaprootSmartContract,
            nftClosedMinterState: NftParallelClosedMinterState
        ): Promise<ContractIns<NftParallelClosedMinterState>> {
            // tx deploy
            const catTx = CatTx.create()
            catTx.tx.from([genesisUtxo])
            const atIndex = catTx.addStateContractOutput(
                nftClosedMinterTaproot.lockingScript,
                NftParallelClosedMinterProto.toByteString(nftClosedMinterState)
            )
            catTx.addStateContractOutput(
                nftClosedMinterTaproot.lockingScript,
                NftParallelClosedMinterProto.toByteString(nftClosedMinterState)
            )
            catTx.sign(seckey)
            return {
                catTx: catTx,
                contract: nftClosedMinter,
                state: nftClosedMinterState,
                contractTaproot: nftClosedMinterTaproot,
                atOutputIndex: atIndex,
            }
        }
        const contractIns = await nftParallelClosedMinterDeploy(
            seckey,
            genesisUtxo,
            nftClosedMinter,
            nftClosedMinterTaproot,
            initNftClosedMinterState
        )
        const nftState = CAT721Proto.create(
            hash160(toByteString('00')),
            nftClosedMinterState.nextLocalId
        )
        const callInfo = await nftParallelClosedMinterCall(
            contractIns,
            nftClosedMinterTaproot,
            nftState,
            collectionMax
        )
        await expect(
            closedMinterUnlock(
                callInfo,
                contractIns.catTx,
                seckey,
                nftState,
                contractIns.state,
                pubkeyX,
                pubKeyPrefix,
                genesisTx
            )
        ).to.be.rejected
        expect(callInfo.nexts.length).to.be.equal(3)
    })
})
