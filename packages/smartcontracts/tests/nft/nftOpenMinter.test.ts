import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import { NftClosedMinter } from '../../src/contracts/nft/nftClosedMinter'
import { NftOpenMinter } from '../../src/contracts/nft/nftOpenMinter'
import chaiAsPromised from 'chai-as-promised'
import { MethodCallOptions, hash160, toByteString } from 'scrypt-ts'
import { getOutpointString } from '../../src/lib/txTools'
import {
    getBtcDummyUtxo,
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from '../utils/txHelper'
import { getKeyInfoFromWif, getPrivKey } from '../utils/privateKey'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
    script2P2TR,
} from '../../src/lib/catTx'
import { getBackTraceInfo } from '../../src/lib/proof'
import { unlockTaprootContractInput } from '../utils/contractUtils'
import { btc } from '../../src/lib/btc'
import {
    NftMerkleLeaf,
    NftOpenMinterMerkleTreeData,
    NftOpenMinterProto,
    NftOpenMinterState,
} from '../../src/contracts/nft/nftOpenMinterProto'
import { CAT721Proto } from '../../src/contracts/nft/cat721Proto'
import { getCatCommitScript } from '../../src/lib/commit'
import { HEIGHT } from '../../src/contracts/nft/nftOpenMinterMerkleTree'
import { nftOpenMinterCall, nftOpenMinterDeploy } from './openMinter'
use(chaiAsPromised)

const DUST = toByteString('4a01000000000000')

// keyInfo
const keyInfo = getKeyInfoFromWif(getPrivKey())
const { addr: addrP2WPKH, seckey, xAddress, pubKeyPrefix, pubkeyX } = keyInfo
const { genesisTx, genesisUtxo } = getDummyGenesisTx(seckey, addrP2WPKH)
const genesisOutpoint = getOutpointString(genesisTx, 0)
const nftScript =
    '5120c4043a44196c410dba2d7c9288869727227e8fcec717f73650c8ceadc90877cd'

const createDummyCommitScript = function (localId: number): NftMerkleLeaf {
    const commitScript = getCatCommitScript(keyInfo.pubkeyX, { localId })
    const lockingScript = Buffer.from(commitScript, 'hex')
    const { p2tr: p2trCommit } = script2P2TR(lockingScript)
    return {
        commitScript: p2trCommit,
        localId: BigInt(localId),
        isMined: false,
    }
}

const generateCollectionLeaf = function (max: number) {
    const nftMerkleLeafList: NftMerkleLeaf[] = []
    for (let index = 0; index < max; index++) {
        nftMerkleLeafList.push(createDummyCommitScript(index))
    }
    return nftMerkleLeafList
}

export async function deployNftCommitContract(feeUtxo, seckey, lockingScript) {
    const catTx = CatTx.create()
    catTx.tx.from(feeUtxo)
    const atIndex = catTx.addContractOutput(lockingScript)
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: null,
        state: null,
        contractTaproot: null,
        atOutputIndex: atIndex,
    }
}

export async function openMinterUnlock<T>(
    callInfo: ContractCallResult<T>,
    preCatTx: CatTx,
    seckey,
    nftState,
    preNftClosedMinterState,
    pubkeyX,
    pubKeyPrefix,
    prePreTx,
    neighbor,
    neighborType
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
        neighbor,
        neighborType,
        pubKeyPrefix,
        pubkeyX,
        () => sig.toString('hex'),
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
        } as MethodCallOptions<NftClosedMinter>
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

