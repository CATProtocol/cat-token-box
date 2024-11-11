import {
  toTxOutpoint,
  getDummySigner,
  getDummyUTXO,
  callToBufferList,
  toTokenAddress,
  getGuardsP2TR,
  getCollectionContractP2TR,
  resetTx,
  toStateScript,
  toP2tr,
  script2P2TR,
  p2tr2Address,
  verifyContract,
} from "./utils";
import {
  int2ByteString,
  MethodCallOptions,
  toByteString,
  PubKey,
  UTXO,
  fill,
  Sig,
} from "scrypt-ts";
import {
  emptyTokenAmountArray,
  emptyTokenArray,
  getBackTraceInfo,
  ProtocolState,
  NftGuardProto,
  CAT721Proto,
  TransferGuard,
  getTxHeaderCheck,
  getTxCtxMulti,
  TokenUnlockArgs,
  PreTxStatesInfo,
  ChangeInfo,
  MAX_TOKEN_OUTPUT,
  MAX_INPUT,
  CAT721State,
  NftGuardInfo,
  CAT721,
} from "@cat-protocol/cat-smartcontracts";
import { ConfigService } from "./configService";
import { NFTContract, NftGuardContract } from "./contact";
import { btc } from "./btc";
import { CHANGE_MIN_POSTAGE, Postage } from "./postage";
import { CollectionInfo } from "./metadata";
import { DUMMY_SIG, WalletService } from "./walletService";
import { getRawTransaction } from "./apis";

async function unlockToken(
  wallet: WalletService,
  nftContract: NFTContract,
  nftInputIndex: number,
  prevTokenTx: btc.Transaction,
  preTokenInputIndex: number,
  prevPrevTokenTx: btc.Transaction,
  guardInfo: NftGuardInfo,
  revealTx: btc.Transaction,
  minterP2TR: string,
  txCtx: any,
  sig: string,
  verify: boolean
) {
  const { cblock: cblockToken, contract: token } =
    getCollectionContractP2TR(minterP2TR);

  const { shPreimage, prevoutsCtx, spentScripts } = txCtx;

  const pubkeyX = await wallet.getXOnlyPublicKey();
  const pubKeyPrefix = await wallet.getPubKeyPrefix();
  const tokenUnlockArgs: TokenUnlockArgs = {
    isUserSpend: true,
    userPubKeyPrefix: pubKeyPrefix,
    userPubKey: PubKey(pubkeyX),
    userSig: Sig(sig),
    contractInputIndex: 0n,
  };
  const backtraceInfo = getBackTraceInfo(
    prevTokenTx,
    prevPrevTokenTx,
    preTokenInputIndex
  );

  const {
    state: { protocolState, data: preState },
  } = nftContract;

  await token.connect(getDummySigner());
  const preTxState: PreTxStatesInfo = {
    statesHashRoot: protocolState.hashRoot,
    txoStateHashes: protocolState.stateHashList,
  };

  const tokenCall = await token.methods.unlock(
    tokenUnlockArgs,
    preState,
    preTxState,
    guardInfo,
    backtraceInfo,
    shPreimage,
    prevoutsCtx,
    spentScripts,
    {
      fromUTXO: getDummyUTXO(),
      verify: false,
      exec: false,
    } as MethodCallOptions<CAT721>
  );

  console.log("cblockToken", cblockToken);
  const witnesses = [
    ...callToBufferList(tokenCall),
    // taproot script + cblock
    token.lockingScript.toBuffer(),
    Buffer.from(cblockToken, "hex"),
  ];
  revealTx.inputs[nftInputIndex].witnesses = witnesses;

  if (verify) {
    const res = verifyContract(
      nftContract.utxo,
      revealTx,
      nftInputIndex,
      witnesses
    );
    if (typeof res === "string") {
      console.error("unlocking token contract failed!", res);
      return false;
    }
    return true;
  }

  return true;
}

