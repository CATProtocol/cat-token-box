import { ProtocolState } from '../../../lib/state';
import { OpenMinterCovenant } from '../../../covenants/openMinterCovenant';
import { OpenMinterCat20Meta } from '../../../lib/metadata';
import { Ripemd160 } from 'scrypt-ts';
import { Signer } from '../../../lib/signer';
import { UtxoProvider, ChainProvider, Cat20MinterUtxo, markSpent } from '../../../lib/provider';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import { getTxId } from '../../../lib/utils';
import { CatPsbt } from '../../../lib/catPsbt';
import { OpenMinterState } from '../../../contracts/token/types';

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
    metadata: OpenMinterCat20Meta,
    tokenReceiver: Ripemd160,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: CatPsbt;
    mintTxId: string;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.utxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));

    const minterCovenant = new OpenMinterCovenant(tokenId, metadata, minterUtxo.state as OpenMinterState).bindToUtxo({
        txId: minterUtxo.utxo.txId,
        outputIndex: minterUtxo.utxo.outputIndex,
        satoshis: minterUtxo.utxo.satoshis,
    });

    const utxos = await utxoProvider.getUtxos(address, { maxCnt: 5 });

    const estimatedVSize = OpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        tokenReceiver,
        utxos,
        feeRate,
        changeAddress,
        undefined,
        address,
        metadata.preminerAddr ? pubkey : undefined,
    ).estimateVSize();

    const mintPsbt = OpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        tokenReceiver,
        utxos,
        feeRate,
        changeAddress,
        estimatedVSize,
        address,
        metadata.preminerAddr ? pubkey : undefined,
    );

    const signedMintPsbt = await signer.signPsbt(mintPsbt.toHex(), mintPsbt.psbtOptions());

    await mintPsbt.combine(Psbt.fromHex(signedMintPsbt)).finalizeAllInputsAsync();

    const mintTx = mintPsbt.extractTransaction();

    await chainProvider.broadcast(mintTx.toHex());
    markSpent(utxoProvider, mintTx);
    return {
        mintTxId: mintTx.getId(),
        mintTx: mintPsbt,
    };
}
