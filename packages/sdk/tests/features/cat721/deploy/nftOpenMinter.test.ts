import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NftOpenMinterCat721Meta } from '../../../../src/lib/metadata';
import { NftOpenMinter } from '../../../../src/contracts/nft/minters/nftOpenMinter';
import { verifyInputSpent } from '../../../utils/txHelper';
import { CAT721 } from '../../../../src/contracts/nft/cat721';
import { deploy } from '../../../../src/features/cat721/deploy/nftOpenMinter';
import { mint } from '../../../../src/features/cat721/mint/nftOpenMinter';
import { testSigner } from '../../../utils/testSigner';
import { Guard } from '../../../../src/contracts/token/guard';
// import { CAT721Covenant } from '../../../../src/covenants/cat721Covenant';
// import { CAT721Proto } from '../../../../src/contracts/nft/cat721Proto';
import { HEIGHT, MerkleProof, NftMerkleLeaf, ProofNodePos } from '../../../../src/contracts/nft/types';
import { OpenMinterCovenant } from '../../../../src/covenants/openMinterCovenant';
import { isP2TR, scriptToP2tr, toTokenAddress, toXOnly } from '../../../../src/lib/utils';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';
import { getCatCommitScript } from '../../../../src/lib/commit';
// import { NftOpenMinterMerkleTreeData } from '../../../../src/contracts/nft/minters/nftOpenMinterProto';
import { NftOpenMinterCovenant, NftOpenMinterMerkleTreeData } from '../../../../src/covenants/nftOpenMinterCovenant';
import { Psbt } from 'bitcoinjs-lib';
import { Cat721OpenMinterUtxo, CatPsbt, Postage } from '../../../../src';
import { randomBytes } from 'crypto';
import { UTXO } from 'scrypt-ts';

use(chaiAsPromised);

const createDummyCommitScript = function (pubkeyX: string, localId: number): NftMerkleLeaf {
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
    const nftMerkleLeafList: NftMerkleLeaf[] = [];
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

describe('Test the features for `NftOpenMinterCovenant`', () => {
    const collectionMax: bigint = 100n;
    let metadata: NftOpenMinterCat721Meta;
    let nftOpenMinterMerkleTreeData: NftOpenMinterMerkleTreeData;
    let minterInstance: NftOpenMinterCovenant;
    let minterTx: CatPsbt;
    let genesisTx: Psbt;
    let revealTx: CatPsbt;
    let collectionId: string;
    let address: string;

    before(async () => {
        await NftOpenMinter.loadArtifact();
        await CAT721.loadArtifact();
        await Guard.loadArtifact();
        address = await testSigner.getAddress();
        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: collectionMax,
            premine: 10n,
            preminerAddr: toTokenAddress(address),
            minterMd5: OpenMinterCovenant.LOCKED_ASM_VERSION,
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        };
        const _isP2TR = isP2TR(address);
        const pubkey = await testSigner.getPublicKey();
        const pubkeyX = toXOnly(pubkey, _isP2TR);
        nftOpenMinterMerkleTreeData = new NftOpenMinterMerkleTreeData(
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
        minterTx = deployResult.revealTx;
        genesisTx = deployResult.genesisTx;
        revealTx = deployResult.revealTx;
        collectionId = minterInstance.collectionId;
    });

    describe('When deploying a new nft by NftOpenMinterCovenant', () => {
        it('should build and sign the genesis and reveal txns successfully', async () => {
            // test genesis(commit) tx
            expect(genesisTx).to.not.be.null;
            expect(verifyInputSpent(genesisTx, 0)).to.be.true;
            // test reveal tx
            expect(revealTx).to.not.be.null;
            expect(revealTx.isFinalized).to.be.true;
            expect(verifyInputSpent(revealTx, 0)).to.be.true;
            expect(verifyInputSpent(revealTx, 1)).to.be.true;
        });

        it('shoud mint the nft if applicable', async () => {
            for (let i = 0; i < 10; i++) {
                const index = Number(minterInstance.state.nextLocalId);
                const oldLeaf = nftOpenMinterMerkleTreeData.getLeaf(index);
                const newLeaf: NftMerkleLeaf = {
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
                const minterUtxo: Cat721OpenMinterUtxo = {
                    utxo: minterInstance.utxo!,
                    txoStateHashes: minterTx.txState.stateHashList,
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
                expect(verifyInputSpent(mintTx!, 0)).to.be.true;
                minterInstance = minter;
                minterTx = mintTx;
            }
        });
    });
});
