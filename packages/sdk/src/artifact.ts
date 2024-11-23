import { BurnGuard } from './contracts/token/burnGuard'
import { ClosedMinter } from './contracts/token/closedMinter'
import { OpenMinter } from './contracts/token/openMinter'
import { CAT20 } from './contracts/token/cat20'
import { TransferGuard } from './contracts/token/transferGuard'
import { OpenMinterV2 } from './contracts/token/openMinterV2'
import { NftClosedMinter } from './contracts/nft/nftClosedMinter'
import { NftParallelClosedMinter } from './contracts/nft/nftParallelClosedMinter'
import { NftOpenMinter } from './contracts/nft/nftOpenMinter'
import { CAT721 } from './contracts/nft/cat721'
import { NftTransferGuard } from './contracts/nft/nftTransferGuard'
import { NftBurnGuard } from './contracts/nft/nftBurnGuard'

import closedMinter from '../artifacts/contracts/token/closedMinter.json'
import openMinter from '../artifacts/contracts/token/openMinter.json'
import openMinterV2 from '../artifacts/contracts/token/openMinterV2.json'
import cat20 from '../artifacts/contracts/token/cat20.json'
import burnGuard from '../artifacts/contracts/token/burnGuard.json'
import transferGuard from '../artifacts/contracts/token/transferGuard.json'


import nftClosedMinter from '../artifacts/contracts/nft/nftClosedMinter.json'
import nftParallelClosedMinter from '../artifacts/contracts/nft/nftParallelClosedMinter.json'
import nftOpenMinter from '../artifacts/contracts/nft/nftOpenMinter.json'
import cat721 from '../artifacts/contracts/nft/cat721.json'
import nftTransferGuard from '../artifacts/contracts/nft/nftTransferGuard.json'
import nftBurnGuard from '../artifacts/contracts/nft/nftBurnGuard.json'

export function loadArtifacts() {

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
    NftParallelClosedMinter.loadArtifact(nftParallelClosedMinter)
    NftOpenMinter.loadArtifact(nftOpenMinter)
    // nft
    CAT721.loadArtifact(cat721)
    NftBurnGuard.loadArtifact(nftBurnGuard)
    NftTransferGuard.loadArtifact(nftTransferGuard)
}