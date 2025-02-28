import { ByteString, toByteString } from 'scrypt-ts';
import { Covenant } from '../lib/covenant';
import { InputContext, SubContractCall } from '../lib/catPsbt';
import { SupportedNetwork } from '../lib/constants';
import { PushTx } from '../contracts/pushTx/pushTx';

export class PushTxCovenant extends Covenant {
    // locked PushTx artifact md5
    static readonly LOCKED_ASM_VERSION = '04b7de839281b2707ef3f5bbcef0fa55';

    constructor(network?: SupportedNetwork) {
        super(
            [
                {
                    contract: new PushTx(),
                },
            ],
            {
                lockedAsmVersion: PushTxCovenant.LOCKED_ASM_VERSION,
                network,
            },
        );
        this.state = undefined;
    }

    serializedState(): ByteString {
        return toByteString('');
    }

    unlock(inputIndex: number, inputCtxs: Map<number, InputContext>): SubContractCall {
        return {
            method: 'unlock',
            argsBuilder: this.unlockArgsBuilder(inputIndex, inputCtxs),
        };
    }

    private unlockArgsBuilder(inputIndex: number, inputCtxs: Map<number, InputContext>) {
        const inputCtx = inputCtxs.get(inputIndex);
        if (!inputCtx) {
            throw new Error('Input context is not available');
        }

        return () => {
            const { shPreimage } = inputCtx;

            const args = [];
            args.push(shPreimage); // shPreimage
            return args;
        };
    }
}
