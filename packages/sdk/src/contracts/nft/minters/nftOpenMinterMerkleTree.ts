import { assert, method, ByteString, hash160, SmartContractLib } from 'scrypt-ts';
import { HEIGHT, MerkleProof, ProofNodePos } from '../types';

export class NftOpenMinterMerkleTree extends SmartContractLib {
    /**
     * Update leaf in merkle tree
     * @param oldLeaf old leaf to update
     * @param newLeaf new leaf
     * @param proof merkle proof
     * @param proofNodePos proof node position
     * @param merkleRoot merkle root to verify the proof and the leaf
     * @returns the new merkle root
     */
    @method()
    static updateLeaf(
        oldLeaf: ByteString,
        newLeaf: ByteString,
        proof: MerkleProof,
        proofNodePos: ProofNodePos,
        merkleRoot: ByteString,
    ): ByteString {
        let oldRoot = oldLeaf;
        let newRoot = newLeaf;
        for (let i = 0; i < HEIGHT - 1; i++) {
            if (proofNodePos[i]) {
                // proof node is on the right
                oldRoot = hash160(oldRoot + proof[i]);
                newRoot = hash160(newRoot + proof[i]);
            } else {
                oldRoot = hash160(proof[i] + oldRoot);
                newRoot = hash160(proof[i] + newRoot);
            }
        }
        assert(oldRoot == merkleRoot, 'merkle root mismatch');
        return newRoot;
    }
}
