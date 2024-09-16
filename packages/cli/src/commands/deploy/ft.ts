/* eslint-disable prettier/prettier */
import { UTXO, toByteString } from 'scrypt-ts';
import {
  broadcast,
  getTokenContractP2TR,
  script2P2TR,
  toStateScript,
  getOpenMinterContractP2TR,
  p2tr2Address,
  MinterType,
  outpoint2ByteString,
  TokenInfo,
  OpenMinterTokenInfo,
  Postage,
  btc,
  logerror,
} from 'src/common';

import {
  ProtocolState,
  getSHPreimage,
  getCatCommitScript,
  OpenMinterV2State,
  OpenMinterV2Proto,
} from '@cat-protocol/cat-smartcontracts';
import { ConfigService, WalletService } from 'src/providers';
import { scaleConfig } from 'src/token';

function getMinter(
  wallet: WalletService,
  genesisId: string,
  tokenInfo: TokenInfo,
) {
  const scaledTokenInfo = scaleConfig(tokenInfo as OpenMinterTokenInfo);
  const premineAddress =
    scaledTokenInfo.premine > 0n ? wallet.getTokenAddress() : toByteString('');
  return getOpenMinterContractP2TR(
    genesisId,
    scaledTokenInfo.max,
    scaledTokenInfo.premine,
    scaledTokenInfo.limit,
    premineAddress,
    tokenInfo.minterMd5,
  );
}

export function getMinterInitialTxState(
  tokenP2TR: string,
  tokenInfo: TokenInfo,
): {
  protocolState: ProtocolState;
  data: OpenMinterV2State;
} {
  const protocolState = ProtocolState.getEmptyState();
  const scaledTokenInfo = scaleConfig(tokenInfo as OpenMinterTokenInfo);
  const maxCount = scaledTokenInfo.max / scaledTokenInfo.limit;
  const premineCount = scaledTokenInfo.premine / scaledTokenInfo.limit;
  const remainingSupply = maxCount - premineCount;
  const minterState = OpenMinterV2Proto.create(
    tokenP2TR,
    false,
    remainingSupply,
  );
  const outputState = OpenMinterV2Proto.toByteString(minterState);
  protocolState.updateDataList(0, outputState);
  return {
    protocolState,
    data: minterState,
  };
}

const buildRevealTx = (
  wallet: WalletService,
  genesisId: string,
  lockingScript: btc.Script,
  minterType: MinterType,
  info: TokenInfo,
  commitTx: btc.Transaction,
  feeRate: number,
): btc.Transaction => {
  const { p2tr: minterP2TR } = getMinter(
    wallet,
    outpoint2ByteString(genesisId),
    info,
  );

  const { tapScript, cblock } = script2P2TR(lockingScript);
  const { p2tr: tokenP2TR } = getTokenContractP2TR(minterP2TR);

  const { protocolState: txState } = getMinterInitialTxState(tokenP2TR, info);

  const revealTx = new btc.Transaction()
    .from([
      {
        txId: commitTx.id,
        outputIndex: 0,
        script: commitTx.outputs[0].script,
        satoshis: commitTx.outputs[0].satoshis,
      },
      {
        txId: commitTx.id,
        outputIndex: 1,
        script: commitTx.outputs[1].script,
        satoshis: commitTx.outputs[1].satoshis,
      },
    ])
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(txState),
      }),
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.MINTER_POSTAGE,
        script: minterP2TR,
      }),
    )
    .feePerByte(feeRate);

  const witnesses: Buffer[] = [];

  const { sighash } = getSHPreimage(revealTx, 0, Buffer.from(tapScript, 'hex'));

  const sig = btc.crypto.Schnorr.sign(
    wallet.getTaprootPrivateKey(),
    sighash.hash,
  );

  for (let i = 0; i < txState.stateHashList.length; i++) {
    const txoStateHash = txState.stateHashList[i];
    witnesses.push(Buffer.from(txoStateHash, 'hex'));
  }
  witnesses.push(sig);
  witnesses.push(lockingScript);
  witnesses.push(Buffer.from(cblock, 'hex'));

  const interpreter = new btc.Script.Interpreter();
  const flags =
    btc.Script.Interpreter.SCRIPT_VERIFY_WITNESS |
    btc.Script.Interpreter.SCRIPT_VERIFY_TAPROOT;

  const res = interpreter.verify(
    new btc.Script(''),
    commitTx.outputs[0].script,
    revealTx,
    0,
    flags,
    witnesses,
    commitTx.outputs[0].satoshis,
  );

  if (!res) {
    console.error('reveal faild!', interpreter.errstr);
    return;
  }

  revealTx.inputs[0].witnesses = witnesses;

  wallet.signTx(revealTx);
  return revealTx;
};

