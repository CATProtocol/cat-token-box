import { UTXO } from 'scrypt-ts';
import { Signer } from '../../lib/signer';
import { PushTxCovenant } from '../../covenants/pushTxCovenant';
import { getDummyUtxo, getDummyUtxos } from '../../lib/utils';
import { CatPsbt, DUST_LIMIT } from '../../lib/catPsbt';
import { ChainProvider, UtxoProvider } from '../../lib/provider';
import { Postage } from '../../lib/constants';
import { pickLargeFeeUtxo } from '../cat20';
import { Psbt } from 'bitcoinjs-lib';

export async function pushTxUnlock(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    pushTxCovenantInputNumber: number,
    feeRate: number,
) {
    const changeAddress = await signer.getAddress();

    const pushTxCovenant = new PushTxCovenant();

    const { estPushTxVSize, dummyPushTxCovenantDeployPsbt, dummyPushTxCovenantList } = estimatePushTxVSize(
        pushTxCovenant.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        pushTxCovenantInputNumber,
        changeAddress,
    );

    const estSendTxVSize = estimatePushTxUnlockTxVSize(
        dummyPushTxCovenantList,
        dummyPushTxCovenantDeployPsbt,
        changeAddress,
        feeRate,
    );

    const total = feeRate * (estPushTxVSize + estSendTxVSize) + Postage.TOKEN_POSTAGE; // for a token change output

    const utxos = await utxoProvider.getUtxos(changeAddress, { total });

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount');
    }

    const feeUtxo = pickLargeFeeUtxo(utxos);

    const { pushTxCovenantDeployPsbt, pushTxCovenantList } = buildPushTxDeployTx(
        pushTxCovenant,
        pushTxCovenantInputNumber,
        feeUtxo,
        changeAddress,
        feeRate,
        estPushTxVSize,
    );

    const pushTxUnlockTx = buildPushTxUnlockTx(
        pushTxCovenantList,
        pushTxCovenantDeployPsbt,
        changeAddress,
        feeRate,
        estSendTxVSize,
    );

    const [s1, s2] = await signer.signPsbts([
        {
            psbtHex: pushTxCovenantDeployPsbt.toHex(),
            options: pushTxCovenantDeployPsbt.psbtOptions(),
        },
        {
            psbtHex: pushTxUnlockTx.toHex(),
            options: pushTxUnlockTx.psbtOptions(),
        },
    ]);

    // combine and finalize the psbts
    const pushTxDeployPsbt = await pushTxCovenantDeployPsbt.combine(Psbt.fromHex(s1)).finalizeAllInputsAsync();
    const pushTxUnlockPsbt = await pushTxUnlockTx.combine(Psbt.fromHex(s2)).finalizeAllInputsAsync();
    const pushTxDeploy = pushTxDeployPsbt.extractTransaction();
    const pushTxUnlock = pushTxUnlockPsbt.extractTransaction();
    // broadcast the transactions
    await chainProvider.broadcast(pushTxDeploy.toHex());
    await chainProvider.broadcast(pushTxUnlock.toHex());

    return {
        pushTxDeployPsbt,
        pushTxUnlockPsbt,
    };
}

function buildPushTxDeployTx(
    pushTx: PushTxCovenant,
    pushTxInputNumber: number,
    feeUtxo: UTXO,
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number,
) {
    if (feeUtxo.satoshis < Postage.GUARD_POSTAGE + feeRate * (estimatedVSize || 1)) {
        throw new Error('Insufficient satoshis input amount');
    }
    const pushTxCovenantDeployPsbt = new CatPsbt().addFeeInputs([feeUtxo]);
    const pushTxCovenantList: PushTxCovenant[] = [];
    for (let index = 0; index < pushTxInputNumber; index++) {
        pushTxCovenantDeployPsbt.addCovenantOutput(pushTx, Postage.GUARD_POSTAGE);
        pushTxCovenantList.push(pushTx.next(undefined) as PushTxCovenant);
    }
    pushTxCovenantDeployPsbt.change(changeAddress, feeRate, estimatedVSize);
    for (let index = 0; index < pushTxInputNumber; index++) {
        pushTxCovenantList[index].bindToUtxo(pushTxCovenantDeployPsbt.getUtxo(index + 1));
    }
    return { pushTxCovenantDeployPsbt, pushTxCovenantList };
}

function estimatePushTxVSize(pushTx: PushTxCovenant, pushTxInputNumber: number, changeAddress: string) {
    const { pushTxCovenantDeployPsbt, pushTxCovenantList } = buildPushTxDeployTx(
        pushTx,
        pushTxInputNumber,
        getDummyUtxos(changeAddress, 1)[0],
        changeAddress,
        DUST_LIMIT,
    );
    return {
        dummyPushTxCovenantDeployPsbt: pushTxCovenantDeployPsbt,
        estPushTxVSize: pushTxCovenantDeployPsbt.estimateVSize(),
        dummyPushTxCovenantList: pushTxCovenantList,
    };
}

function buildPushTxUnlockTx(
    pushTxList: PushTxCovenant[],
    pushTxDeployPsbt: CatPsbt,
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number,
) {
    const sendPsbt = new CatPsbt();

    // add token inputs
    for (const pushTx of pushTxList) {
        sendPsbt.addCovenantInput(pushTx);
    }

    sendPsbt
        .addFeeInputs([pushTxDeployPsbt.getUtxo(pushTxList.length + 1)])
        .change(changeAddress, feeRate, estimatedVSize);

    const inputCtxs = sendPsbt.calculateInputCtxs();
    // unlock tokens
    for (let i = 0; i < pushTxList.length; i++) {
        sendPsbt.updateCovenantInput(i, pushTxList[i], pushTxList[i].unlock(i, inputCtxs));
    }
    return sendPsbt;
}

function estimatePushTxUnlockTxVSize(
    pushTxList: PushTxCovenant[],
    pushTxDeployPsbt: CatPsbt,
    changeAddress: string,
    feeRate: number,
) {
    return buildPushTxUnlockTx(pushTxList, pushTxDeployPsbt, changeAddress, feeRate).estimateVSize();
}
