import { testSigner } from '../../utils/testSigner'
import { testChainProvider, testUtxoProvider } from '../../utils/testProvider'
import { NftParallelClosedMinterCat721Meta } from '../../../src/lib/metadata'
import { deployParallelClosedMinter } from '../../../src/features/cat721/deploy/nftParallelClosedMinter'
import { mintNft as mint } from '../../../src/features/cat721/mint/nftParallelClosedMinter'
import { singleSendNft as singleSend } from '../../../src/features/cat721/send/singleSend'
import { burnNft as burn } from '../../../src/features/cat721/burn/burn'
import { Ripemd160 } from 'scrypt-ts'
import { Cat721MinterUtxo, Cat721Utxo } from '../../../src/lib/provider'
import { toTokenAddress } from '../../../src/lib/utils'

export const FEE_RATE = 10
export const ALLOWED_SIZE_DIFF = 40 // ~ 1 inputs difference is allowed

export async function deployNft(info: NftParallelClosedMinterCat721Meta) {
    const address = await testSigner.getAddress()
    const ownerAddress = toTokenAddress(address);
    return deployParallelClosedMinter(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        ownerAddress,
        info,
        FEE_RATE,
        undefined
    )
}

export async function mintNft(
    cat721MinterUtxo: Cat721MinterUtxo,
    collectionId: string,
    info: NftParallelClosedMinterCat721Meta
) {
    const address = await testSigner.getAddress()
    const nftReceiverAddr = toTokenAddress(address);
    const ownerAddress = toTokenAddress(address);
    return mint(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        ownerAddress,
        cat721MinterUtxo,
        collectionId,
        info,
        nftReceiverAddr,
        FEE_RATE,
        "text",
        "empty text", 
        {

        }
    )
}

export async function singleSendNft(
    minterAddr: string,
    inputTokenUtxos: Cat721Utxo[],
    nftReceiverAddrs: Ripemd160[]
) {
    return singleSend(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        minterAddr,
        inputTokenUtxos,
        nftReceiverAddrs,
        FEE_RATE
    )
}

export async function burnNft(
    minterAddr: string,
    inputTokenUtxos: Cat721Utxo[]
) {
    return burn(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        minterAddr,
        inputTokenUtxos,
        FEE_RATE
    )
}
