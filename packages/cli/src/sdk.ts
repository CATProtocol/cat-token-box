import { UTXO } from "scrypt-ts";
import { sendToken } from "./commands/send/ft";
import { mergeTokens } from "./commands/send/merge";
import { pick, pickLargeFeeUtxo } from "./commands/send/pick";
import {
    broadcast,
    btc,
    getTokens,
    getUtxos,
    logerror,
    toBitcoinNetwork,
    TokenMetadata,
    unScaleByDecimals,
} from "./common";
import { ConfigService, SpendService } from "./providers";
import { WalletService } from "./providers/walletService";

import { Psbt, Transaction, address } from 'bitcoinjs-lib';
import { networks } from "bitcoinjs-lib";
import { Sequence } from "@cmdcode/tapscript";


export async function send(
    token: TokenMetadata,
    receiver: btc.Address,
    amount: bigint,
    address: btc.Address,
    configService: ConfigService,
    walletService: WalletService,
    spendService: SpendService,
    feeUtxos: UTXO[],
    feeRate?: number,
) {


}

// export async function sendCat20(
//     token: any,
//     receiver: btc.Address,
//     amount: string,
//     senderAddress: btc.Address,
//     configService: ConfigService,
//     walletService: WalletService,
//     spendService: SpendService,
//     utxos: UTXO[],
//     feeRate: number,
// ) {
//     try {
//         return await send(
//             token,
//             receiver,
//             BigInt(amount),
//             senderAddress,
//             configService,
//             walletService,
//             spendService,
//             utxos,
//             feeRate,
//         );
//     } catch (error) {
//         console.error("sendTransaction -- ERROR ---", JSON.stringify(error));
//         throw new Error("Transaction failed");
//     }
// }

interface CreateTxResult {

    commitTx: SignTransactionPayload;
    revealTx: SignTransactionPayload;

    // commitTxHash: string;
    // commitTxHex: string;

    // revealTxHash: string;
    // revealTxHex: string;
    networkFee: number;
}

export interface InputToSign {
    address: string;
    signingIndexes: Array<number>;
    sigHash?: number;
}
export interface SignTransactionPayload {
    // network: BitcoinNetwork; // TODO: 2525 review
    message: string;
    psbtBase64: string;
    broadcast?: boolean;
    inputsToSign: InputToSign[];
}
export interface SignTransactionOptions {
    payload: SignTransactionPayload;
    onFinish: (response: any) => void;
    onCancel: () => void;
}
export interface SignTransactionResponse {
    psbtBase64: string;
    txId?: string;
}

const parsePsbtFromTxHex = (txHex: string, inputs: UTXO[], internalPubKeyXOnly: Buffer): Psbt => {
    let psbt = new Psbt({ network: networks.bitcoin });

    let msgTx = Transaction.fromHex(txHex);

    for (let i = 0; i < msgTx.ins.length; i++) {
        let txIn = msgTx.ins[i];

        const inputData: any = {
            hash: txIn.hash,
            index: txIn.index,
            witnessUtxo: { value: inputs[i].satoshis, script: Buffer.from(inputs[i].script, "hex") as Buffer },
            sequence: txIn.sequence,
            tapInternalKey: internalPubKeyXOnly,
        };
        psbt.addInput(inputData);
    }

    for (let i = 0; i < msgTx.outs.length; i++) {
        let txOut = msgTx.outs[i];

        const outputData = {
            address: address.fromOutputScript(txOut.script),
            value: txOut.value,
        }
        psbt.addOutput(outputData);
    }
    return psbt;
}



