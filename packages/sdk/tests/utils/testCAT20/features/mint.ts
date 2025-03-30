import { Psbt, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ByteString, ChainProvider, ExtPsbt, Int32, markSpent, Signer, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, getTxId } from '../../../../src';
import { CAT20ClosedMinterUtxo } from '../../testCAT20Generater';
import { CAT20Utxo } from '../../../../src/lib/provider';
import { CAT20ClosedMinterCovenant } from '../cat20ClosedMinterCovenant';
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
    minterUtxo: CAT20ClosedMinterUtxo,
    tokenId: string,
    tokenReceiver: ByteString,
    tokenAmount: Int32,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: ExtPsbt;
    cat20Utxo: CAT20Utxo;
    mintTxId: string;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));
    const minterCovenant = new CAT20ClosedMinterCovenant(changeAddress, tokenId, minterUtxo.state).bindToUtxo(
        minterUtxo,
    );

    const token = new CAT20Covenant(minterCovenant.address);
    minterCovenant.state = {
        tokenScript: token.lockingScriptHex,
    };
    const utxos = await utxoProvider.getUtxos(address);

    const mintPsbt = CAT20ClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        minterCovenant,
        tokenReceiver,
        tokenAmount,
        utxos,
        feeRate,
        changeAddress,
        address,
        pubkey,
    );

    const signedMintPsbt = await signer.signPsbt(mintPsbt.toHex(), mintPsbt.psbtOptions());

    await mintPsbt.combine(Psbt.fromHex(signedMintPsbt)).finalizeAllInputs();

    const mintTx = mintPsbt.extractTransaction();
    await chainProvider.broadcast(mintTx.toHex());
    markSpent(utxoProvider, mintTx);
    const cat20Utxo: CAT20Utxo = {
        ...mintPsbt.getStatefulCovenantUtxo(2),
        state: {
            ownerAddr: tokenReceiver,
            amount: tokenAmount,
        },
    };
    return {
        mintTxId: mintTx.getId(),
        mintTx: mintPsbt,
        cat20Utxo: cat20Utxo,
    };
}
