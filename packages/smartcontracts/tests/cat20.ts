import { ClosedMinter } from '../src/contracts/token/closedMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '../src/lib/catTx'
import { CAT20Proto, CAT20State } from '../src/contracts/token/cat20Proto'
import { SmartContract } from 'scrypt-ts'
import { BurnGuard } from '../src/contracts/token/burnGuard'
import { TransferGuard } from '../src/contracts/token/transferGuard'
import { GuardProto, GuardConstState } from '../src/contracts/token/guardProto'

export type GetTokenScript = (
    minterScript: string
) => Promise<{ contract: SmartContract; contractTaproot: TaprootSmartContract }>

export async function closedMinterDeploy(
    seckey,
    genesisUtxo,
    closedMinter: ClosedMinter,
    tokenScript: string
): Promise<ContractIns<string>> {
    const closedMinterTaproot = TaprootSmartContract.create(closedMinter)
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    const atIndex = catTx.addStateContractOutput(
        closedMinterTaproot.lockingScript,
        tokenScript
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: closedMinter,
        state: tokenScript,
        contractTaproot: closedMinterTaproot,
        atOutputIndex: atIndex,
    }
}

export async function closedMinterCall(
    closedMinterIns: ContractIns<string>,
    tokenTaproot: TaprootSmartContract,
    tokenState: CAT20State,
    increase: boolean
): Promise<ContractCallResult<string | CAT20State>> {
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        closedMinterIns.catTx,
        closedMinterIns.atOutputIndex
    )
    const nexts: ContractIns<string | CAT20State>[] = []
    if (increase) {
        const atOutputIndex = catTx.addStateContractOutput(
            closedMinterIns.contractTaproot.lockingScript,
            closedMinterIns.state
        )
        nexts.push({
            catTx: catTx,
            preCatTx: closedMinterIns.catTx,
            contract: closedMinterIns.contract,
            state: closedMinterIns.state,
            contractTaproot: closedMinterIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    const atOutputIndex = catTx.addStateContractOutput(
        closedMinterIns.state,
        CAT20Proto.toByteString(tokenState)
    )
    nexts.push({
        catTx: catTx,
        preCatTx: closedMinterIns.catTx,
        contract: tokenTaproot.contract,
        state: tokenState,
        contractTaproot: tokenTaproot,
        atOutputIndex: atOutputIndex,
    })
    return {
        catTx: catTx,
        contract: closedMinterIns.contract,
        state: closedMinterIns.state,
        contractTaproot: closedMinterIns.contractTaproot,
        atInputIndex: atInputIndex,
        nexts: nexts,
    }
}

export const getGuardContractInfo = function () {
    const burnGuard = new BurnGuard()
    const transfer = new TransferGuard()
    const contractMap = {
        burn: burnGuard,
        transfer: transfer,
    }
    const guardInfo = new TaprootMastSmartContract(contractMap)
    return guardInfo
}

export async function guardDeloy(
    feeUtxo,
    seckey,
    guardState: GuardConstState,
    guardInfo: TaprootMastSmartContract,
    burn: boolean,
    error: boolean = false
) {
    const catTx = CatTx.create()
    catTx.tx.from(feeUtxo)
    let locking = guardInfo.lockingScript
    if (error) {
        locking = '00000000'
    }
    const atIndex = catTx.addStateContractOutput(
        locking,
        GuardProto.toByteString(guardState)
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: burn
            ? guardInfo.contractTaprootMap.burn.contract
            : guardInfo.contractTaprootMap.transfer.contract,
        state: guardState,
        contractTaproot: burn
            ? guardInfo.contractTaprootMap.burn
            : guardInfo.contractTaprootMap.transfer,
        atOutputIndex: atIndex,
    }
}

export async function deployNoStateContract(
    feeUtxo,
    seckey,
    contractInfo: TaprootSmartContract
) {
    const catTx = CatTx.create()
    catTx.tx.from(feeUtxo)
    const locking = contractInfo.lockingScript
    const atIndex = catTx.addContractOutput(locking)
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: contractInfo.contract,
        state: null,
        contractTaproot: contractInfo,
        atOutputIndex: atIndex,
    }
}
