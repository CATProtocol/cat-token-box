import { readArtifact } from '../../utils/index';
import {
    CAT20ClosedMinter,
    CAT20,
    CAT20StateLib,
    CAT20Guard,
    CAT20GuardStateLib,
    CAT20OpenMinter,
    OpenMinterCat20Meta,
    toTokenAddress,
    ClosedMinterCat20Meta,
    deployClosedMinter,
    closedMint,
    deploy,
    CAT20ClosedMinterUtxo, 
    CAT20OpenMinterUtxo, 
    CAT20Utxo,
    mint,
    singleSend
} from '@cat-protocol/cat-sdk-v2';
import { testSigner } from '../../utils/testSigner';
import { testChainProvider, testUtxoProvider } from '../../utils/testProvider';
import { Int32, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';

export const loadAllArtifacts = function () {
    //
    CAT20ClosedMinter.loadArtifact(readArtifact('artifacts/cat20/minters/cat20ClosedMinter.json'));
    CAT20OpenMinter.loadArtifact(readArtifact('artifacts/cat20/minters/cat20OpenMinter.json'));
    //
    CAT20.loadArtifact(readArtifact('artifacts/cat20/cat20.json'));
    CAT20StateLib.loadArtifact(readArtifact('artifacts/cat20/cat20State.json'));
    //
    CAT20Guard.loadArtifact(readArtifact('artifacts/cat20/cat20Guard.json'));
    CAT20GuardStateLib.loadArtifact(readArtifact('artifacts/cat20/cat20GuardState.json'));
};

export async function deployToken(info: OpenMinterCat20Meta) {
    return deploy(testSigner, testUtxoProvider, testChainProvider, info, await testChainProvider.getFeeRate());
}

export async function deployClosedMinterToken(info: ClosedMinterCat20Meta) {
    return deployClosedMinter(testSigner, testUtxoProvider, testChainProvider, info, await testChainProvider.getFeeRate());
}

export async function mintToken(cat20MinterUtxo: CAT20OpenMinterUtxo, tokenId: string, info: OpenMinterCat20Meta) {
    const changeAddress = await testSigner.getAddress();
    const tokenReceiverAddr = Ripemd160(toTokenAddress(changeAddress));
    return mint(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        cat20MinterUtxo,
        tokenId,
        info,
        tokenReceiverAddr,
        changeAddress,
        await testChainProvider.getFeeRate(),
    );
}

export async function mintClosedMinterToken(cat20MinterUtxo: CAT20ClosedMinterUtxo, tokenId: string, info: ClosedMinterCat20Meta, amount: Int32) {
    return closedMint(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        cat20MinterUtxo,
        tokenId,
        info,
        amount,
        await testChainProvider.getFeeRate(),
    );
}

export async function singleSendToken(
    minterAddr: string,
    amount: Int32,
    inputTokenUtxos: CAT20Utxo[],
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
        await testChainProvider.getFeeRate(),
    );
}
