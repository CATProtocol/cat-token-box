import { ContextUtils } from '../../../src/contracts/utils/contextUtils';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('Test ContextUtils', () => {
    it('should checkSHPreimage successfully', () => {
        const shPreimage = {
            nVersion: '02000000',
            nLockTime: '00000000',
            shaPrevouts: '4f8dd3772bb82a156eaffd17e0d423096f948a38d076fcdbffdc94a91c050c96',
            shaSpentAmounts: 'cd4f536a72ad3d9d7138bcf01c8a37d89765d47c3399da48532cd280cf270f45',
            shaSpentScripts: 'ef4b76d3e60758d9c883ddb1c61327e806dc9d7dbdcffcc46273bf3e94c9587a',
            shaSequences: '5ac6a5945f16500911219129984ba8b387a06f24fe383ce4e81a73294065461b',
            shaOutputs: '13b7d710c394f1d81e40a1a20ccb6944bdef49148bc9a24332894770719e1bf7',
            spendType: '02',
            inputIndex: '02000000',
            tapLeafHash: '8c04b2deb702a799486fc9517ccfc20aeac950d2e11a2f0a10a93876335fe381',
            keyVersion: '00',
            codeSepPos: 'ffffffff',
            e_: '0049a5b0798419c7d2f157354a74476b398fe72b79fe084d1a4c97844edd55',
            eLastByte: 0n,
        };
        expect(() => ContextUtils.checkSHPreimage(shPreimage)).to.be.throw('invalid e');
    });
});
