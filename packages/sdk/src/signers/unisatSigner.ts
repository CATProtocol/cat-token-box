import { PSBTOptions, Signer } from '../lib/signer';

interface Window {
    X: number;
    scrollY: number;
  }
  
declare const window: Window & typeof globalThis;

type HexString = string;

export interface UnisatAPI {
	getAccounts: () => Promise<string[]>
	requestAccounts: () => Promise<string[]>
	getPublicKey: () => Promise<string>
    signPsbt(psbtHex: HexString, options?: PSBTOptions): Promise<HexString>;
    signPsbts(psbtHexs: HexString[], options?: PSBTOptions[]): Promise<HexString[]>;
}

export class UnisatSigner implements Signer {
    private _unisat: UnisatAPI;

    constructor(unisat: UnisatAPI) {
        this._unisat = unisat
    }

    getUnisatAPI(): UnisatAPI {
        const unisat = this._unisat || window['unisat'];
        if(typeof unisat === 'undefined') {
			throw new Error('unisat not install!');
		}

        return unisat;
    }

    async getAddress(): Promise<string> {
        const accounts = await this.getUnisatAPI().getAccounts();
        return accounts[0]
    }

    async getPublicKey(): Promise<string> {
        return this.getUnisatAPI().getPublicKey();
    }

    async signPsbt(psbtHex: string, options?: PSBTOptions): Promise<string> {
        return this.getUnisatAPI().signPsbt(psbtHex, options)
    }

    signPsbts(
        reqs: { psbtHex: string; options?: PSBTOptions }[],
    ): Promise<string[]> {
		const options: PSBTOptions[] = reqs.filter(option => typeof option === 'object').map(req => (req.options as PSBTOptions));
		return this.getUnisatAPI().signPsbts(reqs.map(req => req.psbtHex), options);
    }
}