async function unlockGuard(
  guardContract: NftGuardContract,
  guardInfo: NftGuardInfo,
  guardInputIndex: number,
  newState: ProtocolState,
  revealTx: btc.Transaction,
  receiverTokenState: CAT721State,
  changeInfo: ChangeInfo,
  txCtx: any,
  verify: boolean
) {
  // amount check run verify
  const { shPreimage, prevoutsCtx, spentScripts } = txCtx;
  const outputArray = emptyTokenArray();
  const tokenAmountArray = emptyTokenAmountArray();
  const tokenOutputIndexArray = fill(false, MAX_TOKEN_OUTPUT);
  outputArray[0] = receiverTokenState.ownerAddr;
  tokenAmountArray[0] = receiverTokenState.localId;
  tokenOutputIndexArray[0] = true;
  const satoshiChangeOutputIndex = 1;

  const { cblock: transferCblock, contract: transferGuard } = getGuardsP2TR();

  await transferGuard.connect(getDummySigner());

  const outpointSatoshiArray = emptyTokenArray();
  outpointSatoshiArray[satoshiChangeOutputIndex] = changeInfo.satoshis;
  outputArray[satoshiChangeOutputIndex] = changeInfo.script;
  tokenOutputIndexArray[satoshiChangeOutputIndex] = false;

  const transferGuardCall = await transferGuard.methods.transfer(
    newState.stateHashList,
    outputArray,
    tokenAmountArray,
    tokenOutputIndexArray,
    outpointSatoshiArray,
    int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n),
    guardContract.state.data,
    guardInfo.tx,
    shPreimage,
    prevoutsCtx,
    spentScripts,
    {
      fromUTXO: getDummyUTXO(),
      verify: false,
      exec: false,
    } as MethodCallOptions<TransferGuard>
  );
  const witnesses = [
    ...callToBufferList(transferGuardCall),
    // taproot script + cblock
    transferGuard.lockingScript.toBuffer(),
    Buffer.from(transferCblock, "hex"),
  ];
  revealTx.inputs[guardInputIndex].witnesses = witnesses;

  if (verify) {
    const res = verifyContract(
      guardContract.utxo,
      revealTx,
      guardInputIndex,
      witnesses
    );
    if (typeof res === "string") {
      console.error("unlocking guard contract failed!", res);
      return false;
    }
    return true;
  }
  return true;
}

export async function createGuardContract(
  wallet: WalletService,
  feeutxo: UTXO,
  feeRate: number,
  tokens: NFTContract[],
  tokenP2TR: string,
  changeAddress: btc.Address
) {
  const { p2tr: guardP2TR, tapScript: guardTapScript } = getGuardsP2TR();

  const protocolState = ProtocolState.getEmptyState();
  const realState = NftGuardProto.createEmptyState();
  realState.collectionScript = tokenP2TR;

  for (let i = 0; i < tokens.length; i++) {
    realState.localIdArray[i] = tokens[i].state.data.localId;
  }

  protocolState.updateDataList(0, NftGuardProto.toByteString(realState));

  const commitTx = new btc.Transaction()
    .from(feeutxo)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(protocolState),
      })
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.GUARD_POSTAGE,
        script: guardP2TR,
      })
    )
    .feePerByte(feeRate)
    .change(changeAddress);

  if (commitTx.getChangeOutput() === null) {
    console.error("Insufficient satoshis balance!");
    return null;
  }
  commitTx.outputs[2].satoshis -= 1;
  await wallet.signFeeInput(commitTx);

  const contact: NftGuardContract = {
    utxo: {
      txId: commitTx.id,
      outputIndex: 1,
      script: commitTx.outputs[1].script.toHex(),
      satoshis: commitTx.outputs[1].satoshis,
    },
    state: {
      protocolState,
      data: realState,
    },
  };

  return {
    commitTx,
    contact,
    guardTapScript,
  };
}

