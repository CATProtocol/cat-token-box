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
import { estFeeSendCat20, sendCat20 } from "./src/sendCat20Handler";
import { UTXO } from "scrypt-ts";

import { createRawTxSendCAT20 } from "./src/sdk";

const walletHD = {
  accountPath: "m/86'/0'/0'/0/0",
  name: "AVF",
  mnemonic: "aaa",
};

console.log("WalletService --- ", WalletService);
console.log("ConfigService --- ", ConfigService);

interface SendCAT20Result {
  commitTxID: string
  revealTxID: string
  commitTxHex: string
  revealTxHex: string
  networkFee: number  // in fb decimal
}

interface SendCAT20Response {
  errorCode: number
  errorMsg: string
  result: SendCAT20Result
}


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


app.post("/send-cat20", async (req: any, res: any) => {
  try {
    console.log("req.body: ", req.body);
    // Get Body
    const {
      privateKey,
      receiver: receiverAddress,
      amount,
      tokenId,
      utxos,
      feeRate,
      withdrawUUID,
      isBroadcast = false,
    } = req.body as {
      privateKey: string;
      receiver: string;
      amount: string;
      tokenId: string;
      utxos: UTXO[];
      feeRate: number;
      withdrawUUID: string;
      isBroadcast?: boolean;
    };

    console.log({ tokenId });
    console.log({ amount });
    console.log({ receiverAddress });
    console.log({ feeRate });

    console.log("/send START ");


    if (!tokenId) {
      return createErrorUnknown(res, `tokenId empty.`);
    }
    if (!amount) {
      return createErrorUnknown(res, `amount empty.`);
    }
    if (!receiverAddress) {
      return createErrorUnknown(res, `receiver empty.`);
    }
    if (!feeRate) {
      return createErrorUnknown(res, `feeRate empty.`);
    }

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
      return createErrorUnknown(res, `Token not found: ${tokenId}`);
    }

    let receiver: btc.Address;

    try {
      receiver = btc.Address.fromString(receiverAddress);

      if (receiver.type !== "taproot") {
        return createErrorUnknown(res, `Invalid address type: ${receiver.type}`)
      }
    } catch (error) {
      return createErrorUnknown(res, `Invalid receiver address: "${receiverAddress}" - err: ${error}`)
    }

    const resp = await sendCat20(
      token,
      receiver,
      amount,
      senderAddress,
      configService,
      walletService,
      spendService,
      utxos,
      isBroadcast,
      feeRate,
    );

    if (resp.errorCode) {
      // save logs 1
      try {
        saveLogs(withdrawUUID, senderAddress.toString(), receiver.toString(), token.tokenId, token.info.symbol, amount.toString(), res, resp)
      } catch (error) {
        console.log("saveLogs1 er", error)
      }
      return handleErrorResponse(res, resp.errorCode, resp.errorMsg)
    }

    const result = resp.result

    const networkFee = result.commitTx.getFee() + result.revealTx.getFee();

    console.log("result.commitTx.id", result.commitTx.id);
    console.log("result.revealTx.id", result.revealTx.id);
    console.log("Total network fee: ", networkFee);


    const dataResp: SendCAT20Result = {
      commitTxID: result.commitTx.id,
      commitTxHex: result.commitTx.uncheckedSerialize(),
      revealTxID: result.revealTx.id,
      revealTxHex: result.revealTx.uncheckedSerialize(),
      networkFee: networkFee,
    }

    let logResp: SendCAT20Response = {
      errorCode: 0,
      errorMsg: "",
      result: dataResp,
    }

    // save logs 2:
    try {
      saveLogs(withdrawUUID, senderAddress.toString(), receiver.toString(), token.tokenId, token.info.symbol, amount.toString(), res, logResp)
    } catch (error) {
      console.log("saveLogs2 er", error)
    }

    return handleResponseOK(res, dataResp)

  } catch (error) {
    console.log("/send -- ERROR --- ", error);
    // res.status(500).json({ error: error.message || error, message: "Insufficient balance" });
    return handleErrorResponse(res, '-9999', error)
  } finally {
    console.log("/send END ");
  }
});


app.post("/est-fee-send-cat20", async (req: any, res: any) => {
  try {
    // Get Body
    const {
      privateKey,
      amount,
      tokenId,
    } = req.body as {
      privateKey: string;
      amount: string;
      tokenId: string;
    };

    console.log({ tokenId });
    console.log({ amount });

    console.log("/est-fee-send-cat20 START ");

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

    const result = await estFeeSendCat20(
      token,
      amount,
      senderAddress,
      configService,
      spendService,
    );

    console.log("estFeeSendCat20 result ", result);

    res.status(200).json({
      pickedUTXOs: result,
    });

  } catch (error) {
    console.log("/est-fee-send-cat20 -- ERROR --- ", error);
    res.status(500).json({ error: error });
  } finally {
    console.log("/est-fee-send-cat20 END ");
  }
});


