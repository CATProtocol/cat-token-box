import { testSigner } from '../../utils/testSigner';
import { testChainProvider, testUtxoProvider } from '../../utils/testProvider';
import { OpenMinterCat20Meta } from '../../../src/lib/metadata';
import { deploy } from '../../../src/features/cat20/deploy/openMinter';
import { mint } from '../../../src/features/cat20/mint/openMinter';
import { singleSend } from '../../../src/features/cat20/send/singleSend';
import { contractSend } from '../../../src/features/cat20/send/contractSend';
import { Ripemd160 } from 'scrypt-ts';
import { Cat20MinterUtxo, Cat20Utxo } from '../../../src/lib/provider';
import { toTokenAddress } from '../../../src/lib/utils';
import { burn } from '../../../src/features/cat20/burn/burn';
import { int32 } from '../../../src/contracts/types';

export const FEE_RATE = 10;
export const ALLOWED_SIZE_DIFF = 40; // ~ 1 inputs difference is allowed

export async function deployToken(info: OpenMinterCat20Meta) {
    return deploy(testSigner, testUtxoProvider, testChainProvider, info, FEE_RATE);
}

export async function mintToken(cat20MinterUtxo: Cat20MinterUtxo, tokenId: string, info: OpenMinterCat20Meta) {
    const changeAddress = await testSigner.getAddress();
    const tokenReceiverAddr = toTokenAddress(changeAddress);

    return mint(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        cat20MinterUtxo,
        tokenId,
        info,
        tokenReceiverAddr,
        changeAddress,
        FEE_RATE,
    );
}

export async function singleSendToken(
    minterAddr: string,
    amount: int32,
    inputTokenUtxos: Cat20Utxo[],
    tokenReceiverAddr: Ripemd160,
) {
    const address = await testSigner.getAddress();
    const tokenChangeAddr = toTokenAddress(address);
    return singleSend(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        minterAddr,
        inputTokenUtxos,
        [
            {
                address: tokenReceiverAddr,
                amount,
            },
        ],
        tokenChangeAddr,
        FEE_RATE,
    );
}

export async function contractSendToken(
    minterAddr: string,
    amount: int32,
    inputTokenUtxos: Cat20Utxo[],
    tokenReceiverAddr: Ripemd160,
) {
    const address = await testSigner.getAddress();
    const tokenChangeAddr = toTokenAddress(address);
    return contractSend(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        minterAddr,
        inputTokenUtxos,
        [
            {
                address: tokenReceiverAddr,
                amount,
            },
        ],
        tokenChangeAddr,
        FEE_RATE,
    );
}

export async function burnToken(minterAddr: string, inputTokenUtxos: Cat20Utxo[]) {
    return burn(testSigner, testUtxoProvider, testChainProvider, minterAddr, inputTokenUtxos, FEE_RATE);
}