export async function sendNft(
  config: ConfigService,
  wallet: WalletService,
  feeUtxo: UTXO,
  feeRate: number,
  metadata: CollectionInfo,
  nfts: NFTContract[],
  changeAddress: btc.Address,
  receiver: btc.Address,
  cachedTxs: Map<string, btc.Transaction>
): Promise<{
  commitTx: btc.Transaction;
  revealTx: btc.Transaction;
  contracts: NFTContract[];
} | null> {
  if (nfts.length === 0) {
    console.warn("Insufficient token balance!");
    return null;
  }
  const minterP2TR = toP2tr(metadata.minterAddr);

  const { p2tr: tokenP2TR, tapScript: tokenTapScript } =
    getCollectionContractP2TR(minterP2TR);

  const commitResult = await createGuardContract(
    wallet,
    feeUtxo,
    feeRate,
    nfts,
    tokenP2TR,
    changeAddress
  );

  if (commitResult === null) {
    return null;
  }

  const { commitTx, contact: guardContract, guardTapScript } = commitResult;

  const newState = ProtocolState.getEmptyState();

  const receiverTokenState = CAT721Proto.create(
    toTokenAddress(receiver),
    nfts[0].state.data.localId
  );

  newState.updateDataList(0, CAT721Proto.toByteString(receiverTokenState));
  const newFeeUtxo = {
    txId: commitTx.id,
    outputIndex: 2,
    script: commitTx.outputs[2].script.toHex(),
    satoshis: commitTx.outputs[2].satoshis,
  };

  const inputUtxos = [
    ...nfts.map((t) => t.utxo),
    guardContract.utxo,
    newFeeUtxo,
  ];

  if (inputUtxos.length > MAX_INPUT) {
    throw new Error("to much input");
  }

  const revealTx = new btc.Transaction()
    .from(inputUtxos)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(newState),
      })
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.TOKEN_POSTAGE,
        script: tokenP2TR,
      })
    )
    .feePerByte(feeRate);

  const satoshiChangeScript = btc.Script.fromAddress(changeAddress);
  revealTx.addOutput(
    new btc.Transaction.Output({
      satoshis: 0,
      script: satoshiChangeScript,
    })
  );

  const tokenTxs: Array<{
    prevTx: btc.Transaction;
    prevTokenInputIndex: number;
    prevPrevTx: btc.Transaction;
  } | null> = await Promise.all(
    nfts.map(async ({ utxo: tokenUtxo }) => {
      let prevTx: btc.Transaction | null = null;
      if (cachedTxs.has(tokenUtxo.txId)) {
        prevTx = cachedTxs.get(tokenUtxo.txId);
      } else {
        const prevTxHex = await getRawTransaction(config, tokenUtxo.txId);
        if (prevTxHex instanceof Error) {
          console.error(
            `get raw transaction ${tokenUtxo.txId} failed!`,
            prevTxHex
          );
          return null;
        }
        prevTx = new btc.Transaction(prevTxHex);

        cachedTxs.set(tokenUtxo.txId, prevTx);
      }

      let prevTokenInputIndex = 0;

      const input = prevTx.inputs.find((input: any, inputIndex: number) => {
        const witnesses = input.getWitnesses();

        if (Array.isArray(witnesses) && witnesses.length > 2) {
          const lockingScriptBuffer = witnesses[witnesses.length - 2];
          const { p2tr } = script2P2TR(lockingScriptBuffer);

          const address = p2tr2Address(p2tr, config.getNetwork());
          if (
            address === metadata.collectionAddr ||
            address === metadata.minterAddr
          ) {
            prevTokenInputIndex = inputIndex;
            return true;
          }
        }
        return false;
      });

      if (!input) {
        console.error(`There is no valid preTx of the ftUtxo!`);
        return null;
      }

      let prevPrevTx: btc.Transaction | null = null;

      const prevPrevTxId =
        prevTx.inputs[prevTokenInputIndex].prevTxId.toString("hex");

      if (cachedTxs.has(prevPrevTxId)) {
        prevPrevTx = cachedTxs.get(prevPrevTxId);
      } else {
        const prevPrevTxHex = await getRawTransaction(config, prevPrevTxId);
        if (prevPrevTxHex instanceof Error) {
          console.error(
            `get raw transaction ${prevPrevTxId} failed!`,
            prevPrevTxHex
          );
          return null;
        }
        prevPrevTx = new btc.Transaction(prevPrevTxHex);
        cachedTxs.set(prevPrevTxId, prevPrevTx);
      }

      return {
        prevTx,
        prevTokenInputIndex,
        prevPrevTx,
      };
    })
  );

  const success = tokenTxs.every((t) => t !== null);

  if (!success) {
    return null;
  }

  const guardCommitTxHeader = getTxHeaderCheck(
    commitTx,
    guardContract.utxo.outputIndex
  );

  const guardInputIndex = nfts.length;
  const guardInfo: NftGuardInfo = {
    outputIndex: toTxOutpoint(
      guardContract.utxo.txId,
      guardContract.utxo.outputIndex
    ).outputIndex,
    inputIndexVal: BigInt(guardInputIndex),
    tx: guardCommitTxHeader.tx,
    guardState: guardContract.state.data,
  };

  const vsize = await calcVsize(
    wallet,
    nfts,
    guardContract,
    revealTx,
    guardInfo,
    tokenTxs as Array<{
      prevTx: btc.Transaction;
      prevPrevTx: btc.Transaction;
      prevTokenInputIndex: number;
    }>,
    tokenTapScript,
    guardTapScript,
    newState,
    receiverTokenState,
    satoshiChangeScript,
    minterP2TR
  );

  const satoshiChangeAmount =
    revealTx.inputAmount - vsize * feeRate - Postage.TOKEN_POSTAGE;

  if (satoshiChangeAmount <= CHANGE_MIN_POSTAGE) {
    console.error("Insufficient satoshis balance!");
    return null;
  }

  const satoshiChangeOutputIndex = 2;

  // update change amount
  revealTx.outputs[satoshiChangeOutputIndex].satoshis = satoshiChangeAmount;

  const txCtxs = getTxCtxMulti(
    revealTx,
    nfts.map((_, i) => i).concat([nfts.length]),
    [
      ...new Array(nfts.length).fill(Buffer.from(tokenTapScript, "hex")),
      Buffer.from(guardTapScript, "hex"),
    ]
  );

  const changeInfo: ChangeInfo = {
    script: toByteString(satoshiChangeScript.toHex()),
    satoshis: int2ByteString(BigInt(satoshiChangeAmount), 8n),
  };

  const verify = config.getVerify();
  console.log("config verify:", verify);

  const sigs = await wallet.signNft(revealTx, metadata);

  for (let i = 0; i < nfts.length; i++) {
    // ignore changeInfo when transfer token
    const tokenTx = tokenTxs[i];

    if (tokenTx === null) {
      throw new Error("tokenTx null");
    }

    const res = await unlockToken(
      wallet,
      nfts[i],
      i,
      tokenTx.prevTx,
      tokenTx.prevTokenInputIndex,
      tokenTx.prevPrevTx,
      guardInfo,
      revealTx,
      minterP2TR,
      txCtxs[i],
      sigs[i],
      verify
    );

    if (!res) {
      return null;
    }
  }

  const res = await unlockGuard(
    guardContract,
    guardInfo,
    guardInputIndex,
    newState,
    revealTx,
    receiverTokenState,
    changeInfo,
    txCtxs[guardInputIndex],
    verify
  );

  if (!res) {
    return null;
  }

  //await wallet.signFeeInput(revealTx);

  const receiverTokenContract: NFTContract = {
    utxo: {
      txId: revealTx.id,
      outputIndex: 1,
      script: revealTx.outputs[1].script.toHex(),
      satoshis: revealTx.outputs[1].satoshis,
    },
    state: {
      protocolState: newState,
      data: receiverTokenState,
    },
  };

  const contracts: NFTContract[] = [];
  contracts.push(receiverTokenContract);

  return {
    commitTx,
    revealTx,
    contracts,
  };
}

