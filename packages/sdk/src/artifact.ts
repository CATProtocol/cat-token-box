import { CAT20ClosedMinter } from './contracts/cat20/minters/cat20ClosedMinter';
import { CAT20OpenMinter } from './contracts/cat20/minters/cat20OpenMinter';
import { CAT20 } from './contracts/cat20/cat20';
import { CAT20StateLib } from './contracts/cat20/cat20State';
import { CAT20Guard } from './contracts/cat20/cat20Guard';
import { CAT20GuardStateLib } from './contracts/cat20/cat20GuardState';

import cat20ClosedMinter from '../artifacts/cat20/minters/cat20ClosedMinter.json';
import cat20OpenMinter from '../artifacts/cat20/minters/cat20OpenMinter.json';
import cat20 from '../artifacts/cat20/cat20.json';
import cat20StateLib from '../artifacts/cat20/cat20State.json';
import cat20Guard from '../artifacts/cat20/cat20Guard.json';
import cat20GuardStateLib from '../artifacts/cat20/cat20GuardState.json';

export function loadArtifacts() {
    // cat20 minter
    CAT20ClosedMinter.loadArtifact(cat20ClosedMinter);
    CAT20OpenMinter.loadArtifact(cat20OpenMinter);
    // cat20
    CAT20.loadArtifact(cat20);
    CAT20StateLib.loadArtifact(cat20StateLib);
    CAT20Guard.loadArtifact(cat20Guard);
    CAT20GuardStateLib.loadArtifact(cat20GuardStateLib);
}
