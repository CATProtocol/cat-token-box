const express = require("express");
const app = express();

const port = 3333;

import {
  btc,
  OpenMinterTokenInfo,
  logerror,
  TokenContract,
} from "./src/common";
import { ConfigService, SpendService, WalletService } from "./src/providers";
import { findTokenMetadataById, scaleConfig } from "./src/token";
import Decimal from "decimal.js";
import { sendCat20 } from "./src/sendCat20Handler";
import { UTXO } from "scrypt-ts";
import { network } from "../tracker/src/common/constants";

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

function handleError(res: any, message: string) {
  console.error(message);
  res.status(500).json({ error: message });
}

app.post("/send-cat20", async (req: any, res: any) => {
  try {
    // Get Body
    let {
      privateKey,
      receiver: receiverAddress,
      amount,
      tokenId,
      utxos,
      feeRate,
      changeAddress,
    } = req.body as {
      privateKey: string;
      receiver: string;
      amount: string;
      tokenId: string;
      utxos: UTXO[];
      feeRate: number;
      changeAddress: string;
    };

    console.log("/send START ");

    let configService = new ConfigService();
    const error = configService.loadCliConfig("./config.json");
    if (error instanceof Error) {
      console.warn("WARNING:", error.message);
    }

    const spendService = new SpendService(configService);
    const walletService = new WalletService(configService);

    walletService.overwriteWallet(privateKey);
    console.log(" -- overwriteWallet ");
    console.log("New wallet address: ", walletService.getAddress());

    // find token id
    const senderAddress = walletService.getAddress();
    const token = await findTokenMetadataById(configService, tokenId);

    if (!token) {
      return handleError(res, `Token not found: ${tokenId}`);
    }

    let receiver: btc.Address;

    try {
      receiver = btc.Address.fromString(receiverAddress);

      if (receiver.type !== "taproot") {
        return handleError(res, `Invalid address type: ${receiver.type}`);
      }
    } catch (error) {
      return handleError(
        res,
        `Invalid receiver address: "${receiverAddress}" - err: ${error}`,
      );
    }

    const scaledInfo = scaleConfig(token.info as OpenMinterTokenInfo); //TODO: kelvin consider to remove
    console.log("scaledInfo: ", scaledInfo);

    let changeBTCAddress;
    console.log("changeAddress: ", changeAddress);
    if (!changeAddress) {
      changeBTCAddress = senderAddress;
    } else {
      changeBTCAddress = btc.Address.fromString(
        changeAddress,
        senderAddress.network,
        btc.Address.PayToTaproot,
      );
    }
    console.log("changeBTCAddress: ", changeBTCAddress);

    const result = await sendCat20(
      token,
      receiver,
      amount,
      senderAddress,
      changeBTCAddress,
      configService,
      walletService,
      spendService,
      utxos,
      feeRate,
    );

    if (!result) {
      return handleError(res, `send failed!`);
    }

    const networkFee = result.commitTx.getFee() + result.revealTx.getFee();

    console.log("result.commitTx.id", result.commitTx.id);
    console.log("result.revealTx.id", result.revealTx.id);
    console.log("Total network fee: ", networkFee);

    res.status(200).json({
      commitTxHash: result.commitTx.id,
      commitTxHex: result.commitTx.uncheckedSerialize(),
      revealTxHash: result.revealTx.id,
      revealTxHex: result.revealTx.uncheckedSerialize(),
      networkFee: networkFee,
    });
  } catch (error) {
    console.log("/send -- ERROR --- ", JSON.stringify(error));
    res.status(500).json({ error: "Send transaction failed!" });
  } finally {
    console.log("/send END ");
  }
});
