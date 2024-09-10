import {
  toTxOutpoint,
  getRawTransaction,
  getDummySigner,
  getDummyUTXO,
  callToBufferList,
  toTokenAddress,
  getGuardsP2TR,
  getTokenContractP2TR,
  resetTx,
  toStateScript,
  TokenContract,
  TokenMetadata,
  toP2tr,
  GuardContract,
  script2P2TR,
  p2tr2Address,
  Postage,
  CHANGE_MIN_POSTAGE,
  logerror,
  btc,
  verifyContract,
} from 'src/common';
import {
  int2ByteString,
  MethodCallOptions,
  toByteString,
  PubKey,
  UTXO,
  fill,
} from 'scrypt-ts';
import {
  emptyTokenAmountArray,
  emptyTokenArray,
  getBackTraceInfo,
  ProtocolState,
  CAT20,
  GuardProto,
  CAT20Proto,
  TransferGuard,
  CAT20State,
  getTxHeaderCheck,
  getTxCtxMulti,
  TokenUnlockArgs,
  PreTxStatesInfo,
  GuardInfo,
  ChangeInfo,
  MAX_TOKEN_OUTPUT,
  MAX_INPUT,
} from '@cat-protocol/cat-smartcontracts';
import { ConfigService, WalletService } from 'src/providers';

async function unlockToken(
  wallet: WalletService,
  tokenContract: TokenContract,
  tokenInputIndex: number,
  prevTokenTx: btc.Transaction,
  preTokenInputIndex: number,
  prevPrevTokenTx: btc.Transaction,
  guardInfo: GuardInfo,
  revealTx: btc.Transaction,
  minterP2TR: string,
  txCtx: any,
  verify: boolean,
) {
  const { cblock: cblockToken, contract: token } =
    getTokenContractP2TR(minterP2TR);

  const { shPreimage, prevoutsCtx, spentScripts, sighash } = txCtx;

  const sig = btc.crypto.Schnorr.sign(
    wallet.getTokenPrivateKey(),
    sighash.hash,
  );
  const pubkeyX = wallet.getXOnlyPublicKey();
  const pubKeyPrefix = wallet.getPubKeyPrefix();
  const tokenUnlockArgs: TokenUnlockArgs = {
    isUserSpend: true,
    userPubKeyPrefix: pubKeyPrefix,
    userPubKey: PubKey(pubkeyX),
    userSig: sig.toString('hex'),
    contractInputIndex: 0n,
  };

  const backtraceInfo = getBackTraceInfo(
    prevTokenTx,
    prevPrevTokenTx,
    preTokenInputIndex,
  );

  const {
    state: { protocolState, data: preState },
  } = tokenContract;

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
    } as MethodCallOptions<CAT20>,
  );
  const witnesses = [
    ...callToBufferList(tokenCall),
    // taproot script + cblock
    token.lockingScript.toBuffer(),
    Buffer.from(cblockToken, 'hex'),
  ];
  revealTx.inputs[tokenInputIndex].witnesses = witnesses;

  if (verify) {
    const res = verifyContract(
      tokenContract.utxo,
      revealTx,
      tokenInputIndex,
      witnesses,
    );
    if (typeof res === 'string') {
      console.error('unlocking token contract failed!', res);
      return false;
    }
    return true;
  }

  return true;
}

