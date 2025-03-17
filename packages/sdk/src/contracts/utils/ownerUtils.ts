import {
    assert,
    ByteString,
    hash160,
    len,
    method,
    OWNER_ADDR_CONTRACT_HASH_BYTE_LEN,
    OWNER_ADDR_P2TR_BYTE_LEN,
    OWNER_ADDR_P2WPKH_BYTE_LEN,
    SmartContractLib,
    toByteString,
    X_ONLY_PUBKEY_BYTE_LEN,
} from '@scrypt-inc/scrypt-ts-btc';

export class OwnerUtils extends SmartContractLib {
    /**
     * Convert public key to
     * - P2TR locking script if pubKeyPrefix is an empty ByteString
     * - P2WPKH locking script if pubKeyPrefix is 0x02 or 0x03
     * @param pubKeyPrefix public key prefix, could be empty, 0x02, or 0x03 here
     * @param xOnlyPubKey the x coordinate of public key
     * @returns locking script
     */
    @method()
    static toLockingScript(pubKeyPrefix: ByteString, xOnlyPubKey: ByteString): ByteString {
        OwnerUtils.checkPubKey(pubKeyPrefix, xOnlyPubKey);
        return pubKeyPrefix == toByteString('')
            ? toByteString('5120') + xOnlyPubKey // P2TR
            : toByteString('0014') + hash160(pubKeyPrefix + xOnlyPubKey); // P2WPKH
    }

    /**
     * Check if the user public key matches the owner's address
     * @param pubKeyPrefix public key prefix, could be empty, 0x02, or 0x03 here
     * @param xOnlyPubKey the x coordinate of public key
     * @param ownerAddr owner address
     */
    @method()
    static checkUserOwner(pubKeyPrefix: ByteString, xOnlyPubKey: ByteString, ownerAddr: ByteString): void {
        assert(OwnerUtils.toLockingScript(pubKeyPrefix, xOnlyPubKey) == ownerAddr);
    }

    @method()
    static checkPubKey(pubKeyPrefix: ByteString, xOnlyPubKey: ByteString): void {
        assert(
            pubKeyPrefix == toByteString('') ||
                pubKeyPrefix == toByteString('02') ||
                pubKeyPrefix == toByteString('03'),
        );
        assert(len(xOnlyPubKey) == X_ONLY_PUBKEY_BYTE_LEN);
    }

    @method()
    static checkOwnerAddr(ownerAddr: ByteString): void {
        const addrLen = len(ownerAddr);
        assert(
            addrLen == OWNER_ADDR_P2WPKH_BYTE_LEN || // P2WPKH locking script
                addrLen == OWNER_ADDR_P2TR_BYTE_LEN || // P2TR locking script
                addrLen == OWNER_ADDR_CONTRACT_HASH_BYTE_LEN, // contract script hash
        );
    }
}