const createRawTxSendCAT20 = async ({
    senderAddress,
    receiverAddress,
    amount,
    token,
    configService,
    walletService,
    spendService,
    // tokenId,
    feeUtxos,
    feeRate,
}: {
    senderAddress: string;
    receiverAddress: string;
    amount: bigint;
    // tokenId: string;
    token: TokenMetadata,
    configService: ConfigService,
    walletService: WalletService,
    spendService: SpendService,
    feeUtxos: UTXO[],
    feeRate?: number,
    // }) => {
}): Promise<CreateTxResult> => {

    if (feeUtxos.length === 0) {
        console.warn("Insufficient satoshis balance!");
        return;
    }

    const res = await getTokens(configService, spendService, token, senderAddress);
    if (res === null) {
        return;
    }

    const { contracts } = res;

    let tokenContracts = pick(contracts, amount);

    if (tokenContracts.length === 0) {
        console.warn("Insufficient token balance!");
        return;
    }

    // TODO: 2525 NOTE: not updated yet
    const cachedTxs: Map<string, btc.Transaction> = new Map();
    if (tokenContracts.length > 4) {
        console.info(`Merging your [${token.info.symbol}] tokens ...`);
        const [mergedTokens, newfeeUtxos, e] = await mergeTokens(
            configService,
            walletService,
            spendService,
            feeUtxos,
            feeRate,
            token,
            tokenContracts,
            senderAddress,
            cachedTxs,
        );

        if (e instanceof Error) {
            logerror("merge token failed!", e);
            return;
        }

        tokenContracts = mergedTokens;
        feeUtxos = newfeeUtxos;
    }
    console.log("pickLargeFeeUtxo");

    const feeUtxo = pickLargeFeeUtxo(feeUtxos);
    console.log("after pickLargeFeeUtxo");

    const result = await sendToken(
        configService,
        walletService,
        feeUtxo,
        feeRate,
        token,
        tokenContracts,
        senderAddress,
        receiverAddress,
        amount,
        cachedTxs,
    );
    console.log("sendToken");

    if (result) {
        // const commitTxId = await broadcast(
        //     configService,
        //     walletService,
        //     result.commitTx.uncheckedSerialize(),
        // );

        // if (commitTxId instanceof Error) {
        //     throw commitTxId;
        // }

        // spendService.updateSpends(result.commitTx);

        // const revealTxId = await broadcast(
        //     configService,
        //     walletService,
        //     result.revealTx.uncheckedSerialize(),
        // );

        // if (revealTxId instanceof Error) {
        //     throw revealTxId;
        // }

        // spendService.updateSpends(result.revealTx);

        console.log(
            `Sending ${unScaleByDecimals(amount, token.info.decimals)} ${token.info.symbol} tokens to ${receiverAddress} \nin txid: ${result.revealTx.id}`,
        );


        let commitTxHex = result.commitTx.uncheckedSerialize();
        let revealTxHex = result.revealTx.uncheckedSerialize();

        console.log({ commitTxHex });
        console.log({ revealTxHex });

        let commitPsbt = parsePsbtFromTxHex(commitTxHex, [feeUtxo], Buffer.from(walletService.getXOnlyPublicKey(), "hex"));
        let commitIndicesToSign: number[] = [];
        for (let i = 0; i < commitPsbt.txInputs.length; i++) {
            commitIndicesToSign.push(i);
        }

        let commitTx = preparePayloadSignTx({
            base64Psbt: commitPsbt.toBase64(),
            indicesToSign: commitIndicesToSign,
            address: senderAddress,
        })


        let revealPsbt = parsePsbtFromTxHex(revealTxHex, [feeUtxo], Buffer.from(walletService.getXOnlyPublicKey(), "hex"));
        // let revealPsbt = Psbt.fromHex(unpadRevealTxHex, { network: networks.bitcoin });
        let revealIndicesToSign: number[] = [];
        for (let i = 0; i < revealPsbt.txInputs.length; i++) {
            revealIndicesToSign.push(i);
        }

        let revealTx = preparePayloadSignTx({
            base64Psbt: revealPsbt.toBase64(),
            indicesToSign: revealIndicesToSign,
            address: senderAddress,
        })

        const networkFee = result.commitTx.getFee() + result.revealTx.getFee();

        const finalRes: CreateTxResult = {
            commitTx,
            revealTx,
            networkFee,
        }

        return finalRes;
    }
    return null;
};


const preparePayloadSignTx = ({
    base64Psbt,
    indicesToSign,
    address,
    sigHashType = btc.Signature.SIGHASH_DEFAULT
}: {
    base64Psbt: string,
    indicesToSign: number[],
    address: string,
    sigHashType?: number,
}): SignTransactionPayload => {

    return {
        // network: {
        //     type: "Mainnet",
        //     address: "", // TODO:
        // },
        message: "Sign Transaction",
        psbtBase64: base64Psbt,
        broadcast: false,
        inputsToSign: [{
            address: address,
            signingIndexes: indicesToSign,
            sigHash: sigHashType,
        }],
    };
};


export {
    createRawTxSendCAT20,
}
