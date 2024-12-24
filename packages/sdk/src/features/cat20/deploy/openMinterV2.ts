import { UTXO } from 'scrypt-ts';
import { Cat20TokenInfo, OpenMinterCat20Meta } from '../../../lib/metadata';
import { Signer } from '../../../lib/signer';
import { OpenMinterV2Covenant } from '../../../covenants/openMinterV2Covenant';
import { addrToP2trLockingScript, dummySig, getDummyUtxo, getUnfinalizedTxId } from '../../../lib/utils';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import { Postage } from '../../../lib/constants';
import { bitcoinjs } from '../../../lib/btc';
import { ChainProvider, markSpent, UtxoProvider } from '../../../lib/provider';
import { CatPsbt } from '../../../lib/catPsbt';
import { OpenMinterV2Proto } from '../../../contracts/token/openMinterV2Proto';



/**
 * Deploy a CAT20 token with metadata and automatically mint the pre-mined tokens, if applicable.
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner} 
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param metadata the metadata of the CAT20 token
 * @param feeRate the fee rate for constructing transactions
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @returns the genesis transaction, the token reveal transaction and the premine transaction
 */
export async function deploy(
  signer: Signer,
  utxoProvider: UtxoProvider,
  chainProvider: ChainProvider,
  metadata: OpenMinterCat20Meta,
  feeRate: number,
  changeAddress?: string,
): Promise<
  Cat20TokenInfo<OpenMinterCat20Meta>
  & {
    genesisTx: bitcoinjs.Psbt;
    revealTx: CatPsbt;
    premineTx?: CatPsbt;
  }> {

  if (metadata.minterMd5 !== OpenMinterV2Covenant.LOCKED_ASM_VERSION) {
    throw new Error('Invalid minterMd5 for OpenMinterV2Covenant')
  }

  const pubKey = await signer.getPublicKey()
  const address = await signer.getAddress()
  const feeAddress = await signer.getAddress()
  changeAddress = changeAddress || feeAddress
  let sigRequests = []

  const {
    commitTxVSize,
    revealTxVSize,
  } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

  const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE
  const commitTxFee = commitTxVSize * feeRate
  const total = commitTxOutputsAmount + commitTxFee
  const utxos = await utxoProvider.getUtxos(feeAddress, { total })

  const {
    tokenId,
    tokenAddr,
    minterAddr,
    commitPsbt,
    revealPsbt,
    newFeeUtxo,
  } = buildCommitAndRevealTxs(
    metadata,
    utxos,
    address,
    pubKey,
    changeAddress,
    feeRate,
    commitTxOutputsAmount,
  )

  sigRequests = [
    {
      psbtHex: commitPsbt.toHex(),
      options: {
        autoFinalized: false,
        toSignInputs: utxos.map((value, index) => {
          return {index: index, address: changeAddress}
        }),
      }
    },
    {
      psbtHex: revealPsbt.toHex(),
      options: revealPsbt.psbtOptions(),
    }
  ]

  // build the premine tx if applicable
  let preminePsbt: CatPsbt | undefined
  if (metadata.premine > 0n && metadata.preminerAddr) {
    preminePsbt = await buildPremineTx(
      newFeeUtxo,
      commitPsbt,
      revealPsbt,
      tokenId,
      tokenAddr,
      metadata,
      feeRate,
      feeAddress,
      changeAddress,
      address,
      pubKey,
    )

    sigRequests.push({
      psbtHex: preminePsbt.toHex(),
      options: preminePsbt.psbtOptions(),
    })
  }

  // sign the psbts
  const [
    signedCommitPsbt,
    signedRevealPsbt,
    signedPreminePsbt,
  ] = await signer.signPsbts(sigRequests)

  // combine and finalize the signed psbts
  const genesisTxPsbt = Psbt.fromHex(signedCommitPsbt).finalizeAllInputs()
  const revealTxPsbt = await revealPsbt.combine(Psbt.fromHex(signedRevealPsbt)).finalizeAllInputsAsync();
  let premineTxPsbt: CatPsbt | undefined
  if (preminePsbt && signedPreminePsbt) {
    premineTxPsbt = await preminePsbt.combine(Psbt.fromHex(signedPreminePsbt)).finalizeAllInputsAsync();
  }

  // broadcast the psbts
  const genesisTx = genesisTxPsbt.extractTransaction();
  const revealTx = revealTxPsbt.extractTransaction();
  await chainProvider.broadcast(genesisTx.toHex())
  markSpent(utxoProvider, genesisTx);
  await chainProvider.broadcast(revealTx.toHex())
  markSpent(utxoProvider, revealTx);

  const premineTx = preminePsbt ? premineTxPsbt.extractTransaction() : undefined;
  if (premineTx) {
    await chainProvider.broadcast(premineTx.toHex())
    markSpent(utxoProvider, premineTx);
  }

  return {
    tokenId,
    tokenAddr,
    minterAddr,
    genesisTxid: genesisTx.getId(),
    revealTxid: revealTx.getId(),
    metadata,
    genesisTx: genesisTxPsbt,
    revealTx: revealTxPsbt,
    premineTx: premineTxPsbt,
    timestamp: new Date().getTime(),
  }
}

