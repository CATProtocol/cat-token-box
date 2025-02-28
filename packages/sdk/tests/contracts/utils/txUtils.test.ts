import { FixedArray, sha256 } from 'scrypt-ts';
import { TxUtils } from '../../../src/contracts/utils/txUtils';
import { ContextUtils } from '../../../src/contracts/utils/contextUtils';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { TxOut } from '../../../src';

use(chaiAsPromised);

describe('Test TxUtils', () => {
    describe('When merge ctx', () => {
        it('should mergePrevouts successfully', async () => {
            {
                const prevouts = [
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '',
                    '',
                    '',
                    '',
                    '',
                ] as FixedArray<string, 6>;
                const response = TxUtils.mergePrevouts(prevouts);
                expect(response.prevouts).to.be.length(36 * 1 * 2);
                expect(response.inputCount).to.be.equal(1n);
            }

            {
                const prevouts = [
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                ] as FixedArray<string, 6>;
                const response = TxUtils.mergePrevouts(prevouts);
                expect(response.prevouts).to.be.length(36 * 6 * 2);
                expect(response.inputCount).to.be.equal(6n);
            }
            {
                const prevouts = [
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '000000000000000000000000000000000000000000000000000000000000000000000000',
                    '',
                ] as FixedArray<string, 6>;
                const response = TxUtils.mergePrevouts(prevouts);
                expect(response.prevouts).to.be.length(36 * 5 * 2);
                expect(response.inputCount).to.be.equal(5n);
            }
        });

        it('should mergePrevouts failed, if elements that are not equal to 0 or 36', async () => {
            const prevouts = [
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '0000',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
            ] as FixedArray<string, 6>;
            expect(() => TxUtils.mergePrevouts(prevouts)).to.throw('prevouts invalid length');
        });

        it('should mergePrevouts failed, Elements of length 0 cannot be followed by non-empty data', async () => {
            const prevouts = [
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '',
                '',
                '',
                '',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
            ] as FixedArray<string, 6>;
            expect(() => TxUtils.mergePrevouts(prevouts)).to.throw('invalid prevout list');
        });

        it('should mergeSpentScripts successfully', async () => {
            {
                const spentScripts = [
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                ] as FixedArray<string, 6>;
                expect(TxUtils.mergeSpentScripts(spentScripts, 6n)).to.be.length(35 * 6 * 2);
            }
            {
                const spentScripts = [
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '',
                ] as FixedArray<string, 6>;
                expect(TxUtils.mergeSpentScripts(spentScripts, 5n)).to.be.length(35 * 5 * 2);
            }
            {
                const spentScripts = [
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c64585',
                    '5120fdc45725edcc1023ae2a36f5e67485ba1bb1cdc290b92421f629cf1c24c6',
                    '',
                ] as FixedArray<string, 6>;
                expect(TxUtils.mergeSpentScripts(spentScripts, 5n)).to.be.length(35 * 5 * 2 - 4);
            }
        });

        it('should mergeSpentScripts failed, Elements of length 0 cannot be followed by non-empty data', async () => {
            const prevouts = [
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '',
                '',
                '',
                '',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
            ] as FixedArray<string, 6>;
            expect(() => TxUtils.mergeSpentScripts(prevouts, 1n)).to.throw('invalid spent script list');
        });

        it('should mergeSpentScripts failed, number of inputs mismatch', async () => {
            const prevouts = [
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '000000000000000000000000000000000000000000000000000000000000000000000000',
                '',
                '',
                '',
                '',
            ] as FixedArray<string, 6>;
            expect(() => TxUtils.mergeSpentScripts(prevouts, 1n)).to.throw('invalid spent script list');
        });

        it('should mergeSpentAmounts successfully', async () => {
            // mergeSpentAmounts
            {
                const spentAmounts = [
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                ] as FixedArray<string, 6>;
                expect(TxUtils.mergeSpentAmounts(spentAmounts, 6n)).to.be.length(8 * 6 * 2);
            }
        });

        it('should mergeSpentAmounts failed, if spent amount byte not equal 8', async () => {
            // mergeSpentAmounts
            {
                const spentAmounts = [
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '',
                    '0000000000000000',
                    '0000000000000000',
                ] as FixedArray<string, 6>;
                expect(() => TxUtils.mergeSpentAmounts(spentAmounts, 6n)).to.throw(
                    'spent amount byte length must be 8',
                );
            }
        });

        it('should mergeSpentAmounts failed, if more than inputCount bytes is not empty', async () => {
            // mergeSpentAmounts
            {
                const spentAmounts = [
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                    '0000000000000000',
                ] as FixedArray<string, 6>;
                expect(() => TxUtils.mergeSpentAmounts(spentAmounts, 4n)).to.throw('invalid spent amount list');
            }
        });

        it('should checkSpentAmountsCtx successfully', async () => {
            const spentAmounts = [
                '0000000000000000',
                '0000000000000000',
                '0000000000000000',
                '0000000000000000',
                '0000000000000000',
                '0000000000000000',
            ] as FixedArray<string, 6>;
            const shaSpentAmounts = sha256(spentAmounts.join(''));
            expect(ContextUtils.checkSpentAmountsCtx(spentAmounts, shaSpentAmounts, 6n)).to.be.equal(undefined);
        });
    });

    describe('When buildChangeOutput', () => {
        it('should successfully, if have change', async () => {
            const txOutput: TxOut = {
                satoshis: '0100000000000000',
                script: '51200000000000000000000000000000000000000000000000000000000000000000',
            };
            const expected = '01000000000000002251200000000000000000000000000000000000000000000000000000000000000000';
            expect(TxUtils.buildChangeOutput(txOutput)).to.be.equal(expected);
        });
        it("should successfully, if haven't change", async () => {
            const txOutput: TxOut = {
                satoshis: TxUtils.ZERO_SATS,
                script: '',
            };
            const expected = '';
            expect(TxUtils.buildChangeOutput(txOutput)).to.be.equal(expected);
        });
    });
});
