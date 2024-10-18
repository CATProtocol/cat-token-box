import { NftOpenMinter } from '../../src/contracts/nft/nftOpenMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../../src/lib/catTx'
import { CAT721Proto, CAT721State } from '../../src/contracts/nft/cat721Proto'
import {
    NftMerkleLeaf,
    NftOpenMinterMerkleTreeData,
    NftOpenMinterProto,
    NftOpenMinterState,
} from '../../src/contracts/nft/nftOpenMinterProto'
import { deployNftCommitContract } from './nftOpenMinter.test'

export async function nftOpenMinterDeploy(
    seckey,
    genesisUtxo,
    nftOpenMinter: NftOpenMinter,
    nftOpenMinterTaproot: TaprootSmartContract,
    nftOpenMinterState: NftOpenMinterState
): Promise<ContractIns<NftOpenMinterState>> {
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    const atIndex = catTx.addStateContractOutput(
        nftOpenMinterTaproot.lockingScript,
        NftOpenMinterProto.toByteString(nftOpenMinterState)
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: nftOpenMinter,
        state: nftOpenMinterState,
        contractTaproot: nftOpenMinterTaproot,
        atOutputIndex: atIndex,
    }
}

export async function nftOpenMinterCall(
    seckey,
    feeUtxo,
    contractIns: ContractIns<NftOpenMinterState>,
    nftTaproot: TaprootSmartContract,
    nftState: CAT721State,
    max: number,
    nftOpenMinterMerkleTreeData: NftOpenMinterMerkleTreeData,
    options: {
        errorLeafScript?: boolean
    } = {}
): Promise<ContractCallResult<NftOpenMinterState | CAT721State>> {
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    const nexts: ContractIns<NftOpenMinterState | CAT721State>[] = []
    //
    const collectionIndex = Number(nftState.localId)
    const oldLeaf = nftOpenMinterMerkleTreeData.getLeaf(
        Number(nftState.localId)
    )
    let commitScript = oldLeaf.commitScript
    if (options.errorLeafScript) {
        commitScript = nftOpenMinterMerkleTreeData.getLeaf(
            Number(nftState.localId) + 1
        ).commitScript
    }
    // add commit script
    const commit = await deployNftCommitContract(feeUtxo, seckey, commitScript)
    catTx.fromCatTx(commit.catTx, commit.atOutputIndex)
    const newLeaf: NftMerkleLeaf = {
        commitScript: oldLeaf.commitScript,
        localId: oldLeaf.localId,
        isMined: true,
    }
    const updateLeafInfo = nftOpenMinterMerkleTreeData.updateLeaf(
        newLeaf,
        collectionIndex
    )
    const mintNumber = contractIns.state.nextLocalId + 1n
    if (mintNumber != BigInt(max)) {
        const nextState = NftOpenMinterProto.create(
            contractIns.state.nftScript,
            updateLeafInfo.merkleRoot,
            mintNumber
        )
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.contractTaproot.lockingScript,
            NftOpenMinterProto.toByteString(nextState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            state: nextState,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    const atOutputIndex = catTx.addStateContractOutput(
        contractIns.state.nftScript,
        CAT721Proto.toByteString(nftState)
    )
    nexts.push({
        catTx: catTx,
        preCatTx: contractIns.catTx,
        contract: nftTaproot.contract,
        state: nftState,
        contractTaproot: nftTaproot,
        atOutputIndex: atOutputIndex,
    })
    return {
        catTx: catTx,
        contract: contractIns.contract,
        state: contractIns.state,
        contractTaproot: contractIns.contractTaproot,
        atInputIndex: atInputIndex,
        nexts: nexts,
    }
}
