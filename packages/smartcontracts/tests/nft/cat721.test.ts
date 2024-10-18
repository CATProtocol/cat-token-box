import { expect } from 'chai'
import { NftClosedMinter } from '../../src/contracts/nft/nftClosedMinter'
import {
    NftClosedMinterProto,
    NftClosedMinterState,
} from '../../src/contracts/nft/nftClosedMinterProto'
import { CAT721, NftGuardInfo } from '../../src/contracts/nft/cat721'
import { CAT721Proto, CAT721State } from '../../src/contracts/nft/cat721Proto'
import { NftGuardProto } from '../../src/contracts/nft/nftGuardProto'
import { NftBurnGuard } from '../../src/contracts/nft/nftBurnGuard'
import { NftTransferGuard } from '../../src/contracts/nft/nftTransferGuard'
import { btc } from '../../src/lib/btc'
import {
    CatTx,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '../../src/lib/catTx'
import { KeyInfo, getKeyInfoFromWif, getPrivKey } from '../utils/privateKey'
import {
    UTXO,
    getBtcDummyUtxo,
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from '../utils/txHelper'

import {
    getOutpointObj,
    getOutpointString,
    getTxCtx,
} from '../../src/lib/txTools'
import { nftClosedMinterCall, nftClosedMinterDeploy } from './closedMinter'
import { MethodCallOptions, fill, toByteString } from 'scrypt-ts'
import {
    emptyTokenArray,
    getBackTraceInfoSearch,
    getTxHeaderCheck,
} from '../../src/lib/proof'
import { unlockTaprootContractInput } from '../utils/contractUtils'
import { getNftGuardContractInfo, nftGuardDeloy } from './cat721'
import {
    MAX_INPUT,
    MAX_TOKEN_INPUT,
    MAX_TOKEN_OUTPUT,
} from '../../src/contracts/utils/txUtil'

export async function nftTransferCall(
    feeGuardUtxo,
    feeTokenUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    collectionNfts: ContractIns<CAT721State>[],
    receivers: CAT721State[],
    minterScript: string,
    guardInfo: TaprootMastSmartContract,
    burn: boolean,
    options: {
        errorNftSeq?: boolean
        errorGuardLocalId?: boolean
        errorMask?: boolean
    } = {}
): Promise<ContractIns<CAT721State> | null> {
    const nftGuardState = NftGuardProto.createEmptyState()
    nftGuardState.collectionScript =
        collectionNfts[0].contractTaproot.lockingScriptHex
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (collectionNfts[index]) {
            if (!options.errorGuardLocalId) {
                nftGuardState.localIdArray[index] =
                    collectionNfts[index].state.localId
            }
        }
    }
    const nftGuardDeployInfo = await nftGuardDeloy(
        feeGuardUtxo,
        seckey,
        nftGuardState,
        guardInfo,
        burn
    )
    const catTx = CatTx.create()
    for (const nft of collectionNfts) {
        catTx.fromCatTx(nft.catTx, nft.atOutputIndex)
    }
    catTx.fromCatTx(nftGuardDeployInfo.catTx, nftGuardDeployInfo.atOutputIndex)
    if (catTx.tx.inputs.length < MAX_INPUT) {
        catTx.tx.from(feeTokenUtxo)
    }
    if (!burn) {
        if (options.errorNftSeq) {
            const temp1 = receivers[0]
            const temp2 = receivers[1]
            receivers[0] = temp2
            receivers[1] = temp1
        }
        for (const receiver of receivers) {
            catTx.addStateContractOutput(
                nftGuardState.collectionScript,
                CAT721Proto.toByteString(receiver)
            )
        }
    }
    for (let i = 0; i < collectionNfts.length; i++) {
        const nft = collectionNfts[i]
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(catTx.tx, i, nft.contractTaproot.tapleafBuffer)
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = nft.catTx.tx
        const prePreTx = nft.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            nft.contractTaproot.lockingScriptHex,
            minterScript
        )
        const amountCheckTx = getTxHeaderCheck(nftGuardDeployInfo.catTx.tx, 1)
        const guardInputIndex = collectionNfts.length
        const amountCheckInfo: NftGuardInfo = {
            outputIndex: getOutpointObj(nftGuardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(guardInputIndex),
            tx: amountCheckTx.tx,
            guardState: nftGuardDeployInfo.state,
        }
        await nft.contract.connect(getDummySigner())
        const nftCall = await nft.contract.methods.unlock(
            {
                isUserSpend: true,
                userPubKeyPrefix: pubKeyPrefix,
                userPubKey: pubkeyX,
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(collectionNfts.length + 1),
            },
            nft.state,
            nft.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT721>
        )
        unlockTaprootContractInput(
            nftCall,
            nft.contractTaproot,
            catTx.tx,
            preTx,
            i,
            true,
            true
        )
    }
    const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
        catTx.tx,
        collectionNfts.length,
        nftGuardDeployInfo.contractTaproot.tapleafBuffer
    )
    const preTx = getTxHeaderCheck(nftGuardDeployInfo.catTx.tx, 1)
    await nftGuardDeployInfo.contract.connect(getDummySigner())
    if (!burn) {
        const tokenOutputMaskArray = fill(false, MAX_TOKEN_OUTPUT)
        const ownerAddrOrScriptArray = emptyTokenArray()
        const localIdList = fill(0n, MAX_TOKEN_OUTPUT)
        const outputSatoshiArray = emptyTokenArray()
        for (let i = 0; i < receivers.length; i++) {
            const receiver = receivers[i]
            tokenOutputMaskArray[i] = true
            ownerAddrOrScriptArray[i] = receiver.ownerAddr
            localIdList[i] = receiver.localId
        }
        if (options.errorMask) {
            tokenOutputMaskArray[receivers.length] = true
            ownerAddrOrScriptArray[receivers.length] = receivers[0].ownerAddr
            localIdList[receivers.length] = receivers[0].localId
        }
        const nftTransferCheckCall =
            await nftGuardDeployInfo.contract.methods.transfer(
                catTx.state.stateHashList,
                ownerAddrOrScriptArray,
                localIdList,
                tokenOutputMaskArray,
                outputSatoshiArray,
                toByteString('4a01000000000000'),
                nftGuardDeployInfo.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                spentScripts,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<NftTransferGuard>
            )
        unlockTaprootContractInput(
            nftTransferCheckCall,
            nftGuardDeployInfo.contractTaproot,
            catTx.tx,
            nftGuardDeployInfo.catTx.tx,
            collectionNfts.length,
            true,
            true
        )
    } else {
        {
            const outputArray = emptyTokenArray()
            const outputSatoshiArray = emptyTokenArray()
            const burnGuardCall =
                await nftGuardDeployInfo.contract.methods.burn(
                    catTx.state.stateHashList,
                    outputArray,
                    outputSatoshiArray,
                    nftGuardDeployInfo.state,
                    preTx.tx,
                    shPreimage,
                    prevoutsCtx,
                    {
                        fromUTXO: getDummyUTXO(),
                        verify: false,
                        exec: false,
                    } as MethodCallOptions<NftBurnGuard>
                )
            unlockTaprootContractInput(
                burnGuardCall,
                nftGuardDeployInfo.contractTaproot,
                catTx.tx,
                nftGuardDeployInfo.catTx.tx,
                collectionNfts.length,
                true,
                true
            )
        }
    }
    return null
}

