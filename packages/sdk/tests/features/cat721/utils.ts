import { readArtifact } from '../../utils/index';
import {
    CAT721ClosedMinter,
    CAT721,
    CAT721StateLib,
    CAT721Guard,
    CAT721GuardStateLib,
    CAT721OpenMinter,
} from '@cat-protocol/cat-sdk-v2';
export const loadAllArtifacts = function () {
    //
    CAT721ClosedMinter.loadArtifact(readArtifact('artifacts/cat721/minters/cat721ClosedMinter.json'));
    CAT721OpenMinter.loadArtifact(readArtifact('artifacts/cat721/minters/cat721OpenMinter.json'));
    //
    CAT721.loadArtifact(readArtifact('artifacts/cat721/cat721.json'));
    CAT721StateLib.loadArtifact(readArtifact('artifacts/cat721/cat721State.json'));
    //
    CAT721Guard.loadArtifact(readArtifact('artifacts/cat721/cat721Guard.json'));
    CAT721GuardStateLib.loadArtifact(readArtifact('artifacts/cat721/cat721GuardState.json'));
};