async function unlockGuard(
  guardContract: GuardContract,
  guardInfo: GuardInfo,
  guardInputIndex: number,
  newState: ProtocolState,
  revealTx: btc.Transaction,
  receiverTokenState: CAT20State,
  changeTokenState: null | CAT20State,
  changeInfo: ChangeInfo,
  txCtx: any,
  verify: boolean,
) {
  // amount check run verify

  const { shPreimage, prevoutsCtx, spentScripts } = txCtx;
  const outputArray = emptyTokenArray();
  const tokenAmountArray = emptyTokenAmountArray();
  const tokenOutputIndexArray = fill(false, MAX_TOKEN_OUTPUT);
  outputArray[0] = receiverTokenState.ownerAddr;
  tokenAmountArray[0] = receiverTokenState.amount;
  tokenOutputIndexArray[0] = true;

  if (changeTokenState) {
    outputArray[1] = changeTokenState.ownerAddr;
    tokenAmountArray[1] = changeTokenState.amount;
    tokenOutputIndexArray[1] = true;
  }

  const satoshiChangeOutputIndex = changeTokenState === null ? 1 : 2;

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
    } as MethodCallOptions<TransferGuard>,
  );
  const witnesses = [
    ...callToBufferList(transferGuardCall),
    // taproot script + cblock
    transferGuard.lockingScript.toBuffer(),
    Buffer.from(transferCblock, 'hex'),
  ];
  revealTx.inputs[guardInputIndex].witnesses = witnesses;

  if (verify) {
    const res = verifyContract(
      guardContract.utxo,
      revealTx,
      guardInputIndex,
      witnesses,
    );
    if (typeof res === 'string') {
      console.error('unlocking guard contract failed!', res);
      return false;
    }
    return true;
  }
  return true;
}

