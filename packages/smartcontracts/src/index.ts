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

import { NftClosedMinter } from './contracts/nft/nftClosedMinter'
import { NftOpenMinter } from './contracts/nft/nftOpenMinter'
import { CAT721 } from './contracts/nft/cat721'
import { NftTransferGuard } from './contracts/nft/nftTransferGuard'
import { NftBurnGuard } from './contracts/nft/nftBurnGuard'

import nftClosedMinter from '../artifacts/contracts/nft/nftClosedMinter.json'
import nftOpenMinter from '../artifacts/contracts/nft/nftOpenMinter.json'
import cat721 from '../artifacts/contracts/nft/cat721.json'
import nftTransferGuard from '../artifacts/contracts/nft/nftTransferGuard.json'
import nftBurnGuard from '../artifacts/contracts/nft/nftBurnGuard.json'
;(() => {
    // token minter
    ClosedMinter.loadArtifact(closedMinter)
    OpenMinter.loadArtifact(openMinter)
    OpenMinterV2.loadArtifact(openMinterV2)
    // token
    CAT20.loadArtifact(cat20)
    BurnGuard.loadArtifact(burnGuard)
    TransferGuard.loadArtifact(transferGuard)
    // nft minter
    NftClosedMinter.loadArtifact(nftClosedMinter)
    NftOpenMinter.loadArtifact(nftOpenMinter)
    // nft
    CAT721.loadArtifact(cat721)
    NftBurnGuard.loadArtifact(nftBurnGuard)
    NftTransferGuard.loadArtifact(nftTransferGuard)
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
export * from './contracts/nft/nftClosedMinter'
export * from './contracts/nft/nftOpenMinter'
export * from './contracts/nft/nftClosedMinterProto'
export * from './contracts/nft/nftOpenMinterProto'
export * from './contracts/nft/nftOpenMinterMerkleTree'
export * from './contracts/nft/cat721'
export * from './contracts/nft/cat721Proto'
export * from './contracts/nft/nftBurnGuard'
export * from './contracts/nft/nftTransferGuard'
export * from './contracts/nft/nftGuardProto'
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
export * from './lib/btc'
export * from './lib/catTx'