describe('Test `CAT721` tokens', () => {
    let keyInfo: KeyInfo
    let genesisTx: btc.Transaction
    let genesisUtxo: UTXO
    let genesisOutpoint: string
    let nftClosedMinter: NftClosedMinter
    let nftClosedMinterTaproot: TaprootSmartContract
    let nftGuardInfo: TaprootMastSmartContract
    let nft: CAT721
    let initNftClosedMinterState: NftClosedMinterState
    let nftClosedMinterState: NftClosedMinterState
    let nftTaproot: TaprootSmartContract
    let closedMinterIns: ContractIns<NftClosedMinterState>
    let feeGuardUtxo
    let feeTokenUtxo
    const collectionMax = 100n
    // let closedMinterInsFake: ContractIns<NftClosedMinterState>

    before(async () => {
        // init load
        await NftClosedMinter.loadArtifact()
        await CAT721.loadArtifact()
        await NftTransferGuard.loadArtifact()
        await NftBurnGuard.loadArtifact()
        // key info
        keyInfo = getKeyInfoFromWif(getPrivKey())
        // dummy genesis
        const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        genesisTx = dummyGenesis.genesisTx
        genesisUtxo = dummyGenesis.genesisUtxo
        genesisOutpoint = getOutpointString(genesisTx, 0)
        // minter
        nftClosedMinter = new NftClosedMinter(
            keyInfo.xAddress,
            genesisOutpoint,
            collectionMax
        )
        nftClosedMinterTaproot = TaprootSmartContract.create(nftClosedMinter)
        // guard
        nftGuardInfo = getNftGuardContractInfo()
        // nft
        nft = new CAT721(
            nftClosedMinterTaproot.lockingScriptHex,
            nftGuardInfo.lockingScriptHex
        )
        nftTaproot = TaprootSmartContract.create(nft)
        initNftClosedMinterState = NftClosedMinterProto.create(
            nftTaproot.lockingScriptHex,
            collectionMax,
            0n
        )
        nftClosedMinterState = initNftClosedMinterState
        // deploy minter
        closedMinterIns = await nftClosedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            nftClosedMinter,
            nftClosedMinterTaproot,
            initNftClosedMinterState
        )
        // const dummyFakeGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        // minter
        // const fakeClosedMinter = new NftClosedMinter(
        //     keyInfo.xAddress,
        //     getOutpointString(dummyFakeGenesis.genesisTx, 0)
        // )
        // const fakeClosedMinterTaproot =
        //     TaprootSmartContract.create(fakeClosedMinter)
        // closedMinterInsFake = await nftClosedMinterDeploy(
        //     keyInfo.seckey,
        //     dummyFakeGenesis.genesisUtxo,
        //     fakeClosedMinter,
        //     fakeClosedMinterTaproot,
        //     initNftClosedMinterState
        // )
        // closedMinterInsUpgrade
        // const dummyGenesisUpgrade = getDummyGenesisTx(
        //     keyInfo.seckey,
        //     keyInfo.addr
        // )
        // const closedMinterUpgrade = new NftClosedMinter(
        //     keyInfo.xAddress,
        //     getOutpointString(dummyGenesisUpgrade.genesisTx, 0)
        // )
        // const closedMinterUpgradeTaproot =
        //     TaprootSmartContract.create(closedMinterUpgrade)
        // upgrade token
        // const upgradeToken = new CAT721(
        //     closedMinterUpgradeTaproot.lockingScriptHex
        // )
        // const upgradeTokenTaproot = TaprootSmartContract.create(upgradeToken)
        // closedMinterInsUpgrade = await nftClosedMinterDeploy(
        //     keyInfo.seckey,
        //     dummyGenesisUpgrade.genesisUtxo,
        //     closedMinterUpgrade,
        //     upgradeTokenTaproot,
        //     initNftClosedMinterState
        // )
        feeGuardUtxo = getBtcDummyUtxo(keyInfo.addr)
        feeTokenUtxo = getBtcDummyUtxo(keyInfo.addr)
        // wrongFeeTokenUtxo = getBtcDummyUtxo(
        //     new btc.PrivateKey().toAddress(
        //         null,
        //         btc.Address.PayToWitnessPublicKeyHash
        //     )
        // )
    })

    async function mintNft(nftState: CAT721State) {
        const closedMinterCallInfo = await nftClosedMinterCall(
            closedMinterIns,
            nftTaproot,
            nftState
        )
        closedMinterIns = closedMinterCallInfo
            .nexts[0] as ContractIns<NftClosedMinterState>
        nftClosedMinterState.nextLocalId += 1n
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT721State>
    }

    async function getNftByNumber(
        count: number
    ): Promise<ContractIns<CAT721State>[]> {
        const collectionNfts: ContractIns<CAT721State>[] = []
        for (let i = 0; i < count; i++) {
            collectionNfts.push(
                await mintNft(
                    CAT721Proto.create(
                        keyInfo.xAddress,
                        nftClosedMinterState.nextLocalId
                    )
                )
            )
        }
        return collectionNfts
    }

    describe('When a nft is being transferred by users', () => {
        it('t01: should succeed with any input index and output index', async () => {
            for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
                const nfts = await getNftByNumber(index + 1)
                const nftStateList = nfts.map((value) => value.state)
                await nftTransferCall(
                    feeGuardUtxo,
                    feeTokenUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    nfts,
                    nftStateList,
                    nftClosedMinterTaproot.lockingScriptHex,
                    nftGuardInfo,
                    false
                )
            }
        })

        it('t02: should fail when inputs localIds different outputs localIds', async () => {
            for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
                const nfts = await getNftByNumber(index + 1)
                const nftStateList = nfts.map((value) => value.state)
                await expect(
                    nftTransferCall(
                        feeGuardUtxo,
                        feeTokenUtxo,
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        nfts,
                        nftStateList,
                        nftClosedMinterTaproot.lockingScriptHex,
                        nftGuardInfo,
                        false,
                        {
                            errorNftSeq: true,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('t03: should burt success', async () => {
            for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
                const nfts = await getNftByNumber(index + 1)
                const nftStateList = nfts.map((value) => value.state)
                await nftTransferCall(
                    feeGuardUtxo,
                    feeTokenUtxo,
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    nfts,
                    nftStateList,
                    nftClosedMinterTaproot.lockingScriptHex,
                    nftGuardInfo,
                    true
                )
            }
        })

        it('t04: should failed guard with error localId', async () => {
            for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
                const nfts = await getNftByNumber(index + 1)
                const nftStateList = nfts.map((value) => value.state)
                await expect(
                    nftTransferCall(
                        feeGuardUtxo,
                        feeTokenUtxo,
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        nfts,
                        nftStateList,
                        nftClosedMinterTaproot.lockingScriptHex,
                        nftGuardInfo,
                        false,
                        {
                            errorGuardLocalId: true,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('t04: should failed guard with error mask', async () => {
            for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
                const nfts = await getNftByNumber(index + 1)
                const nftStateList = nfts.map((value) => value.state)
                await expect(
                    nftTransferCall(
                        feeGuardUtxo,
                        feeTokenUtxo,
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        nfts,
                        nftStateList,
                        nftClosedMinterTaproot.lockingScriptHex,
                        nftGuardInfo,
                        false,
                        {
                            errorGuardLocalId: true,
                        }
                    )
                ).to.be.rejected
            }
        })
    })
})