function estimateDeployTxVSizes(
  metadata: OpenMinterCat20Meta,
  address: string,
  pubKey: string,
  changeAddress: string,
  feeRate: number,
): {
  commitTxVSize: number,
  revealTxVSize: number,
} {
  const {
    commitPsbt: dummyCommitPsbt,
    revealPsbt: dummyRevealPsbt,
  } = buildCommitAndRevealTxs(
    metadata,
    [
      getDummyUtxo(changeAddress),
    ],
    address,
    pubKey,
    changeAddress,
    feeRate,
    Postage.METADATA_POSTAGE,
  )

  dummySig(dummyCommitPsbt, changeAddress);
  
  return {
    commitTxVSize: dummyCommitPsbt.extractTransaction().virtualSize(),
    revealTxVSize: dummyRevealPsbt.estimateVSize(),
  }
}

function buildCommitAndRevealTxs(
  metadata: OpenMinterCat20Meta,
  utxos: UTXO[],
  address: string,
  pubKey: string,
  changeAddress: string,
  feeRate: number,
  commitTxOutputsAmount: number,
) {

  // build the commit tx
  const commitPsbt = OpenMinterV2Covenant.buildCommitTx(
    metadata,
    address,
    pubKey,
    utxos,
    commitTxOutputsAmount,
    changeAddress,
    feeRate,
  )

  const commitTxid = getUnfinalizedTxId(commitPsbt);

  // build the reveal tx
  const { tokenId, tokenAddr, minterAddr, revealPsbt } =
    OpenMinterV2Covenant.buildRevealTx(
      {
        txId: commitTxid,
        outputIndex: 0,
        script: Buffer.from(commitPsbt.txOutputs[0].script).toString('hex'),
        satoshis: Number(commitPsbt.txOutputs[0].value)
      },
      metadata,
      address,
      pubKey,
      [
        {
          txId: commitTxid,
          outputIndex: 1,
          script: Buffer.from(commitPsbt.txOutputs[1].script).toString('hex'),
          satoshis: Number(commitPsbt.txOutputs[1].value)
        }
      ],
    );

  return {
    tokenId,
    tokenAddr,
    minterAddr,
    commitPsbt,
    revealPsbt,
    newFeeUtxo: {
      txId: commitTxid,
      outputIndex: 2,
      script: Buffer.from(commitPsbt.txOutputs[2].script).toString('hex'),
      satoshis: Number(commitPsbt.txOutputs[2].value)
    }
  }
}

async function buildPremineTx(
  feeUtxo: UTXO,
  commitPsbt: Psbt,
  revealPsbt: CatPsbt,
  tokenId: string,
  tokenAddr: string,
  metadata: OpenMinterCat20Meta,
  feeRate: number,
  feeAddress: string,
  changeAddress: string,
  preminterAddress: string,
  preminterPubKey: string,
) {

  if (!metadata.preminerAddr) {
    throw new Error('preminer address is required for premine')
  }

  const tokenReceiver = metadata.preminerAddr
  const minterPreTxHex = Transaction.fromBuffer(commitPsbt.data.getTransaction()).toHex()
  const spentMinterTx = Transaction.fromBuffer(revealPsbt.data.getTransaction())
  const txId = spentMinterTx.getId()
  const spentMinterTxHex = spentMinterTx.toHex()

  const initialMinter = new OpenMinterV2Covenant(
    tokenId,
    metadata,
    OpenMinterV2Proto.create(
      addrToP2trLockingScript(tokenAddr),
      false,
      (metadata.max - metadata.premine) / metadata.limit,
    )
  )
    .bindToUtxo({
      txId,
      outputIndex: 1,
      satoshis: Postage.MINTER_POSTAGE,
    })

  const estimatedVSize =
    OpenMinterV2Covenant.buildMintTx(
      minterPreTxHex,
      spentMinterTxHex,
      revealPsbt.txState,
      initialMinter,
      tokenReceiver,
      [getDummyUtxo(feeAddress)],
      feeRate,
      changeAddress,
      undefined,
      preminterAddress,
      preminterPubKey,
    ).estimateVSize()

  return OpenMinterV2Covenant.buildMintTx(
    minterPreTxHex,
    spentMinterTxHex,
    revealPsbt.txState,
    initialMinter,
    tokenReceiver,
    [feeUtxo],
    feeRate,
    changeAddress,
    estimatedVSize,
    preminterAddress,
    preminterPubKey,
  )
}
