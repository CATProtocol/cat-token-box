import { SupportedNetwork, StatefulCovenant } from '@scrypt-inc/scrypt-ts-btc';
import { CAT721GuardConstState, CAT721Guard } from '../contracts/index.js';

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
