import { ByteString, Int32, PubKey, Sig } from '@scrypt-inc/scrypt-ts-btc';

// args to unlock a token UTXO or a nft UTXO
export type ContractUnlockArgs = {
    // user spend args
    userPubKeyPrefix: ByteString;
    userXOnlyPubKey: PubKey;
    userSig: Sig;
    // contract spend arg
    contractInputIndexVal: Int32;
};
