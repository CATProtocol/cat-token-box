import { ClosedMinter } from './contracts/token/minters/closedMinter';
import { OpenMinter } from './contracts/token/minters/openMinter';
import { CAT20 } from './contracts/token/cat20';
import { Guard } from './contracts/token/guard';
import { NftClosedMinter } from './contracts/nft/minters/nftClosedMinter';
import { NftParallelClosedMinter } from './contracts/nft/minters/nftParallelClosedMinter';
import { NftOpenMinter } from './contracts/nft/minters/nftOpenMinter';
import { CAT721 } from './contracts/nft/cat721';
import { NftGuard } from './contracts/nft/nftGuard';

import closedMinter from '../artifacts/token/minters/closedMinter.json';
import openMinter from '../artifacts/token/minters/openMinter.json';
import cat20 from '../artifacts/token/cat20.json';
import guard from '../artifacts/token/guard.json';

import nftClosedMinter from '../artifacts/nft/minters/nftClosedMinter.json';
import nftParallelClosedMinter from '../artifacts/nft/minters/nftParallelClosedMinter.json';
import nftOpenMinter from '../artifacts/nft/minters/nftOpenMinter.json';
import cat721 from '../artifacts/nft/cat721.json';
import nftGuard from '../artifacts/nft/nftGuard.json';

export function loadArtifacts() {
    // token minter
    ClosedMinter.loadArtifact(closedMinter);
    OpenMinter.loadArtifact(openMinter);
    // token
    CAT20.loadArtifact(cat20);
    Guard.loadArtifact(guard);
    // nft minter
    NftClosedMinter.loadArtifact(nftClosedMinter);
    NftParallelClosedMinter.loadArtifact(nftParallelClosedMinter);
    NftOpenMinter.loadArtifact(nftOpenMinter);
    // nft
    CAT721.loadArtifact(cat721);
    NftGuard.loadArtifact(nftGuard);
}
