import { NftClosedMinter } from '../../src/contracts/nft/nftClosedMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../../src/lib/catTx'
import { CAT721Proto, CAT721State } from '../../src/contracts/nft/cat721Proto'
import {
    NftParallelClosedMinterProto,
    NftParallelClosedMinterState,
} from '../../src/contracts/nft/nftParallelClosedMinterProto'

export async function nftParallelClosedMinterDeploy(
    seckey,
    genesisUtxo,
    nftClosedMinter: NftClosedMinter,
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
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: nftClosedMinter,
        state: nftClosedMinterState,
        contractTaproot: nftClosedMinterTaproot,
        atOutputIndex: atIndex,
    }
}

export async function nftParallelClosedMinterCall(
    contractIns: ContractIns<NftParallelClosedMinterState>,
    nftTaproot: TaprootSmartContract,
    nftState: CAT721State,
    max: bigint,
    errorNextLocalId: boolean = false
): Promise<ContractCallResult<NftParallelClosedMinterState | CAT721State>> {
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    const nexts: ContractIns<NftParallelClosedMinterState | CAT721State>[] = []
    //
    let nextLocalId1 =
        contractIns.state.nextLocalId + contractIns.state.nextLocalId + 1n
    const nextLocalId2 =
        contractIns.state.nextLocalId + contractIns.state.nextLocalId + 2n
    if (errorNextLocalId) {
        nextLocalId1 = nextLocalId1 + 1n
    }
    if (nextLocalId1 < max) {
        const nextState = NftParallelClosedMinterProto.create(
            contractIns.state.nftScript,
            nextLocalId1
        )
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.contractTaproot.lockingScript,
            NftParallelClosedMinterProto.toByteString(nextState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            state: nextState,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    if (nextLocalId2 < max) {
        const nextState = NftParallelClosedMinterProto.create(
            contractIns.state.nftScript,
            nextLocalId2
        )
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.contractTaproot.lockingScript,
            NftParallelClosedMinterProto.toByteString(nextState)
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
