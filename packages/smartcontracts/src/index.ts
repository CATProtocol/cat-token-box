import { join } from 'path'
import { BurnGuard } from './contracts/token/burnGuard'
import { ClosedMinter } from './contracts/token/closedMinter'
import { OpenMinter } from './contracts/token/openMinter'
import { CAT20 } from './contracts/token/cat20'
import { TransferGuard } from './contracts/token/transferGuard'
import { OpenMinterV2 } from './contracts/token/openMinterV2'

import closedMinter from '../artifacts/contracts/token/closedMinter.json'
import openMinter from '../artifacts/contracts/token/openMinter.json'
import openMinterV2 from '../artifacts/contracts/token/openMinterV2.json'
import cat20 from '../artifacts/contracts/token/cat20.json'
import burnGuard from '../artifacts/contracts/token/burnGuard.json'
import transferGuard from '../artifacts/contracts/token/transferGuard.json'

(() => {
    ClosedMinter.loadArtifact(closedMinter)
    OpenMinter.loadArtifact(openMinter)
    OpenMinterV2.loadArtifact(openMinterV2)
    CAT20.loadArtifact(cat20)
    BurnGuard.loadArtifact(burnGuard)
    TransferGuard.loadArtifact(transferGuard)
})()
export * from './contracts/token/closedMinter'
export * from './contracts/token/cat20'
export * from './contracts/token/burnGuard'
export * from './contracts/token/transferGuard'
export * from './contracts/token/cat20Proto'
export * from './contracts/token/closedMinterProto'
export * from './contracts/token/guardProto'
export * from './contracts/token/openMinter'
export * from './contracts/token/openMinterV2'
export * from './contracts/token/openMinterProto'
export * from './contracts/token/openMinterV2Proto'
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
