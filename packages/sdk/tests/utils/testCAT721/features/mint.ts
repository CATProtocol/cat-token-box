import { Psbt, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ByteString, ChainProvider, ExtPsbt, Int32, markSpent, Signer, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { CAT721Utxo, getTxId} from '@cat-protocol/cat-sdk-v2';
import { CAT721ClosedMinterCovenant, CAT721ClosedMinterUtxo } from '../cat721ClosedMinterCovenant';

export async function mint(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: CAT721ClosedMinterUtxo,
    collectionId: string,
    max: Int32,
    nftReceiver: ByteString,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: ExtPsbt;
    cat721Utxo: CAT721Utxo;
    minterUtxo: CAT721ClosedMinterUtxo;
    mintTxId: string;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));
    const minterCovenant = new CAT721ClosedMinterCovenant(
        changeAddress,
        collectionId,
        max,
        minterUtxo.state,
    ).bindToUtxo(minterUtxo);

    const utxos = await utxoProvider.getUtxos(address);

    const {
        mintTx: mintPsbt,
        minterUtxo: nexMinterUtxo,
        cat721Utxo,
    } = CAT721ClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        minterCovenant,
        nftReceiver,
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
    return {
        mintTxId: mintTx.getId(),
        mintTx: mintPsbt,
        cat721Utxo: cat721Utxo,
        minterUtxo: nexMinterUtxo,
    };
}
