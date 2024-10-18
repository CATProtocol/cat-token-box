import { NftClosedMinter } from '../../src/contracts/nft/nftClosedMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../../src/lib/catTx'
import { CAT721Proto, CAT721State } from '../../src/contracts/nft/cat721Proto'
import {
    NftClosedMinterProto,
    NftClosedMinterState,
} from '../../src/contracts/nft/nftClosedMinterProto'
import { FixedArray } from 'scrypt-ts'

export async function nftClosedMinterDeploy(
    seckey,
    genesisUtxo,
    nftClosedMinter: NftClosedMinter,
    nftClosedMinterTaproot: TaprootSmartContract,
    nftClosedMinterState: NftClosedMinterState
): Promise<ContractIns<NftClosedMinterState>> {
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    const atIndex = catTx.addStateContractOutput(
        nftClosedMinterTaproot.lockingScript,
        NftClosedMinterProto.toByteString(nftClosedMinterState)
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

export async function nftClosedMinterDeployQuota(
    seckey,
    genesisUtxo,
    nftClosedMinter: NftClosedMinter,
    nftClosedMinterTaproot: TaprootSmartContract,
    nftClosedMinterStateList: FixedArray<NftClosedMinterState, 5>
): Promise<FixedArray<ContractIns<NftClosedMinterState>, 5>> {
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    const nexts = [] as unknown as FixedArray<
        ContractIns<NftClosedMinterState>,
        5
    >
    for (let index = 0; index < nftClosedMinterStateList.length; index++) {
        const nftClosedMinterState = nftClosedMinterStateList[index]
        const atIndex = catTx.addStateContractOutput(
            nftClosedMinterTaproot.lockingScript,
            NftClosedMinterProto.toByteString(nftClosedMinterState)
        )
        nexts.push({
            catTx: catTx,
            contract: nftClosedMinter,
            state: nftClosedMinterState,
            contractTaproot: nftClosedMinterTaproot,
            atOutputIndex: atIndex,
        })
    }
    catTx.sign(seckey)
    return nexts
}

export async function nftClosedMinterCall(
    contractIns: ContractIns<NftClosedMinterState>,
    nftTaproot: TaprootSmartContract,
    nftState: CAT721State
): Promise<ContractCallResult<NftClosedMinterState | CAT721State>> {
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    const nexts: ContractIns<NftClosedMinterState | CAT721State>[] = []
    //
    const nextLocalId = contractIns.state.nextLocalId + 1n
    if (nextLocalId < contractIns.state.quotaMaxLocalId) {
        const nextState = NftClosedMinterProto.create(
            contractIns.state.nftScript,
            contractIns.state.quotaMaxLocalId,
            contractIns.state.nextLocalId + 1n
        )
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.contractTaproot.lockingScript,
            NftClosedMinterProto.toByteString(nextState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            state: contractIns.state,
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