export async function deploy(
  info: TokenInfo,
  feeRate: number,
  utxos: UTXO[],
  minterType: MinterType,
  wallet: WalletService,
  config: ConfigService,
): Promise<
  | {
      revealTx: btc.Transaction;
      genesisTx: btc.Transaction;
      tokenId: string;
      tokenAddr: string;
      minterAddr: string;
    }
  | undefined
> {
  const changeAddress: btc.Address = wallet.getAddress();

  const pubkeyX = wallet.getXOnlyPublicKey();
  const commitScript = getCatCommitScript(pubkeyX, info);

  const lockingScript = Buffer.from(commitScript, 'hex');
  const { p2tr: p2tr } = script2P2TR(lockingScript);

  const changeScript = btc.Script.fromAddress(changeAddress);

  const commitTx = new btc.Transaction()
    .from(utxos)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.METADATA_POSTAGE,
        script: p2tr,
      }),
    )
    .addOutput(
      /** utxo to pay revealTx fee */
      new btc.Transaction.Output({
        satoshis: 0,
        script: changeScript,
      }),
    )
    .feePerByte(feeRate)
    .change(changeAddress);

  if (commitTx.getChangeOutput() === null) {
    throw new Error('Insufficient satoshi balance!');
  }

  const dummyGenesisId = `${'0000000000000000000000000000000000000000000000000000000000000000'}_0`;

  const revealTxDummy = buildRevealTx(
    wallet,
    dummyGenesisId,
    lockingScript,
    minterType,
    info,
    commitTx,
    feeRate,
  );

  const revealTxFee = revealTxDummy.vsize * feeRate + Postage.MINTER_POSTAGE;

  commitTx.outputs[1].satoshis = revealTxFee;

  commitTx.change(changeAddress);
  if (commitTx.outputs[2] && commitTx.outputs[2].satoshi > 1) {
    commitTx.outputs[2].satoshis -= 1;
  }

  wallet.signTx(commitTx);

  const genesisId = `${commitTx.id}_0`;

  const revealTx = buildRevealTx(
    wallet,
    genesisId,
    lockingScript,
    minterType,
    info,
    commitTx,
    feeRate,
  );

  const { p2tr: minterP2TR } = getMinter(
    wallet,
    outpoint2ByteString(genesisId),
    info,
  );
  const { p2tr: tokenP2TR } = getTokenContractP2TR(minterP2TR);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const commitTxId = await broadcast(
    config,
    wallet,
    commitTx.uncheckedSerialize(),
  );

  if (commitTxId instanceof Error) {
    logerror(`commit failed!`, commitTxId);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const revealTxId = await broadcast(
    config,
    wallet,
    revealTx.uncheckedSerialize(),
  );

  if (revealTxId instanceof Error) {
    logerror(`reveal failed!`, revealTxId);
    return null;
  }

  return {
    tokenId: genesisId,
    tokenAddr: p2tr2Address(tokenP2TR, config.getNetwork()),
    minterAddr: p2tr2Address(minterP2TR, config.getNetwork()),
    genesisTx: commitTx,
    revealTx: revealTx,
  };
}