describe('Test SmartContract `NftOpenMinter`', () => {
    const collectionMax: number = 100
    let nftOpenMinter: NftOpenMinter
    let nftOpenMinterTaproot: TaprootSmartContract
    let initNftOpenMinterState: NftOpenMinterState
    let contractIns: ContractIns<NftOpenMinterState>
    let nftOpenMinterMerkleTreeData: NftOpenMinterMerkleTreeData
    let feeUtxo

    before(async () => {
        await NftOpenMinter.loadArtifact()
        nftOpenMinter = new NftOpenMinter(
            genesisOutpoint,
            BigInt(collectionMax),
            0n,
            xAddress
        )
        nftOpenMinterTaproot = TaprootSmartContract.create(nftOpenMinter)
        nftOpenMinterMerkleTreeData = new NftOpenMinterMerkleTreeData(
            generateCollectionLeaf(collectionMax),
            HEIGHT
        )
        initNftOpenMinterState = NftOpenMinterProto.create(
            nftScript,
            nftOpenMinterMerkleTreeData.merkleRoot,
            0n
        )
        contractIns = await nftOpenMinterDeploy(
            seckey,
            genesisUtxo,
            nftOpenMinter,
            nftOpenMinterTaproot,
            initNftOpenMinterState
        )
        feeUtxo = getBtcDummyUtxo(keyInfo.addr)
    })

    it('should open mint nft collection pass.', async () => {
        // tx call
        // nft state
        let prePreTx = genesisTx
        for (
            let collectionIndex = 0;
            collectionIndex < collectionMax;
            collectionIndex++
        ) {
            const nftState = CAT721Proto.create(
                hash160(toByteString('00')),
                BigInt(collectionIndex)
            )
            const callInfo = await nftOpenMinterCall(
                seckey,
                feeUtxo,
                contractIns,
                nftOpenMinterTaproot,
                nftState,
                collectionMax,
                nftOpenMinterMerkleTreeData
            )
            const leafInfo = nftOpenMinterMerkleTreeData.getMerklePath(
                Number(collectionIndex)
            )
            await openMinterUnlock(
                callInfo,
                contractIns.catTx,
                seckey,
                nftState,
                contractIns.state,
                pubkeyX,
                pubKeyPrefix,
                prePreTx,
                leafInfo.neighbor,
                leafInfo.neighborType
            )
            prePreTx = contractIns.catTx.tx
            if (callInfo.nexts.length > 1) {
                contractIns = callInfo
                    .nexts[0] as ContractIns<NftOpenMinterState>
                expect(callInfo.nexts).to.be.length(2)
            } else {
                break
            }
        }
    })

    it('should failed mint nft with error nextLockId', async () => {
        let prePreTx = genesisTx
        for (
            let collectionIndex = 0;
            collectionIndex < collectionMax;
            collectionIndex += 2
        ) {
            const nftState = CAT721Proto.create(
                hash160(toByteString('00')),
                BigInt(collectionIndex)
            )
            const callInfo = await nftOpenMinterCall(
                seckey,
                feeUtxo,
                contractIns,
                nftOpenMinterTaproot,
                nftState,
                collectionMax,
                nftOpenMinterMerkleTreeData
            )
            const leafInfo = nftOpenMinterMerkleTreeData.getMerklePath(
                Number(collectionIndex)
            )
            const call = openMinterUnlock(
                callInfo,
                contractIns.catTx,
                seckey,
                nftState,
                contractIns.state,
                pubkeyX,
                pubKeyPrefix,
                prePreTx,
                leafInfo.neighbor,
                leafInfo.neighborType
            )
            if (collectionIndex > 0) {
                await expect(call).to.be.rejected
            } else {
                try {
                    await call
                } catch {
                    //
                }
            }
            prePreTx = contractIns.catTx.tx
            if (callInfo.nexts.length > 1) {
                contractIns = callInfo
                    .nexts[0] as ContractIns<NftOpenMinterState>
                expect(callInfo.nexts).to.be.length(2)
            } else {
                break
            }
        }
    })

    it('should failed mint nft with error expected script', async () => {
        let prePreTx = genesisTx
        for (
            let collectionIndex = 0;
            collectionIndex < collectionMax - 1;
            collectionIndex++
        ) {
            const nftState = CAT721Proto.create(
                hash160(toByteString('00')),
                BigInt(collectionIndex)
            )
            const callInfo = await nftOpenMinterCall(
                seckey,
                feeUtxo,
                contractIns,
                nftOpenMinterTaproot,
                nftState,
                collectionMax,
                nftOpenMinterMerkleTreeData,
                {
                    errorLeafScript: true,
                }
            )
            const leafInfo = nftOpenMinterMerkleTreeData.getMerklePath(
                Number(collectionIndex)
            )
            await expect(
                openMinterUnlock(
                    callInfo,
                    contractIns.catTx,
                    seckey,
                    nftState,
                    contractIns.state,
                    pubkeyX,
                    pubKeyPrefix,
                    prePreTx,
                    leafInfo.neighbor,
                    leafInfo.neighborType
                )
            ).to.be.rejected
            prePreTx = contractIns.catTx.tx
            if (callInfo.nexts.length > 1) {
                contractIns = callInfo
                    .nexts[0] as ContractIns<NftOpenMinterState>
                expect(callInfo.nexts).to.be.length(2)
            } else {
                break
            }
        }
    })
})
