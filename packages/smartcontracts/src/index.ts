import { join } from 'path'
import { BurnGuard } from './contracts/token/burnGuard'
import { ClosedMinter } from './contracts/token/closedMinter'
import { OpenMinter } from './contracts/token/openMinter'
import { CAT20 } from './contracts/token/cat20'
import { TransferGuard } from './contracts/token/transferGuard'
(() => {
    ClosedMinter.loadArtifact(
        join(__dirname, '..', 'artifacts/contracts/token/closedMinter.json')
    )
    OpenMinter.loadArtifact(
        join(__dirname, '..', 'artifacts/contracts/token/openMinter.json')
    )
    CAT20.loadArtifact(
        join(__dirname, '..', 'artifacts/contracts/token/cat20.json')
    )
    BurnGuard.loadArtifact(
        join(__dirname, '..', 'artifacts/contracts/token/burnGuard.json')
    )
    TransferGuard.loadArtifact(
        join(__dirname, '..', 'artifacts/contracts/token/transferGuard.json')
    )
})()
export * from './contracts/token/closedMinter'
export * from './contracts/token/cat20'
export * from './contracts/token/burnGuard'
export * from './contracts/token/transferGuard'
export * from './contracts/token/cat20Proto'
export * from './contracts/token/closedMinterProto'
export * from './contracts/token/guardProto'
export * from './contracts/token/openMinter'
export * from './contracts/token/openMinterProto'
export * from './contracts/utils/txUtil'
export * from './contracts/utils/txProof'
export * from './contracts/utils/stateUtils'
export * from './contracts/utils/backtrace'
export * from './contracts/utils/sigHashUtils'
export * from './lib/state'
export * from './lib/proof'
export * from './lib/txTools'
export * from './lib/commit'
export * from './lib/guardInfo'
