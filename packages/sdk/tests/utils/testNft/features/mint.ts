import { ByteString } from 'scrypt-ts';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import {
    Cat721Utxo,
    Cat721ClosedMinterUtxo,
    CatPsbt,
    ChainProvider,
    ProtocolState,
    Signer,
    UtxoProvider,
    getTxId,
    markSpent,
} from '../../../../src/index';
import { NftClosedMinterCovenant } from '../nftClosedMinterCovenant';

/**
 * Mint CAT721 nfts in a single transaction.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterUtxo an UTXO that contains the minter of the CAT20 token
 * @param collectionId the id of the CAT20 token
 * @param metadata the metadata of the CAT20 token
 * @param nftReceiver the recipient's address of the newly minted tokens
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @param feeRate the fee rate for constructing transactions
 * @returns the mint transaction
 */
export async function mint(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: Cat721ClosedMinterUtxo,
    collectionId: string,
    nftReceiver: ByteString,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: CatPsbt;
    cat721Utxo: Cat721Utxo;
    mintTxId: string;
    minterUtxo: Cat721ClosedMinterUtxo;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.utxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));
    const minterCovenant = new NftClosedMinterCovenant(changeAddress, collectionId).bindToUtxo({
        txId: minterUtxo.utxo.txId,
        outputIndex: minterUtxo.utxo.outputIndex,
        satoshis: minterUtxo.utxo.satoshis,
    });

    minterCovenant.state = minterUtxo.state;
    const localId = minterUtxo.state.nextLocalId;
    const utxos = await utxoProvider.getUtxos(address, { maxCnt: 5 });
    const estimatedVSize = NftClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        nftReceiver,
        localId,
        utxos,
        feeRate,
        changeAddress,
        changeAddress,
        pubkey,
    ).mintTx.estimateVSize();

    const { mintTx: mintPsbt, nextMinter } = NftClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        nftReceiver,
        localId,
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
    const cat721Utxo: Cat721Utxo = {
        utxo: mintPsbt.getUtxo(2),
        txoStateHashes: mintPsbt.getTxStatesInfo().stateHashes,
        state: {
            ownerAddr: nftReceiver,
            localId: localId,
        },
    };
    return {
        mintTxId: mintTx.getId(),
        mintTx: mintPsbt,
        cat721Utxo: cat721Utxo,
        minterUtxo: {
            utxo: mintPsbt.getUtxo(1),
            txoStateHashes: mintPsbt.txState.stateHashList,
            state: nextMinter.state!,
        },
    };
}
