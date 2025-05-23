import { Psbt, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ChainProvider, ExtPsbt, markSpent, Ripemd160, Signer, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { OpenMinterCat20Meta, CAT20OpenMinterUtxo, getTxId } from '../../../lib/index.js';
import { CAT20OpenMinterState } from '../../../contracts/index.js';
import { CAT20OpenMinterCovenant } from '../../../covenants/index.js';

/**
 * Mint CAT20 tokens in a single transaction.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterUtxo an UTXO that contains the minter of the CAT20 token
 * @param tokenId the id of the CAT20 token
 * @param metadata the metadata of the CAT20 token
 * @param tokenReceiver the recipient's address of the newly minted tokens
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @param feeRate the fee rate for constructing transactions
 * @returns the mint transaction
 */
export async function mint(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: CAT20OpenMinterUtxo,
    tokenId: string,
    metadata: OpenMinterCat20Meta,
    tokenReceiver: Ripemd160,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: ExtPsbt;
    mintTxId: string;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));

    const minterCovenant = new CAT20OpenMinterCovenant(
        tokenId,
        metadata,
        minterUtxo.state as CAT20OpenMinterState,
    ).bindToUtxo(minterUtxo);

    const utxos = await utxoProvider.getUtxos(address);

    const mintPsbt = CAT20OpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        minterCovenant,
        tokenReceiver,
        utxos,
        feeRate,
        changeAddress,
        address,
        metadata.preminerAddr ? pubkey : undefined,
    );

    const signedMintPsbt = await signer.signPsbt(mintPsbt.toHex(), mintPsbt.psbtOptions());

    await mintPsbt.combine(Psbt.fromHex(signedMintPsbt)).finalizeAllInputs();

    const mintTx = mintPsbt.extractTransaction();

    await chainProvider.broadcast(mintTx.toHex());
    markSpent(utxoProvider, mintTx);
    return {
        mintTxId: mintTx.getId(),
        mintTx: mintPsbt,
    };
}
