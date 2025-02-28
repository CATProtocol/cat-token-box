import { ProtocolState } from '../../../lib/state';
import { NftOpenMinterCat721Meta } from '../../../lib/metadata';
import { ByteString, UTXO } from 'scrypt-ts';
import { Signer } from '../../../lib/signer';
import { UtxoProvider, ChainProvider, Cat721OpenMinterUtxo, markSpent } from '../../../lib/provider';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import { getTxId } from '../../../lib/utils';
import { CatPsbt } from '../../../lib/catPsbt';
import { NftOpenMinterCovenant } from '../../../covenants/nftOpenMinterCovenant';
import { MerkleProof, NftOpenMinterState, ProofNodePos } from '../../../contracts/nft/types';

export async function mint(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: Cat721OpenMinterUtxo,
    proof: MerkleProof,
    proofNodePos: ProofNodePos,
    nextMerkleRoot: string,
    commitUtxo: UTXO,
    collectionId: string,
    metadata: NftOpenMinterCat721Meta,
    nftReceiver: ByteString,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: CatPsbt;
    mintTxId: string;
    minter: NftOpenMinterCovenant;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.utxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));

    const minterCovenant = new NftOpenMinterCovenant(
        collectionId,
        metadata,
        minterUtxo.state as NftOpenMinterState,
    ).bindToUtxo({
        txId: minterUtxo.utxo.txId,
        outputIndex: minterUtxo.utxo.outputIndex,
        satoshis: minterUtxo.utxo.satoshis,
    });

    const utxos = await utxoProvider.getUtxos(address, { maxCnt: 5 });

    const estimatedVSize = NftOpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        nftReceiver,
        commitUtxo,
        proof,
        proofNodePos,
        nextMerkleRoot,
        utxos,
        feeRate,
        changeAddress,
        undefined,
        address,
        metadata.preminerAddr ? pubkey : undefined,
    ).mintTx.estimateVSize();

    const { mintTx: mintPsbt, nextMinter } = NftOpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(minterUtxo.txoStateHashes),
        minterCovenant,
        nftReceiver,
        commitUtxo,
        proof,
        proofNodePos,
        nextMerkleRoot,
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
        minter: nextMinter,
    };
}
