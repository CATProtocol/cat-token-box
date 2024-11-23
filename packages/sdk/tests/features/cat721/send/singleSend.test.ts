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
    deployNft,
    FEE_RATE,
    mintNft,
    singleSendNft,
} from '../nftParallelClosedMinter.utils'
import { CAT721Covenant } from '../../../../src/covenants/cat721Covenant'
import { Cat721MinterUtxo, Cat721Utxo } from '../../../../src/lib/provider'
import { NftParallelClosedMinterCovenant } from '../../../../src/covenants/nftParallelClosedMinterCovenant'
import { CAT721Proto } from '../../../../src/contracts/nft/cat721Proto'
import { CAT721 } from '../../../../src/contracts/nft/cat721'
import { NftTransferGuard } from '../../../../src/contracts/nft/nftTransferGuard'
import { NftBurnGuard } from '../../../../src/contracts/nft/nftBurnGuard'
import { NftParallelClosedMinter } from '../../../../src/contracts/nft/nftParallelClosedMinter'
import { toTokenAddress } from '../../../../src/lib/utils'

use(chaiAsPromised)

describe('Test the feature `send` for `CAT721Covenant`', () => {
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
        } = await deployNft(metadata)

        collectionId = deployedTokenId
        minterAddr = deployedMinterAddr
        spentMinterTx = revealTx

        const inputMinter = NftParallelClosedMinterCovenant.fromMintTx(
            collectionId,
            toReceiverAddr,
            metadata,
            spentMinterTx.extractTransaction().toHex(),
            1
        )
        const minterOutputIndex = 1

        const tx = spentMinterTx.extractTransaction();
        const cat721MinterUtxo1 : Cat721MinterUtxo = {
            utxo: {
                txId: tx.getId(),
                outputIndex: minterOutputIndex,
                satoshis: Number(tx.outs[minterOutputIndex].value),
                script: Buffer.from(tx.outs[minterOutputIndex].script).toString('hex')
            },
            txoStateHashes: spentMinterTx.txState.stateHashList,
            state: inputMinter.state!
        } 

        const { mintTx } = await mintNft(
            cat721MinterUtxo1,
            collectionId,
            metadata
        )
        const inputMinter2 = NftParallelClosedMinterCovenant.fromMintTx(
            collectionId,
            toReceiverAddr,
            metadata,
            mintTx.extractTransaction().toHex(),
            1
        )

        const cat721MinterUtxo2 : Cat721MinterUtxo = {
            utxo: {
                txId: mintTx.extractTransaction().getId(),
                outputIndex: minterOutputIndex,
                satoshis: Number(mintTx.extractTransaction().outs[minterOutputIndex].value),
                script: Buffer.from(mintTx.extractTransaction().outs[minterOutputIndex].script).toString('hex')
            },
            txoStateHashes: mintTx.txState.stateHashList,
            state: inputMinter2.state!
        } 

        const { mintTx: _secondTx } = await mintNft(
            cat721MinterUtxo2,
            collectionId,
            metadata
        )
        firstMintTx = mintTx
        secondMintTx = _secondTx
    })

    describe('When sending nfts in a single tx', () => {
        it('should send one token utxo successfully', async () => {
            await testSendResult([
                {
                    utxo: firstMintTx.getUtxo(3),
                    txoStateHashes: firstMintTx.txState.stateHashList,
                    state: CAT721Proto.create(toReceiverAddr, 0n),
                },
            ])
        })

        it('should send multiple nft utxos successfully', async () => {
            await testSendResult([
                // first nft utxo
                {
                    utxo: firstMintTx.getUtxo(3),
                    txoStateHashes: firstMintTx.txState.stateHashList,
                    state: CAT721Proto.create(toReceiverAddr, 0n),
                },
                // second nft utxo
                {
                    utxo: secondMintTx.getUtxo(3),
                    txoStateHashes: secondMintTx.txState.stateHashList,
                    state: CAT721Proto.create(toReceiverAddr, 1n),
                },
            ])
        })
    })

    async function testSendResult(cat721Utxos: Cat721Utxo[]) {
        const { guardTx, sendTx, estGuardTxVSize, estSendTxVSize } =
            await singleSendNft(
                minterAddr,
                cat721Utxos,
                cat721Utxos.map(() => toReceiverAddr)
            )

        const realGuardVSize = guardTx.extractTransaction().virtualSize()
        const realSendVSize = sendTx.extractTransaction().virtualSize()

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
        expect(sendTx).not.to.be.undefined
        expect(sendTx.isFinalized).to.be.true
        expect(
            estSendTxVSize >= realSendVSize,
            `Estimated send tx size ${estSendTxVSize} is less that the real size ${realSendVSize}`
        ).to.be.true
        expect(
            estSendTxVSize <= realSendVSize + ALLOWED_SIZE_DIFF,
            `Estimated send tx size ${estSendTxVSize} is more than the real size ${realSendVSize}`
        ).to.be.true
        expect(
            sendTx.getFeeRate() <= (estSendTxVSize / realSendVSize) * FEE_RATE,
            `Send tx fee rate ${sendTx.getFeeRate()} is larger than the expected fee rate ${
                (estSendTxVSize / realSendVSize) * FEE_RATE
            }`
        ).to.be.true

        // verify token input unlock
        for (let i = 0; i < cat721Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true
        }

        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat721Utxos.length)).to.be.true

        // verify nft to receiver
        const toReceiverOutputIndex = 1
        const toReceiverToken = new CAT721Covenant(
            minterAddr,
            CAT721Proto.create(toReceiverAddr, cat721Utxos[0].state.localId)
        )
        expect(
            Buffer.from(
                sendTx.txOutputs[toReceiverOutputIndex].script
            ).toString('hex')
        ).to.eq(toReceiverToken.lockingScript.toHex())
        expect(sendTx.txState.stateHashList[toReceiverOutputIndex - 1]).to.eq(
            toReceiverToken.stateHash
        )
    }
})
