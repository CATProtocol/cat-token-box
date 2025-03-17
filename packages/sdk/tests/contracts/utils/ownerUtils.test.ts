import { hash160 } from '@scrypt-inc/scrypt-ts-btc';
import { OwnerUtils } from '../../../src/contracts/utils/ownerUtils';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('Test OwnerUtils', () => {
    it('should toLockingScript successfully', () => {
        {
            const pubKeyPrefix = '';
            const xOnlyPubKey = '0000000000000000000000000000000000000000000000000000000000000000';
            expect(OwnerUtils.toLockingScript(pubKeyPrefix, xOnlyPubKey)).to.be.equal('5120' + xOnlyPubKey);
        }
        {
            const pubKeyPrefix = '02';
            const xOnlyPubKey = '0000000000000000000000000000000000000000000000000000000000000000';
            expect(OwnerUtils.toLockingScript(pubKeyPrefix, xOnlyPubKey)).to.be.equal(
                '0014' + hash160(pubKeyPrefix + xOnlyPubKey),
            );
        }
        {
            const pubKeyPrefix = '03';
            const xOnlyPubKey = '0000000000000000000000000000000000000000000000000000000000000000';
            expect(OwnerUtils.toLockingScript(pubKeyPrefix, xOnlyPubKey)).to.be.equal(
                '0014' + hash160(pubKeyPrefix + xOnlyPubKey),
            );
        }
    });

    it('should checkPubKey successfully', () => {
        {
            const pubKeyPrefix = '';
            const xOnlyPubKey = '0000000000000000000000000000000000000000000000000000000000000000';
            expect(OwnerUtils.checkPubKey(pubKeyPrefix, xOnlyPubKey)).to.be.undefined;
        }
        {
            const pubKeyPrefix = '02';
            const xOnlyPubKey = '0000000000000000000000000000000000000000000000000000000000000000';
            expect(OwnerUtils.checkPubKey(pubKeyPrefix, xOnlyPubKey)).to.be.undefined;
        }
        {
            const pubKeyPrefix = '03';
            const xOnlyPubKey = '0000000000000000000000000000000000000000000000000000000000000000';
            expect(OwnerUtils.checkPubKey(pubKeyPrefix, xOnlyPubKey)).to.be.undefined;
        }
    });
});
