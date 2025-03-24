import { CAT20ClosedMinter } from './contracts/cat20/minters/cat20ClosedMinter';
import { CAT20OpenMinter } from './contracts/cat20/minters/cat20OpenMinter';
import { CAT20 } from './contracts/cat20/cat20';
import { CAT20StateLib } from './contracts/cat20/cat20State';
import { CAT20Guard } from './contracts/cat20/cat20Guard';
import { CAT20GuardStateLib } from './contracts/cat20/cat20GuardState';

import { CAT721ClosedMinter } from './contracts/cat721/minters/cat721ClosedMinter';
import { CAT721OpenMinter } from './contracts/cat721/minters/cat721OpenMinter';
import { CAT721 } from './contracts/cat721/cat721';
import { CAT721StateLib } from './contracts/cat721/cat721State';
import { CAT721Guard } from './contracts/cat721/cat721Guard';
import { CAT721GuardStateLib } from './contracts/cat721/cat721GuardState';

import cat20ClosedMinter from '../artifacts/cat20/minters/cat20ClosedMinter.json';
import cat20OpenMinter from '../artifacts/cat20/minters/cat20OpenMinter.json';
import cat20 from '../artifacts/cat20/cat20.json';
import cat20StateLib from '../artifacts/cat20/cat20State.json';
import cat20Guard from '../artifacts/cat20/cat20Guard.json';
import cat20GuardStateLib from '../artifacts/cat20/cat20GuardState.json';

import cat721ClosedMinter from '../artifacts/cat721/minters/cat721ClosedMinter.json';
import cat721OpenMinter from '../artifacts/cat721/minters/cat721OpenMinter.json';
import cat721 from '../artifacts/cat721/cat721.json';
import cat721StateLib from '../artifacts/cat721/cat721State.json';
import cat721Guard from '../artifacts/cat721/cat721Guard.json';
import cat721GuardStateLib from '../artifacts/cat721/cat721GuardState.json';

export function loadArtifacts() {
    // cat20 minter
    CAT20ClosedMinter.loadArtifact(cat20ClosedMinter);
    CAT20OpenMinter.loadArtifact(cat20OpenMinter);
    // cat20
    CAT20.loadArtifact(cat20);
    CAT20StateLib.loadArtifact(cat20StateLib);
    CAT20Guard.loadArtifact(cat20Guard);
    CAT20GuardStateLib.loadArtifact(cat20GuardStateLib);
    // cat721 minter
    CAT721ClosedMinter.loadArtifact(cat721ClosedMinter);
    CAT721OpenMinter.loadArtifact(cat721OpenMinter);
    // cat721
    CAT721.loadArtifact(cat721);
    CAT721StateLib.loadArtifact(cat721StateLib);
    CAT721Guard.loadArtifact(cat721Guard);
    CAT721GuardStateLib.loadArtifact(cat721GuardStateLib);
}
