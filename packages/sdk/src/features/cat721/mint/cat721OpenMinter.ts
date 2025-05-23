import { Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ByteString, ChainProvider, ExtPsbt, Ripemd160, Signer, UTXO, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { MerkleProof, ProofNodePos } from '../../../contracts/index.js';
import { CAT721OpenMinterCovenant } from '../../../covenants/index.js';
import { OpenMinterCat721Meta, CAT721OpenMinterUtxo, processExtPsbts, getTxId  } from '../../../lib/index.js';
import { createNft } from './nft.js';

export async function mintNft(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterUtxo: CAT721OpenMinterUtxo,
    proof: MerkleProof,
    proofNodePos: ProofNodePos,
    nextMerkleRoot: string,
    nft: {
        contentType: string;
        contentBody: string;
        nftmetadata: object;
    },
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

    const { commitPsbt, nftCommitScript, cblock } = await createNft(signer, nft, utxos, feeRate);

    const commitUtxo = commitPsbt.getUtxo(0);
    const feeUTXO: UTXO = commitPsbt.getChangeUTXO();
    const { mintTx: mintPsbt, nextMinter } = CAT721OpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        minterCovenant,
        Ripemd160(nftReceiver),
        nftCommitScript,
        cblock,
        commitUtxo,
        proof,
        proofNodePos,
        nextMerkleRoot,
        [feeUTXO],
        feeRate,
        changeAddress,
        address,
        pubkey,
    );
    const {
        psbts: [mintTx],
    } = await processExtPsbts(signer, utxoProvider, chainProvider, [commitPsbt, mintPsbt]);
    return {
        mintTxId: mintTx.unsignedTx.getId(),
        mintTx: mintPsbt,
        minter: nextMinter,
    };
}