export function createGuardContract(
  wallet: WalletService,
  feeutxo: UTXO,
  feeRate: number,
  tokens: TokenContract[],
  tokenP2TR: string,
  changeAddress: btc.Address,
) {
  const { p2tr: guardP2TR, tapScript: guardTapScript } = getGuardsP2TR();

  const protocolState = ProtocolState.getEmptyState();
  const realState = GuardProto.createEmptyState();
  realState.tokenScript = tokenP2TR;

  for (let i = 0; i < tokens.length; i++) {
    realState.inputTokenAmountArray[i] = tokens[i].state.data.amount;
  }

  protocolState.updateDataList(0, GuardProto.toByteString(realState));

  const commitTx = new btc.Transaction()
    .from(feeutxo)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(protocolState),
      }),
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.GUARD_POSTAGE,
        script: guardP2TR,
      }),
    )
    .feePerByte(feeRate)
    .change(changeAddress);

  if (commitTx.getChangeOutput() === null) {
    console.error('Insufficient satoshis balance!');
    return null;
  }
  commitTx.outputs[2].satoshis -= 1;
  wallet.signTx(commitTx);

  const contact: GuardContract = {
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

export async function sendToken(
  config: ConfigService,
  wallet: WalletService,
  feeUtxo: UTXO,
  feeRate: number,
  metadata: TokenMetadata,
  tokens: TokenContract[],
  changeAddress: btc.Address,
  receiver: btc.Address,
  amount: bigint,
  cachedTxs: Map<string, btc.Transaction>,
): Promise<{
  commitTx: btc.Transaction;
  revealTx: btc.Transaction;
  contracts: TokenContract[];
} | null> {
  const minterP2TR = toP2tr(metadata.minterAddr);

  const { p2tr: tokenP2TR, tapScript: tokenTapScript } =
    getTokenContractP2TR(minterP2TR);

  const commitResult = createGuardContract(
    wallet,
    feeUtxo,
    feeRate,
    tokens,
    tokenP2TR,
    changeAddress,
  );

  if (commitResult === null) {
    return null;
  }

  const { commitTx, contact: guardContract, guardTapScript } = commitResult;

  const newState = ProtocolState.getEmptyState();

  const receiverTokenState = CAT20Proto.create(
    amount,
    toTokenAddress(receiver),
  );

  newState.updateDataList(0, CAT20Proto.toByteString(receiverTokenState));

  const tokenInputAmount = tokens.reduce(
    (acc, t) => acc + t.state.data.amount,
    0n,
  );

  const changeTokenInputAmount = tokenInputAmount - amount;

  let changeTokenState: null | CAT20State = null;

  if (changeTokenInputAmount > 0n) {
    const tokenChangeAddress = wallet.getTokenAddress();
    changeTokenState = CAT20Proto.create(
      changeTokenInputAmount,
      tokenChangeAddress,
    );
    newState.updateDataList(1, CAT20Proto.toByteString(changeTokenState));
  }

  const newFeeUtxo = {
    txId: commitTx.id,
    outputIndex: 2,
    script: commitTx.outputs[2].script.toHex(),
    satoshis: commitTx.outputs[2].satoshis,
  };

  const inputUtxos = [
    ...tokens.map((t) => t.utxo),
    guardContract.utxo,
    newFeeUtxo,
  ];

  if (inputUtxos.length > MAX_INPUT) {
    throw new Error('to much input');
  }

  const revealTx = new btc.Transaction()
    .from(inputUtxos)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(newState),
      }),
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.TOKEN_POSTAGE,
        script: tokenP2TR,
      }),
    )
    .feePerByte(feeRate);

  if (changeTokenState) {
    revealTx.addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.TOKEN_POSTAGE,
        script: tokenP2TR,
      }),
    );
  }

  const satoshiChangeScript = btc.Script.fromAddress(changeAddress);
  revealTx.addOutput(
    new btc.Transaction.Output({
      satoshis: 0,
      script: satoshiChangeScript,
    }),
  );

  const tokenTxs = await Promise.all(
    tokens.map(async ({ utxo: tokenUtxo }) => {
      let prevTx: btc.Transaction | null = null;
      if (cachedTxs.has(tokenUtxo.txId)) {
        prevTx = cachedTxs.get(tokenUtxo.txId);
      } else {
        const prevTxHex = await getRawTransaction(
          config,
          wallet,
          tokenUtxo.txId,
        );
        if (prevTxHex instanceof Error) {
          logerror(`get raw transaction ${tokenUtxo.txId} failed!`, prevTxHex);
          return null;
        }
        prevTx = new btc.Transaction(prevTxHex);

        cachedTxs.set(tokenUtxo.txId, prevTx);
      }

      let prevTokenInputIndex = 0;

      const input = prevTx.inputs.find((input, inputIndex) => {
        const witnesses = input.getWitnesses();

        if (Array.isArray(witnesses) && witnesses.length > 2) {
          const lockingScriptBuffer = witnesses[witnesses.length - 2];
          const { p2tr } = script2P2TR(lockingScriptBuffer);

          const address = p2tr2Address(p2tr, config.getNetwork());
          if (
            address === metadata.tokenAddr ||
            address === metadata.minterAddr
          ) {
            prevTokenInputIndex = inputIndex;
            return true;
          }
        }
      });

      if (!input) {
        console.error(`There is no valid preTx of the ftUtxo!`);
        return null;
      }

      let prevPrevTx: btc.Transaction | null = null;

      const prevPrevTxId =
        prevTx.inputs[prevTokenInputIndex].prevTxId.toString('hex');

      if (cachedTxs.has(prevPrevTxId)) {
        prevPrevTx = cachedTxs.get(prevPrevTxId);
      } else {
        const prevPrevTxHex = await getRawTransaction(
          config,
          wallet,
          prevPrevTxId,
        );
        if (prevPrevTxHex instanceof Error) {
          logerror(
            `get raw transaction ${prevPrevTxId} failed!`,
            prevPrevTxHex,
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
    }),
  );

  const success = tokenTxs.every((t) => t !== null);

  if (!success) {
    return null;
  }

  const guardCommitTxHeader = getTxHeaderCheck(
    commitTx,
    guardContract.utxo.outputIndex,
  );

  const guardInputIndex = tokens.length;
  const guardInfo: GuardInfo = {
    outputIndex: toTxOutpoint(
      guardContract.utxo.txId,
      guardContract.utxo.outputIndex,
    ).outputIndex,
    inputIndexVal: BigInt(guardInputIndex),
    tx: guardCommitTxHeader.tx,
    guardState: guardContract.state.data,
  };

  const vsize = await calcVsize(
    wallet,
    tokens,
    guardContract,
    revealTx,
    guardInfo,
    tokenTxs,
    tokenTapScript,
    guardTapScript,
    newState,
    receiverTokenState,
    changeTokenState,
    satoshiChangeScript,
    minterP2TR,
  );

  const satoshiChangeAmount =
    revealTx.inputAmount -
    vsize * feeRate -
    Postage.TOKEN_POSTAGE -
    (changeTokenState === null ? 0 : Postage.TOKEN_POSTAGE);

  if (satoshiChangeAmount <= CHANGE_MIN_POSTAGE) {
    console.error('Insufficient satoshis balance!');
    return null;
  }

  const satoshiChangeOutputIndex = changeTokenState === null ? 2 : 3;

  // update change amount
  revealTx.outputs[satoshiChangeOutputIndex].satoshis = satoshiChangeAmount;

  const txCtxs = getTxCtxMulti(
    revealTx,
    tokens.map((_, i) => i).concat([tokens.length]),
    [
      ...new Array(tokens.length).fill(Buffer.from(tokenTapScript, 'hex')),
      Buffer.from(guardTapScript, 'hex'),
    ],
  );

  const changeInfo: ChangeInfo = {
    script: toByteString(satoshiChangeScript.toHex()),
    satoshis: int2ByteString(BigInt(satoshiChangeAmount), 8n),
  };

  const verify = config.getVerify();

  for (let i = 0; i < tokens.length; i++) {
    // ignore changeInfo when transfer token
    const res = await unlockToken(
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
      verify,
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
    changeTokenState,
    changeInfo,
    txCtxs[guardInputIndex],
    verify,
  );

  if (!res) {
    return null;
  }

  wallet.signTx(revealTx);

  const receiverTokenContract: TokenContract = {
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

  const contracts: TokenContract[] = [];
  contracts.push(receiverTokenContract);

  if (changeTokenState !== null) {
    const changeTokenContract: TokenContract = {
      utxo: {
        txId: revealTx.id,
        outputIndex: 2,
        script: revealTx.outputs[2].script.toHex(),
        satoshis: revealTx.outputs[2].satoshis,
      },
      state: {
        protocolState: newState,
        data: changeTokenState,
      },
    };
    contracts.push(changeTokenContract);
  }

  return {
    commitTx,
    revealTx,
    contracts,
  };
}

const calcVsize = async (
  wallet: WalletService,
  tokens: TokenContract[],
  guardContract: GuardContract,
  revealTx: btc.Transaction,
  guardInfo: GuardInfo,
  tokenTxs: Array<{
    prevTx: btc.Transaction;
    prevPrevTx: btc.Transaction;
    prevTokenInputIndex: number;
  }>,
  tokenTapScript: string,
  guardTapScript: string,
  newState: ProtocolState,
  receiverTokenState: CAT20State,
  changeTokenState: CAT20State,
  satoshisChangeScript: btc.Script,
  minterP2TR: string,
) => {
  const txCtxs = getTxCtxMulti(
    revealTx,
    tokens.map((_, i) => i).concat([tokens.length]),
    [
      ...new Array(tokens.length).fill(Buffer.from(tokenTapScript, 'hex')),
      Buffer.from(guardTapScript, 'hex'),
    ],
  );

  const guardInputIndex = tokens.length;

  const changeInfo: ChangeInfo = {
    script: satoshisChangeScript.toHex(),
    satoshis: int2ByteString(0n, 8n),
  };
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
      false,
    );
  }

  await unlockGuard(
    guardContract,
    guardInfo,
    guardInputIndex,
    newState,
    revealTx,
    receiverTokenState,
    changeTokenState,
    changeInfo,
    txCtxs[guardInputIndex],
    false,
  );

  wallet.signTx(revealTx);
  const vsize = revealTx.vsize;
  resetTx(revealTx);
  return vsize;
};

export function calcTotalAmount(tokens: TokenContract[]) {
  return tokens.reduce((acc, t) => acc + t.state.data.amount, 0n);
}
