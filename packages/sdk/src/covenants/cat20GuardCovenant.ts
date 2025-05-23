import { SupportedNetwork, StatefulCovenant } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Guard, CAT20GuardConstState } from '../contracts/index.js';

export class CAT20GuardCovenant extends StatefulCovenant<CAT20GuardConstState> {
    constructor(state?: CAT20GuardConstState, network?: SupportedNetwork) {
        const cat20Guard = new CAT20Guard();
        if (state) {
            cat20Guard.state = state;
        }
        super(
            state,
            [
                {
                    contract: cat20Guard,
                },
            ],
            {
                network,
            },
        );
    }
}
