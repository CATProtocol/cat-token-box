import React, { useRef, useState } from "react";
import "./App.css";
import { btc } from "./btc";
import { CollectionInfo } from "./metadata";
import { getBalance, getCollectionInfo, getCollections } from "./apis-tracker";
import { ConfigService, SupportedNetwork } from "./configService";
import { unScaleByDecimals } from "./utils";

import { useForm } from "react-hook-form";
import { WalletService } from "./walletService";
import { sendNft } from "./nft";
import { broadcast } from "./apis";
import { useWallet } from "./unisat";
import useSWR from "swr";
import { pickLargeFeeUtxo } from "./pick";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  Input,
  InputLabel,
} from "@mui/material";
import Divider from "@mui/material/Divider";
function App() {
  const {
    register,
    handleSubmit,
  } = useForm();

  const [txid, setTxId] = useState<string| undefined>(undefined);
  const { address, setAddress, isWalletConnected, setIsWalletConnected } =
    useWallet();
  const configService = useRef<ConfigService>(new ConfigService());
  const walletService = useRef<WalletService>(new WalletService());

  const network: SupportedNetwork = (process.env.REACT_APP_NETWORK || "fractal-testnet") as SupportedNetwork;
  configService.current.loadCliConfig({
    network: network,
    tracker: process.env.REACT_APP_TRACKER_URL || "http://127.0.0.1:3000",
    dataDir: ".",
    maxFeeRate: 1,
    rpc: null,
  });

  function useFetchCollectionInfodata() {
    return useSWR<CollectionInfo, Error>("/fetchmetadata", async () => {
      const metadata = await getCollectionInfo(
        configService.current,
        process.env.REACT_APP_TOKEN_ID || ""
      );

      if (metadata === null) {
        throw new Error("getTokenMetadata failed");
      }
      return metadata;
    });
  }

  const { data: metadata } = useFetchCollectionInfodata();

  function useFetchBalance(metadata: CollectionInfo | undefined, address: any) {
    return useSWR<
      {
        collectionId: string;
        symbol: string;
        confirmed: bigint;
      },
      Error
    >("/fetchbalance", async () => {
      console.log("getBalance", metadata);
      if (metadata && address) {
        const balance = await getBalance(
          configService.current,
          metadata,
          address
        );

        if (balance === null) {
          throw new Error("getBalance failed");
        }
        return balance;
      }
      throw new Error("getBalance no metadata");
    });
  }

  const { data: balance } = useFetchBalance(metadata, address);

  const onSubmit = async (data: any) => {
    console.log("onSubmit:", data);
    // async request which may result error
    try {
      if (!metadata) {
        console.warn("onSubmit but no metadata");
        return;
      }

      const utxos = await walletService.current.getUTXOs();
      if(utxos.length === 0) {
        alert("Insufficient satoshis balance!");
        return;
      }
      // get one nft utxo
      const receiver = btc.Address.fromString(data.address);

      const res = await getCollections(configService.current, metadata, address);

      if (res === null) {
        console.error("getTokens null");
        return;
      }
      const { contracts } = res;
      const cachedTxs: Map<string, btc.Transaction> = new Map();
      const feeRate = 10;
      const sendRes = await sendNft(
        configService.current,
        walletService.current,
        pickLargeFeeUtxo(utxos),
        feeRate,
        metadata,
        [contracts[0]],
        address,
        receiver,
        cachedTxs
      );

      if (sendRes === null) {
        console.error("sendToken null");
        return;
      }
      console.error("sendToken sendRes", sendRes);
      const { commitTx, revealTx } = sendRes;

      const commitTxId = await broadcast(
        configService.current,
        commitTx.uncheckedSerialize()
      );

      if (commitTxId instanceof Error) {
        throw commitTxId;
      }

      const revealTxId = await broadcast(
        configService.current,
        revealTx.uncheckedSerialize()
      );

      if (revealTxId instanceof Error) {
        throw revealTxId;
      }

      console.log(
        `Sending ${contracts[0].state.data.localId} ${metadata.metadata.symbol} nft to ${receiver} \nin txid: ${revealTxId}`
      );

      setTxId(revealTxId)
    } catch (e) {
      // handle your error
      console.error("submit error:", e);
    }
  };

  const onConnect = async () => {
    console.log("onConnect ...");
    // async request which may result error
    try {
      const res = await window.unisat.requestAccounts();

      if (Array.isArray(res)) {
        console.log("onConnect success", res);
        setAddress(res[0]);
        setIsWalletConnected(true);
      }
    } catch (e) {
      // handle your error
      console.error("onConnect error:", e);
    }
  };

  return (
    <Container className="App">
      {!isWalletConnected ? (
        <Box sx={{ marginTop: 16 }}>
          <Button variant="contained" onClick={onConnect}>
            Connect Wallet
          </Button>
        </Box>
      ) : (
        <></>
      )}

      <Divider sx={{ marginTop: 8 }} />

      <Box className="App-header">
        <Box>
          Address:{" "}
          <Chip label={address || ""} variant="outlined" color="info" />{" "}
        </Box>
        <Box>
          CollectionId:{" "}
          <Chip
            label={process.env.REACT_APP_TOKEN_ID || ""}
            variant="outlined"
            color="info"
          />{" "}
        </Box>

        {metadata && balance ? (
          <>
            <p>Symbol: {metadata.metadata.symbol}</p>
            <p>
              NftCount:{" "}
              {unScaleByDecimals(balance.confirmed, 0)}, while select one nft to send
            </p>
            <form onSubmit={handleSubmit(onSubmit)}>
              <FormControl sx={{ width: "25ch" }}>
                <InputLabel htmlFor="receiver_address">Send to:</InputLabel>
                <Input
                  id="receiver_address"
                  type="text"
                  {...register("address", { required: true })}
                  placeholder="receiver address"
                />
              </FormControl>
              <br />
              <Button type="submit">send</Button>
            </form>
          </>
        ) : (
          <CircularProgress />
        )}
      </Box>

      {txid && metadata ? (
        <Alert variant="filled" severity="success" onClose={() => {
          setTxId(undefined)
        }}>
          {`Sending ${metadata.metadata.symbol} tokens in txid: ${txid}`}
        </Alert>
      ) : (
        <></>
      )}
    </Container>
  );
}

export default App;
