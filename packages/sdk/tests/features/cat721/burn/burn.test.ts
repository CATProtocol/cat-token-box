import * as dotenv from 'dotenv'
dotenv.config()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Ripemd160 } from 'scrypt-ts'
import { NftParallelClosedMinterCat721Meta } from '../../../../src/lib/metadata'
import { verifyInputSpent } from '../../../utils/txHelper'
import { CatPsbt } from '../../../../src/lib/catPsbt'
import { testSigner } from '../../../utils/testSigner'
import {
    ALLOWED_SIZE_DIFF,
    burnNft,
    deployNft,
    FEE_RATE,
    mintNft,
} from '../nftParallelClosedMinter.utils'
import { Cat721MinterUtxo, Cat721Utxo } from '../../../../src/lib/provider'
import { NftParallelClosedMinterCovenant } from '../../../../src/covenants/nftParallelClosedMinterCovenant'
import { CAT721Proto } from '../../../../src/contracts/nft/cat721Proto'
import { NftBurnGuard } from '../../../../src/contracts/nft/nftBurnGuard'
import { NftTransferGuard } from '../../../../src/contracts/nft/nftTransferGuard'
import { CAT721 } from '../../../../src/contracts/nft/cat721'
import { NftParallelClosedMinter } from '../../../../src/contracts/nft/nftParallelClosedMinter'
import { addrToP2trLockingScript, toTokenAddress } from '../../../../src/lib/utils'

use(chaiAsPromised)

describe('Test the feature `burn` for `CAT721Covenant`', () => {
    let address: string
    let toReceiverAddr: Ripemd160

    let collectionId: string
    let minterAddr: string
    let metadata: NftParallelClosedMinterCat721Meta

    let firstMintTx: CatPsbt
    let secondMintTx: CatPsbt

    let spentMinterTx: CatPsbt

    before(async () => {
        await NftParallelClosedMinter.loadArtifact()
        await CAT721.loadArtifact()
        await NftTransferGuard.loadArtifact()
        await NftBurnGuard.loadArtifact()

        address = await testSigner.getAddress()
        toReceiverAddr = toTokenAddress(address);

        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: 10000n,
            minterMd5: NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION,
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        }

        const {
            revealTx,
            collectionId: deployedTokenId,
            minterAddr: deployedMinterAddr,
            collectionAddr,
        } = await deployNft(metadata)

        collectionId = deployedTokenId
        minterAddr = deployedMinterAddr
        spentMinterTx = revealTx

        const tx = revealTx.extractTransaction();

        const cat721MinterUtxo : Cat721MinterUtxo = {
            utxo: {
                txId: tx.getId(),
                outputIndex: 1,
                satoshis: Number(tx.outs[1].value),
                script: Buffer.from(tx.outs[1].script).toString('hex')
            },
            txoStateHashes: spentMinterTx.txState.stateHashList,
            state: {
                nftScript: addrToP2trLockingScript(collectionAddr),
                nextLocalId: 0n,
            }    
        } 
        const { mintTx } = await mintNft(
            cat721MinterUtxo,
            collectionId,
            metadata
        )

        const tx2 = mintTx.extractTransaction();

        const cat721MinterUtxo2 : Cat721MinterUtxo = {
            utxo: {
                txId: tx2.getId(),
                outputIndex: 1,
                satoshis: Number(tx2.outs[1].value),
                script: Buffer.from(tx2.outs[1].script).toString('hex')
            },
            txoStateHashes: mintTx.txState.stateHashList,
            state: {
                nftScript: addrToP2trLockingScript(collectionAddr),
                nextLocalId: 1n,
            }    
        } 

        const { mintTx: _secondTx } = await mintNft(
            cat721MinterUtxo2,
            collectionId,
            metadata
        )
        firstMintTx = mintTx
        secondMintTx = _secondTx
    })

    describe('When burn nfts in a single tx', () => {
        it('should burn one nft utxo successfully', async () => {
            await testBurnResult([
                {
                    utxo: firstMintTx.getUtxo(3),
                    txoStateHashes: firstMintTx.txState.stateHashList,
                    state: CAT721Proto.create(toReceiverAddr, 0n),
                },
            ])
        })

        it('should burn multiple nft utxos successfully', async () => {
            await testBurnResult([
                // first token utxo
                {
                    utxo: firstMintTx.getUtxo(3),
                    txoStateHashes: firstMintTx.txState.stateHashList,
                    state: CAT721Proto.create(toReceiverAddr, 0n),
                },
                // second token utxo
                {
                    utxo: secondMintTx.getUtxo(3),
                    txoStateHashes: secondMintTx.txState.stateHashList,
                    state: CAT721Proto.create(toReceiverAddr, 1n),
                },
            ])
        })
    })

    async function testBurnResult(cat721Utxos: Cat721Utxo[]) {
        const { guardTx, burnTx, estGuardTxVSize, estSendTxVSize } =
            await burnNft(minterAddr, cat721Utxos)

        const realGuardVSize = guardTx.extractTransaction().virtualSize()
        const realSendVSize = burnTx.extractTransaction().virtualSize()

        // check guard tx
        expect(guardTx).not.to.be.undefined
        expect(guardTx.isFinalized).to.be.true
        expect(
            estGuardTxVSize >= realGuardVSize,
            `Estimated guard tx size ${estGuardTxVSize} is less that the real size ${realGuardVSize}`
        ).to.be.true
        expect(
            estGuardTxVSize <= realGuardVSize + ALLOWED_SIZE_DIFF,
            `Estimated guard tx size ${estGuardTxVSize} is more than the real size ${realGuardVSize}`
        ).to.be.true
        expect(
            guardTx.getFeeRate() <=
                (estGuardTxVSize / realGuardVSize) * FEE_RATE,
            `Guard tx fee rate ${guardTx.getFeeRate()} is large than the expected fee rate ${
                (estGuardTxVSize / realGuardVSize) * FEE_RATE
            }`
        ).to.be.true

        // check send tx
        expect(burnTx).not.to.be.undefined
        expect(burnTx.isFinalized).to.be.true
        expect(
            estSendTxVSize >= realSendVSize,
            `Estimated send tx size ${estSendTxVSize} is less that the real size ${realSendVSize}`
        ).to.be.true
        expect(
            estSendTxVSize <= realSendVSize + ALLOWED_SIZE_DIFF,
            `Estimated send tx size ${estSendTxVSize} is more than the real size ${realSendVSize}`
        ).to.be.true
        expect(
            burnTx.getFeeRate() <= (estSendTxVSize / realSendVSize) * FEE_RATE,
            `Send tx fee rate ${burnTx.getFeeRate()} is larger than the expected fee rate ${
                (estSendTxVSize / realSendVSize) * FEE_RATE
            }`
        ).to.be.true

        // verify token input unlock
        for (let i = 0; i < cat721Utxos.length; i++) {
            expect(verifyInputSpent(burnTx, i)).to.be.true
        }

        // verify guard input unlock
        expect(verifyInputSpent(burnTx, cat721Utxos.length)).to.be.true
    }
})
