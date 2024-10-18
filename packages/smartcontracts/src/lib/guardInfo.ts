import { BurnGuard } from '../index'
import { TransferGuard } from '../index'
import { NftBurnGuard } from '../index'
import { NftTransferGuard } from '../index'
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

export const getNftGuardContractInfo = function (): TaprootMastSmartContract {
    const nftBurnGuard = new NftBurnGuard()
    const nftTransfer = new NftTransferGuard()
    const contractMap = {
        burn: nftBurnGuard,
        transfer: nftTransfer,
    }
    const guardInfo = new TaprootMastSmartContract(contractMap)
    return guardInfo
}
