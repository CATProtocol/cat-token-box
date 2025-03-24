import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { isP2TR, scriptToP2tr, toTokenAddress, toXOnly } from '../../../../src/lib/utils';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';
import { getCatCommitScript } from '../../../../src/lib/commit';
import { CAT721MerkleLeaf, HEIGHT, MerkleProof, OpenMinterCat721Meta, Postage, ProofNodePos } from '../../../../src';
import { bvmVerify, ExtPsbt, Ripemd160, UTXO } from '@scrypt-inc/scrypt-ts-btc';
import {
    CAT721OpenMinterCovenant,
    CAT721OpenMinterMerkleTreeData,
} from '../../../../src/covenants/cat721OpenMinterCovenant';
import { loadAllArtifacts } from '../utils';
import { testSigner } from '../../../../tests/utils/testSigner';
import { deploy } from '../../../../src/features/cat721/deploy/cat721OpenMinter';
import { randomBytes } from 'crypto';
import { CAT721OpenMinterUtxo } from '../../../../src/lib/provider';
import { mint } from '../../../../src/features/cat721/mint/cat721OpenMinter';

use(chaiAsPromised);

const createDummyCommitScript = function (pubkeyX: string, localId: number): CAT721MerkleLeaf {
    const commitScript = getCatCommitScript(pubkeyX, { localId });
    const lockingScript = Buffer.from(commitScript, 'hex');
    const { p2trLockingScript: p2trCommit } = scriptToP2tr(lockingScript);
    return {
        commitScript: p2trCommit,
        localId: BigInt(localId),
        isMined: false,
    };
};

const generateCollectionLeaf = function (pubkeyX: string, max: number) {
    const nftMerkleLeafList: CAT721MerkleLeaf[] = [];
    for (let index = 0; index < max; index++) {
        nftMerkleLeafList.push(createDummyCommitScript(pubkeyX, index));
    }
    return nftMerkleLeafList;
};

const getDummyCommitUtxo = function (address: string, commitScript: string, satoshis?: number): UTXO {
    return {
        address: address,
        txId: randomBytes(32).toString('hex'),
        outputIndex: 0,
        script: commitScript,
        satoshis: satoshis || 9007199254740991,
    };
};

describe('Test the features for `CAT721OpenMinterCovenant`', () => {
    const collectionMax: bigint = 100n;
    let metadata: OpenMinterCat721Meta;
    let nftOpenMinterMerkleTreeData: CAT721OpenMinterMerkleTreeData;
    let minterInstance: CAT721OpenMinterCovenant;
    // let minterTx: ExtPsbt;
    let genesisTx: ExtPsbt;
    let revealTx: ExtPsbt;
    let collectionId: string;
    let address: string;

    before(async () => {
        loadAllArtifacts();
        address = await testSigner.getAddress();
        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: collectionMax,
            premine: 10n,
            preminerAddr: Ripemd160(toTokenAddress(address)),
            minterMd5: '',
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        };
        const _isP2TR = isP2TR(address);
        const pubkey = await testSigner.getPublicKey();
        const pubkeyX = toXOnly(pubkey, _isP2TR);
        nftOpenMinterMerkleTreeData = new CAT721OpenMinterMerkleTreeData(
            generateCollectionLeaf(pubkeyX, Number(collectionMax)),
            HEIGHT,
        );
        const deployResult = await deploy(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            metadata,
            nftOpenMinterMerkleTreeData.merkleRoot,
            1,
        );
        minterInstance = deployResult.minter;
        // minterTx = deployResult.revealTx;
        genesisTx = deployResult.genesisTx;
        revealTx = deployResult.revealTx;
        collectionId = minterInstance.collectionId;
    });

    describe('When deploying a new nft by CAT721OpenMinterCovenant', () => {
        it('should build and sign the genesis and reveal txns successfully', async () => {
            // test genesis(commit) tx
            expect(genesisTx).to.not.be.null;
            expect(bvmVerify(genesisTx, 0)).to.be.true;
            // test reveal tx
            expect(revealTx).to.not.be.null;
            expect(revealTx.isFinalized).to.be.true;
            expect(bvmVerify(revealTx, 0)).to.be.true;
            expect(bvmVerify(revealTx, 1)).to.be.true;
        });

        it('shoud mint the nft if applicable', async () => {
            for (let i = 0; i < 20; i++) {
                const index = Number(minterInstance.state.nextLocalId);
                const oldLeaf = nftOpenMinterMerkleTreeData.getLeaf(index);
                const newLeaf: CAT721MerkleLeaf = {
                    commitScript: oldLeaf.commitScript,
                    localId: oldLeaf.localId,
                    isMined: true,
                };
                const updateLeafInfo = nftOpenMinterMerkleTreeData.updateLeaf(newLeaf, index);
                const merkleInfo = nftOpenMinterMerkleTreeData.getMerklePath(index);
                const commitUtxo = getDummyCommitUtxo(
                    await testSigner.getAddress(),
                    oldLeaf.commitScript,
                    Postage.METADATA_POSTAGE,
                );
                const minterUtxo: CAT721OpenMinterUtxo = {
                    ...minterInstance.utxo!,
                    state: minterInstance.state!,
                };
                const { mintTx, minter } = await mint(
                    testSigner,
                    testUtxoProvider,
                    testChainProvider,
                    minterUtxo,
                    merkleInfo.neighbor as MerkleProof,
                    merkleInfo.neighborType as ProofNodePos,
                    updateLeafInfo.merkleRoot,
                    commitUtxo,
                    collectionId,
                    metadata,
                    toTokenAddress(address),
                    address,
                    1,
                );
                expect(bvmVerify(mintTx!, 0)).to.be.true;
                minterInstance = minter;
            }
        });
    });
});
