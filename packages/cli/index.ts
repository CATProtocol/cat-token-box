const express = require("express");

const app = express();

const port = 4000;

import {
  btc,
  OpenMinterTokenInfo,
  logerror,
  TokenContract,
} from "./src/common";
import { ConfigService, SpendService, WalletService } from "./src/providers";
import { findTokenMetadataById, scaleConfig } from "./src/token";
import Decimal from "decimal.js";
import { send } from "./src/processor";
import { UTXO } from "scrypt-ts";

const walletHD = {
  accountPath: "m/86'/0'/0'/0/0",
  name: "AVF",
  mnemonic: "aaa",
};

console.log("WalletService --- ", WalletService);
console.log("ConfigService --- ", ConfigService);

app.use(express.json());

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.get("/get-address", (req: any, res: any) => {
  try {
    let configService = new ConfigService();

    const walletInstance = new WalletService(configService);

    const error = configService.loadCliConfig("./config.json");

    if (error instanceof Error) {
      console.warn("WARNING:", error.message);
    }

    const address = walletInstance.getAddress();

    console.log(`Your address is ${address}`);

    res.status(200).json({ result: address });

    return;
  } catch (error) {
    console.log("error", error);

    res.status(403).json({ error: error.message });
    return;
  } finally {
    console.log("END /get-address ");
  }
});

app.get("/create-wallet", (req: any, res: any) => {
  try {
    console.log("/create-wallet START ");

    let configService = new ConfigService();

    const error = configService.loadCliConfig("./config.json");

    if (error instanceof Error) {
      console.warn("WARNING:", error.message);
    }

    // @ts-ignore
    const walletInstance = new WalletService(configService);
    console.log(" -- walletInstance ", walletInstance);

    const walletFile = walletInstance.foundWallet();

    console.log("walletFile -- ", walletFile);

    if (walletFile !== null) {
      console.log(`found an existing wallet: ${walletFile}`, new Error());
    }

    // const name = options.name
    //   ? options.name
    //   : `cat-${randomBytes(4).toString('hex')}`;

    // const wallet: Wallet = {
    //   accountPath: "m/86'/0'/0'/0/0",
    //   name: name,
    //   mnemonic: bip39.generateMnemonic(),
    // };

    // this.walletService.createWallet(wallet);

    // console.log('Your wallet mnemonic is: ', wallet.mnemonic);

    // console.log('exporting address to the RPC node ... ');

    // const success = await WalletService.importWallet(true);
    // if (success) {
    //   console.log('successfully.');
    // }
  } catch (error) {
    // logerror('Create wallet failed!', error);
    console.log("/create-wallet -- ERROR --- ", JSON.stringify(error));
  } finally {
    console.log("/create-wallet END ");
  }

  res.status(200).json({ message: "hello" });
});

app.post("/name", (req: any, res: any) => {
  const { name, age } = req.body;
  console.log("name", name);
  console.log("age", age);

  res.status(200).json({ name: name, age: age });
  return;
});

app.post("/send", async (req: any, res: any) => {
  try {
    // Get Body
    const {
      privateKey,
      receiver: receiverAddress,
      amount,
      tokenId,
      utxos,
      feeRate,
    } = req.body as {
      privateKey: string;
      receiver: string;
      amount: string;
      tokenId: string;
      utxos: UTXO[];
      feeRate: number;
    };

    console.log("privateKey: ", privateKey);
    console.log("receiver: ", receiverAddress);
    console.log("amount: ", amount);

    console.log("tokenId: ", tokenId);
    for (let utxo of utxos) {
      console.log("utxo: ", utxo);
    }
    console.log("feeRate: ", feeRate);

    console.log("/send START ");

    let configService = new ConfigService();
    const error = configService.loadCliConfig("./config.json");
    if (error instanceof Error) {
      console.warn("WARNING:", error.message);
    }

    const spendService = new SpendService(configService);
    const walletService = new WalletService(configService);
    console.log(" -- spendService ");
    console.log(" -- walletService ");

    walletService.overwriteWallet(privateKey);
    console.log(" -- overwriteWallet ", privateKey);

    const addrWalletService = walletService.getAddress();
    // console.log(" -- addrWalletService ", addrWalletService);

    // find token id
    const senderAddress = walletService.getAddress();
    const token = await findTokenMetadataById(configService, tokenId);

    if (!token) {
      const errMess = `No token metadata found for tokenId: ${tokenId}`;
      console.error(errMess);
      res.status(500).json({ error: errMess });
      return;
    }

    let receiver: btc.Address;

    try {
      receiver = btc.Address.fromString(receiverAddress);

      if (receiver.type !== "taproot") {
        const errMess = `Invalid address type: ${receiver.type}`;
        console.error(errMess);
        res.status(500).json({ error: errMess });
        return;
      }
    } catch (error) {
      const errMess = `Invalid receiver address: "${receiverAddress}" - err: ${error}`;
      console.error(errMess);
      res.status(500).json({ error: errMess });
      return;
    }

    const scaledInfo = scaleConfig(token.info as OpenMinterTokenInfo);
    console.log("scaledInfo: ", scaledInfo);

    let result: {
      commitTx: btc.Transaction;
      revealTx: btc.Transaction;
      contracts: TokenContract[];
    } = {
      commitTx: new btc.Transaction(),
      revealTx: new btc.Transaction(),
      contracts: [],
    };

    result = await send(
      token,
      receiver,
      BigInt(amount),
      senderAddress,
      configService,
      walletService,
      spendService,
      utxos,
      feeRate,
    );
    console.log("===>result: ", result);

    //
    const cmtTxsIn = result.commitTx.inputs;

    console.log("cmtTxIn 0: ", cmtTxsIn[0].output._satoshisBN.words);
    // console.log("cmtTxIn 1: ", cmtTxsIn[1].output._satoshisBN.words);
    //
    const cmtTxsOut = result.commitTx.outputs;

    console.log("cmtTxOut 0: ", cmtTxsOut[0]);
    console.log("cmtTxOut 1: ", cmtTxsOut[1]);
    console.log("input Amt: ", result.commitTx.getFee());
    console.log("output Amt: ", result.revealTx.getFee());

    if (!result) {
      const errMess = `send failed!`;
      console.error(errMess);
      res.status(500).json({ error: errMess });
      return;
    }
    console.log("result.commitTx.id", result.commitTx.id);
    console.log("result.revealTx.id", result.revealTx.id);

    res.status(200).json({
      commitTxHash: result.commitTx.id,
      commitTxHex: result.commitTx.uncheckedSerialize(),
      revealTxHash: result.revealTx.id,
      revealTxHex: result.revealTx.uncheckedSerialize(),
      networkFee: 0,
    });
    return;
  } catch (error) {
    console.log("/send -- ERROR --- ", JSON.stringify(error));
    res.status(500).json({ error: "Send transaction failed!" });
  } finally {
    console.log("/send END ");
  }
});
