import { Postage } from '../../../';
import { getCatNFTCommitScript } from '../../../lib/commit';
import { ExtPsbt, hexToUint8Array, Signer, UTXO } from '@scrypt-inc/scrypt-ts-btc';
import { catToXOnly, isP2TR, scriptToP2tr } from '../../../lib/utils';

export async function createNft(
    wallet: Signer,
    nft: {
        contentType: string;
        contentBody: string;
        nftmetadata: object;
    },
    feeUtxos: UTXO[],
    feeRate: number,
): Promise<{
    commitPsbt: ExtPsbt;
    cblock: Uint8Array;
    nftCommitScript: Uint8Array;
}> {
    const pubkey = await wallet.getPublicKey();
    const address = await wallet.getAddress();
    const { nftmetadata, contentType, contentBody } = nft;
    const nftCommitScript = getCatNFTCommitScript(
        catToXOnly(pubkey, isP2TR(address)),
        nftmetadata,
        contentBody
            ? {
                  type: contentType,
                  body: contentBody,
              }
            : undefined,
    );

    const lockingScript = hexToUint8Array(nftCommitScript);
    const { p2trLockingScript: p2tr, cblock } = scriptToP2tr(lockingScript);

    const psbt = new ExtPsbt();
    psbt.spendUTXO(feeUtxos)
        .addOutput({
            script: hexToUint8Array(p2tr),
            value: BigInt(Postage.NFT_POSTAGE),
        })
        .change(address, feeRate)
        .seal();

    return {
        cblock: hexToUint8Array(cblock),
        commitPsbt: psbt,
        nftCommitScript: lockingScript,
    };
}
