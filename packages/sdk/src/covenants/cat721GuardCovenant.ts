import { SupportedNetwork, StatefulCovenant } from '@scrypt-inc/scrypt-ts-btc';
import { CAT721GuardConstState } from '../contracts/cat721/types';
import { CAT721Guard } from '../contracts/cat721/cat721Guard';

export class CAT721GuardCovenant extends StatefulCovenant<CAT721GuardConstState> {
    constructor(state?: CAT721GuardConstState, network?: SupportedNetwork) {
        super(
            state,
            [
                {
                    contract: new CAT721Guard(),
                },
            ],
            {
                network,
            },
        );
    }
}