const calcVsize = async (
  wallet: WalletService,
  tokens: NFTContract[],
  guardContract: NftGuardContract,
  revealTx: btc.Transaction,
  guardInfo: NftGuardInfo,
  tokenTxs: Array<{
    prevTx: btc.Transaction;
    prevPrevTx: btc.Transaction;
    prevTokenInputIndex: number;
  }>,
  tokenTapScript: string,
  guardTapScript: string,
  newState: ProtocolState,
  receiverTokenState: CAT721State,
  satoshisChangeScript: btc.Script,
  minterP2TR: string
) => {
  const txCtxs = getTxCtxMulti(
    revealTx,
    tokens.map((_, i) => i).concat([tokens.length]),
    [
      ...new Array(tokens.length).fill(Buffer.from(tokenTapScript, "hex")),
      Buffer.from(guardTapScript, "hex"),
    ]
  );

  const guardInputIndex = tokens.length;

  const changeInfo: ChangeInfo = {
    script: satoshisChangeScript.toHex(),
    satoshis: int2ByteString(0n, 8n),
  };

  const sigs = new Array(tokens.length).fill(DUMMY_SIG);
  for (let i = 0; i < tokens.length; i++) {
    await unlockToken(
      wallet,
      tokens[i],
      i,
      tokenTxs[i].prevTx,
      tokenTxs[i].prevTokenInputIndex,
      tokenTxs[i].prevPrevTx,
      guardInfo,
      revealTx,
      minterP2TR,
      txCtxs[i],
      sigs[i],
      false
    );
  }

  await unlockGuard(
    guardContract,
    guardInfo,
    guardInputIndex,
    newState,
    revealTx,
    receiverTokenState,
    changeInfo,
    txCtxs[guardInputIndex],
    false
  );
  await wallet.dummySignFeeInput(revealTx);
  const vsize = revealTx.vsize;
  resetTx(revealTx);
  return vsize;
};
