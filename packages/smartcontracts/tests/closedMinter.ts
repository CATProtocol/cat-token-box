import { ClosedMinter } from '../src/contracts/token/closedMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../src/lib/catTx'
import { CAT20Proto, CAT20State } from '../src/contracts/token/cat20Proto'

export type GetTokenScript = (minterScript: string) => Promise<string>

export async function closedMinterDeploy(
    seckey,
    genesisUtxo,
    closedMinter: ClosedMinter,
    getTokenScript: GetTokenScript
): Promise<ContractIns<string>> {
    const closedMinterTaproot = TaprootSmartContract.create(closedMinter)
    const tokenScript = await getTokenScript(
        closedMinterTaproot.lockingScriptHex
    )
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
    contractIns: ContractIns<string>,
    tokenState: CAT20State,
    increase: boolean
): Promise<ContractCallResult<string>> {
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    const nexts: ContractIns<string>[] = []
    if (increase) {
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.contractTaproot.lockingScript,
            contractIns.state
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            state: contractIns.state,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    catTx.addStateContractOutput(
        contractIns.state,
        CAT20Proto.toByteString(tokenState)
    )
    return {
        catTx: catTx,
        contract: contractIns.contract,
        state: contractIns.state,
        contractTaproot: contractIns.contractTaproot,
        atInputIndex: atInputIndex,
        nexts: nexts,
    }
}
