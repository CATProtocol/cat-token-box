import { BurnGuard } from '../index'
import { TransferGuard } from '../index'
import { TaprootMastSmartContract } from './catTx'

export const getGuardContractInfo = function (): TaprootMastSmartContract {
    const burnGuard = new BurnGuard()
    const transfer = new TransferGuard()
    const contractMap = {
        burn: burnGuard,
        transfer: transfer,
    }
    const guardInfo = new TaprootMastSmartContract(contractMap)
    return guardInfo
}
