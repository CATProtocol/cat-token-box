import { ByteString } from 'scrypt-ts';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import {
    CAT20Covenant,
    Cat20MinterUtxo,
    Cat20Utxo,
    CatPsbt,
    ChainProvider,
    ProtocolState,
    Signer,
    UtxoProvider,
    getTxId,
    int32,
    markSpent,
} from '../../../../src/index';
import { ClosedMinterCovenant } from '../closedMinterCovenant';

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
    minterUtxo: Cat20MinterUtxo,
    tokenId: string,
    tokenReceiver: ByteString,
    tokenAmount: int32,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: CatPsbt;
    cat20Utxo: Cat20Utxo;
    mintTxId: string;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.utxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));
    const minterCovenant = new ClosedMinterCovenant(changeAddress, tokenId).bindToUtxo({
        txId: minterUtxo.utxo.txId,
        outputIndex: minterUtxo.utxo.outputIndex,
        satoshis: minterUtxo.utxo.satoshis,
    });

    const token = new CAT20Covenant(minterCovenant.address);
    minterCovenant.state = {
        tokenScript: token.lockingScriptHex,
    };
    const utxos = await utxoProvider.getUtxos(address, { maxCnt: 5 });
    const estimatedVSize = ClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        tokenReceiver,
        tokenAmount,
        utxos,
        feeRate,
        changeAddress,
        changeAddress,
        pubkey,
    ).estimateVSize();

    const mintPsbt = ClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        tokenReceiver,
        tokenAmount,
        utxos,
        feeRate,
        changeAddress,
        address,
        pubkey,
        estimatedVSize,
    );

    const signedMintPsbt = await signer.signPsbt(mintPsbt.toHex(), mintPsbt.psbtOptions());

    await mintPsbt.combine(Psbt.fromHex(signedMintPsbt)).finalizeAllInputsAsync();

    const mintTx = mintPsbt.extractTransaction();
    await chainProvider.broadcast(mintTx.toHex());
    markSpent(utxoProvider, mintTx);
    const cat20Utxo: Cat20Utxo = {
        utxo: mintPsbt.getUtxo(2),
        txoStateHashes: mintPsbt.getTxStatesInfo().stateHashes,
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
