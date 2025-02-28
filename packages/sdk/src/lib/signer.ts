export interface PSBTOptions {
    autoFinalized: boolean;
    toSignInputs: ToSignInput[];
}

export interface ToSignInput {
    index: number;
    address?: string;
    publicKey?: string;
    tapLeafHashToSign?: string;
    sighashTypes?: number[];
    disableTweakSigner?: boolean;
    useTweakedSigner?: boolean;
}

type HexString = string;

export interface Signer {
    /** Get address of current signer.  */
    getAddress(): Promise<string>;
    /** Get publicKey of current signer. */
    getPublicKey(): Promise<HexString>;
    /** traverse all inputs that match the current address to sign. */
    signPsbt(psbtHex: HexString, options?: PSBTOptions): Promise<HexString>;
    /** same as signPsbt, but sign multiple PSBTs at once. */
    signPsbts(reqs: { psbtHex: HexString; options?: PSBTOptions }[]): Promise<HexString[]>;
}
