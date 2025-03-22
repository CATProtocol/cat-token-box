import { Transaction } from '@scrypt-inc/bitcoinjs-lib';
import {
    ByteString,
    ChainProvider,
    ExtPsbt,
    getTxId,
    Ripemd160,
    Signer,
    UTXO,
    UtxoProvider,
} from '@scrypt-inc/scrypt-ts-btc';
import { MerkleProof, ProofNodePos } from '../../../../src/contracts';
import { CAT721OpenMinterCovenant } from '../../../../src/covenants/cat721OpenMinterCovenant';
import { OpenMinterCat721Meta } from '../../../../src/lib/metadata';
import { CAT721OpenMinterUtxo, processExtPsbts } from '../../../../src/lib/provider';

export async function mint(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: CAT721OpenMinterUtxo,
    proof: MerkleProof,
    proofNodePos: ProofNodePos,
    nextMerkleRoot: string,
    commitUtxo: UTXO,
    collectionId: string,
    metadata: OpenMinterCat721Meta,
    nftReceiver: ByteString,
    changeAddress: string,
    feeRate: number,
): Promise<{
    mintTx: ExtPsbt;
    mintTxId: string;
    minter: CAT721OpenMinterCovenant;
}> {
    const address = await signer.getAddress();
    const pubkey = await signer.getPublicKey();

    // fetch minter preTx
    const minterInputIndex = 0;
    const spentMinterTxHex = await chainProvider.getRawTransaction(minterUtxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex);
    const minterPreTxHex = await chainProvider.getRawTransaction(getTxId(spentMinterTx.ins[minterInputIndex]));

    const minterCovenant = new CAT721OpenMinterCovenant(collectionId, metadata, minterUtxo.state).bindToUtxo(
        minterUtxo,
    );

    const utxos = await utxoProvider.getUtxos(address);

    const { mintTx: mintPsbt, nextMinter } = CAT721OpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        minterCovenant,
        Ripemd160(nftReceiver),
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
    );
    const {
        psbts: [mintTx],
    } = await processExtPsbts(signer, utxoProvider, chainProvider, [mintPsbt]);
    return {
        mintTxId: mintTx.unsignedTx.getId(),
        mintTx: mintPsbt,
        minter: nextMinter,
    };
}
