import { Psbt, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ChainProvider, ExtPsbt, Int32, markSpent, Ripemd160, Signer, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { ClosedMinterCat20Meta, CAT20ClosedMinterUtxo, getTxId, toTokenAddress, CAT20Utxo } from '../../../lib/index.js';
import { CAT20ClosedMinterCovenant } from '../../../covenants/index.js';
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
export async function closedMint(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: CAT20ClosedMinterUtxo,
    tokenId: string,
    metadata: ClosedMinterCat20Meta,
    amount: Int32,
    feeRate: number,
): Promise<{
    cat20Utxo: CAT20Utxo;
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

    const minterCovenant = new CAT20ClosedMinterCovenant(
        tokenId,
        address,
        metadata,
        minterUtxo.state,
    ).bindToUtxo(minterUtxo);

    const utxos = await utxoProvider.getUtxos(address);

    const receiver = Ripemd160(toTokenAddress(address))
    const mintPsbt = CAT20ClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        minterCovenant,
        receiver,
        address,
        pubkey,
        amount,
        utxos,
        feeRate,
        address,
    );

    const signedMintPsbt = await signer.signPsbt(mintPsbt.toHex(), mintPsbt.psbtOptions());

    await mintPsbt.combine(Psbt.fromHex(signedMintPsbt)).finalizeAllInputs();

    const mintTx = mintPsbt.extractTransaction();

    await chainProvider.broadcast(mintTx.toHex());
    markSpent(utxoProvider, mintTx);


    const cat20Utxo: CAT20Utxo = {
        ...mintPsbt.getStatefulCovenantUtxo(2),
        state: {
            ownerAddr: receiver,
            amount: amount,
        },
    };
    return {
        cat20Utxo,
        mintTxId: mintTx.getId(),
        mintTx: mintPsbt,
    };
}