app.post("/create-tx-send-cat20", async (req: any, res: any) => {
  try {
    console.log("create-tx-send-cat20 req.body: ", req.body);
    // Get Body
    const {
      senderAddress,
      senderPubKey,
      receiverAddress,
      amount,
      tokenId,
      utxos,
      feeRate,
    } = req.body as {
      senderAddress: string;
      senderPubKey: string;   // internal pub key 33 bytes - hex encode
      receiverAddress: string;
      amount: string;
      tokenId: string;
      utxos: UTXO[];
      feeRate: number;
    };

    console.log("/create-tx-send-cat20 req.body: ", req.body);
    console.log({ tokenId });
    console.log({ amount });
    console.log({ receiverAddress });
    console.log({ feeRate });

    console.log("/create-tx-send-cat20 START ");

    let configService = new ConfigService();
    const error = configService.loadCliConfig("./config.json");
    if (error instanceof Error) {
      console.warn("WARNING:", error.message);
    }

    const spendService = new SpendService(configService);
    const walletService = new WalletService(configService);

    const senderPubKeyBytes = Buffer.from(senderPubKey, "hex");
    walletService.overwriteWalletByAddress(senderAddress, senderPubKeyBytes);
    // console.log(" -- overwriteWallet ");
    // console.log("New wallet address: ", walletService.getAddress());

    // find token id
    // const senderAddress = walletService.getAddress();
    const token = await findTokenMetadataById(configService, tokenId);

    if (!token) {
      return handleError(res, `create-tx-send-cat20 Token not found: ${tokenId}`);
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

    const result = await createRawTxSendCAT20({
      senderAddress,
      receiverAddress,
      amount: BigInt(amount),
      token,
      configService,
      spendService,
      walletService,
      feeUtxos: utxos,
      feeRate
    });
    // token,
    // receiver,
    // amount,
    // senderAddress,
    // configService,
    // walletService,
    // spendService,
    // utxos,
    // feeRate,


    if (!result) {
      return handleError(res, `create-tx-send-cat20 failed!`);
    }

    // const networkFee = result.commitTx.getFee() + result.revealTx.getFee();

    console.log("result.commitTx.id", result.commitTx.psbtBase64);
    console.log("result.revealTx.id", result.revealTx.psbtBase64);
    // console.log("Total network fee: ", networkFee);

    res.status(200).json(result);

  } catch (error) {
    console.log("/create-tx-send-cat20 -- ERROR --- ", error);
    console.log("/create-tx-send-cat20 -- ERROR --- ", JSON.stringify(error) || error);
    res.status(500).json({ error: "Send transaction failed!" });
  } finally {
    console.log("/create-tx-send-cat20 END ");
  }
});



const errorCodes = {
  '-1000': "Insufficient satoshis balance!",
  '-1001': "Insufficient token balance!",
  '-1002': "Merge token failed!"
};

function handleErrorResponse(res: any, errorCode, errorMsgInput = "") {
  const errorMsg = errorCodes[errorCode] || errorMsgInput;
  res.status(500).json({
    errorCode: parseInt(errorCode),
    errorMsg: errorMsg,
    result: null
  });
}

function createErrorUnknown(res: any, errorMsg) {
  res.status(500).json({
    errorCode: parseInt('-9999'),
    errorMsg: errorMsg,
    result: null
  });
}

function handleResponseOK(res: any, result = {}) {
  res.status(200).json({
    errorCode: 0,
    errorMsg: "",
    result: result
  });
}

function handleError(res: any, message: string) {
  console.error(message);
  res.status(500).json({ error: message });
}

// save log:
const axios = require('axios');
function saveLogs(withdrawUUID, senderAddress, receivedAddresses, tokenID, symbol, amount, reqs, resps) {

  try {
    let data = JSON.stringify({
      "withdrawUUID": withdrawUUID,
      "senderAddress": senderAddress,
      "tokenID": tokenID,
      "symbol": symbol,
      "amount": amount,
      "receivedAddresses": receivedAddresses,
      "reqs": reqs,
      "resps": resps,
    });

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://fractal-bridges-api.trustless.computer/api/cat20/internal/add-withdraw-logs',
      headers: {
        'Content-Type': 'application/json'
      },
      data: data
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
      })
      .catch((error) => {
        console.log("function saveLogs error1", error);
      });
  } catch (error) {
    console.log("function saveLogs error2", error);
  }
}