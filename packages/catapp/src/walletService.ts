import { btc } from './btc';
import * as btcSigner from '@scure/btc-signer';

import { hash160, UTXO } from 'scrypt-ts';
import { getTokenContractP2TR, toP2tr, toXOnly, toXOnlyFromTaproot } from './utils';
import { TokenMetadata } from './metadata';
import * as bitcoinjs from 'bitcoinjs-lib'
export const DUMMY_SIG = '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' 

export const DUMMY_PUBKEY = '000000000000000000000000000000000000000000000000000000000000000000';

function tx2PSBT(tx: btc.Transaction) {
  const psbt = btcSigner.Transaction.fromRaw(tx.toBuffer(), { allowUnknownOutputs: true });
  return bitcoinjs.Psbt.fromBuffer(psbt.toPSBT());
}

function getTapKeySigFromPSBT(psbt: bitcoinjs.Psbt, inputIndex: number) {
  const tapKeySig = psbt.data.inputs[inputIndex].tapKeySig
  if(tapKeySig) {
    return Buffer.from(tapKeySig);
  }
  throw new Error(`getTapKeySigFromPSBT failed for input: ${inputIndex}`)
}

function getPartialSigFromPSBT(psbt: bitcoinjs.Psbt, inputIndex: number) {
  const partialSig = psbt.data.inputs[inputIndex].partialSig
  
  if(Array.isArray(partialSig)&& partialSig.length >= 1) {
    return Buffer.from(partialSig[0].signature);
  }

  throw new Error(`getPartialSigFromPSBT failed for input: ${inputIndex}`)
}


function getTapScriptSigFromPSBT(psbt: bitcoinjs.Psbt, inputIndex: number) {
  const tapScriptSig = psbt.data.inputs[inputIndex].tapScriptSig
  if(Array.isArray(tapScriptSig)&& tapScriptSig.length >= 1) {
    return Buffer.from(tapScriptSig[0].signature);
  }
  throw new Error(`getTapScriptSigFromPSBT failed for input: ${inputIndex}`)
}

export class WalletService {

  async getAddress(): Promise<btc.Address> {

    const accounts = await window.unisat.getAccounts();

    return btc.Address.fromString(accounts[0]);
  }

  async getXOnlyPublicKey(): Promise<string> {
    const address = await this.getAddress();
    if(address.type === 'taproot') {
      return btc.Script.fromAddress(address).getPublicKeyHash().toString('hex');
    } else if(address.type === 'witnesspubkeyhash') {
      const pubkey = await this.getPublicKey();
      return toXOnly(pubkey.toBuffer()).toString('hex');
    } else {
      throw new Error(`invalid address type: ${ address.type}`);
    }
  }

  async getPublicKeyHash(): Promise<string> {
    const publicKey = await this.getPublicKey();
    return hash160(publicKey.toBuffer().toString('hex'));
  }

  async getUTXOs(): Promise<UTXO[]> {
    return window.unisat
      .getBitcoinUtxos()
      .then((utxos) => {
        return utxos
          .map((utxo: any) => ({
            txId: utxo.txid,
            outputIndex: utxo.vout,
            script: utxo.scriptPk,
            satoshis: utxo.satoshis,
          }))
      })
      .catch((e) => {
        console.error("getUtxos failed:", e);
        return [];
      });
  }

  async getPublicKey(): Promise<btc.PublicKey> {
    const publicKey = await window.unisat.getPublicKey();
    return btc.PublicKey.fromString(publicKey);
  }

  async getPubKeyPrefix(): Promise<string> {
    const address = await this.getAddress();
    if(address.type === 'taproot') {
      return '';
    } else if(address.type === 'witnesspubkeyhash') {
      const pubkey = await this.getPublicKey();
      return pubkey.toString().slice(0, 2);
    } else {
      throw new Error(`invalid address type: ${ address.type}`);
    }
  }

  async getTokenAddress(): Promise<string> {

    const address = await this.getAddress();

    if (address.type === 'taproot') {
      const xpubkey = await this.getXOnlyPublicKey();
      return hash160(xpubkey);
    } else if (address.type === 'witnesspubkeyhash') {
      const pubkey = await this.getPublicKey();
      return hash160(pubkey.toString());
    } else {
      throw new Error(`Unsupported address type: ${address.type}`);
    }
  }



  async signFeeInput(tx: btc.Transaction) {
    const psbt = tx2PSBT(tx);


    const toSignInputs: Array<{
			index: number,
			address?: string,
			publicKey?: string,
			sighashTypes?: number[],
			disableTweakSigner?: boolean,
		}> = [];
    const address = await this.getAddress();
    const pubkey = await this.getPublicKey();
    const publicKeyHash = await this.getPublicKeyHash();
    for (let i = 0; i < psbt.inputCount; i++) {

      if(tx.inputs[i].output.script.isTaproot()) {
        const xpubkey = await this.getXOnlyPublicKey();

        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        if(pkh === xpubkey) {
          const witnessUtxo = {
            value: BigInt(tx.inputs[i].output.satoshis) || 0n,
            script: tx.inputs[i].output.script.toBuffer() || btc.Script.empty(),
          }
          psbt.updateInput(i, {
            witnessUtxo,
            tapInternalKey: Buffer.from(xpubkey, 'hex'),
            sighashType: 1,
          });
          toSignInputs.push({
            index: i,
            address: address.toString(),
            sighashTypes: [1],
          })
        }
      } else if(tx.inputs[i].output.script.isWitnessPublicKeyHashOut()) {

        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        if(pkh === publicKeyHash) {
          const witnessUtxo = {
            value: BigInt(tx.inputs[i].output.satoshis) || 0n,
            script: tx.inputs[i].output.script.toBuffer() || btc.Script.empty(),
          }
          psbt.updateInput(i, {
            witnessUtxo,
          });
          toSignInputs.push({
            index: i,
            address: address.toString(),
          })
        }

      }
    }

    const signedPsbtHex = await window.unisat.signPsbt(psbt.toHex(), {
      autoFinalized: false,
      toSignInputs
    })

    const signedPsbt = bitcoinjs.Psbt.fromHex(signedPsbtHex);

    for (let i = 0; i < psbt.inputCount; i++) {

      if(tx.inputs[i].output.script.isTaproot()) {

        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        const xpubkey = await this.getXOnlyPublicKey();

        if(pkh === xpubkey) {
          const keySig = getTapKeySigFromPSBT(signedPsbt, i);
          if(keySig) {
            tx.inputs[i].setWitnesses([
              keySig,
            ]);
          }
        }
      } else if(tx.inputs[i].output.script.isWitnessPublicKeyHashOut()){
        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        if(pkh === publicKeyHash) {
          const keySig = getPartialSigFromPSBT(signedPsbt, i);
          if(keySig) {
            tx.inputs[i].setWitnesses([
              keySig,
              pubkey.toBuffer()
            ]);
          }
        }
      }
    }
  }


  async dummySignFeeInput(tx: btc.Transaction) {
    const xpubkey = await this.getXOnlyPublicKey();
    const publicKeyHash = await this.getPublicKeyHash();
    for (let i = 0; i < tx.inputs.length; i++) {
      const output = tx.inputs[i].output;

      if(output.script.isTaproot()) {

        const pkh = output.script.getPublicKeyHash().toString('hex');

        if(pkh === xpubkey) {
          tx.inputs[i].setWitnesses([Buffer.from(DUMMY_SIG, 'hex')])
        }
      } else if(output.script.isWitnessPublicKeyHashOut()) {

        const pkh = output.script.getPublicKeyHash().toString('hex');
        if(pkh === publicKeyHash) {
          tx.inputs[i].setWitnesses([Buffer.from(DUMMY_SIG, 'hex'), Buffer.from(DUMMY_PUBKEY, 'hex')])
        }
      }
    }
  }



  async signToken(tx: btc.Transaction, metadata: TokenMetadata): Promise<string[]> {
    const psbt = tx2PSBT(tx);

    const xpubkeyToken = toXOnlyFromTaproot(metadata.tokenAddr);
    const xpubkeyFee = await this.getXOnlyPublicKey();
    const { cblock: cblockToken, contract } = getTokenContractP2TR(toP2tr(metadata.minterAddr));

    const address = await this.getAddress();
    const publicKeyHash = await this.getPublicKeyHash();
    const pubkey = await this.getPublicKey();
    const toSignInputs: Array<{
			index: number,
			address?: string,
			publicKey?: string,
			sighashTypes?: number[],
			disableTweakSigner?: boolean,
		}> = [];

    const disableTweakSigner = address.type === 'taproot' ? false : true;
    for (let i = 0; i < psbt.inputCount; i++) {

      if(tx.inputs[i].output.script.isTaproot()) {

        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        const witnessUtxo = {
          value: BigInt(tx.inputs[i].output.satoshis) || 0n,
          script: tx.inputs[i].output.script.toBuffer() || btc.Script.empty(),
        }
        if(pkh === xpubkeyToken) {
          psbt.updateInput(i, {
            witnessUtxo: {
              value: BigInt(tx.inputs[i].output.satoshis) || 0n,
              script: tx.inputs[i].output.script.toBuffer() || btc.Script.empty(),
            },
            tapLeafScript: [{
                leafVersion: 192,
                script: contract.lockingScript.toBuffer(),
                controlBlock: Buffer.from(cblockToken, 'hex'),
            }],
            sighashType: 1,
        });
          toSignInputs.push({
            index: i,
            address: address.toString(),
            sighashTypes: [1],
            disableTweakSigner,
          })
        } else if(pkh === xpubkeyFee) {
          psbt.updateInput(i, {
            witnessUtxo,
            tapInternalKey: Buffer.from(xpubkeyFee, 'hex'),
            sighashType: 1,
          });
          toSignInputs.push({
            index: i,
            address: address.toString(),
            sighashTypes: [1]
          })
        } else {
          psbt.updateInput(i, {
            witnessUtxo,
            sighashType: 1,
          });
        }
      } else if(tx.inputs[i].output.script.isWitnessPublicKeyHashOut()) {
        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        if(pkh === publicKeyHash) {
          const witnessUtxo = {
            value: BigInt(tx.inputs[i].output.satoshis) || 0n,
            script: tx.inputs[i].output.script.toBuffer() || btc.Script.empty(),
          }
          psbt.updateInput(i, {
            witnessUtxo,
          });
          toSignInputs.push({
            index: i,
            address: address.toString(),
          })
        }
      }
    }

    const psbtHex = psbt.toHex();

    const signedPsbtHex = await window.unisat.signPsbt(psbtHex, {
      autoFinalized: false,
      toSignInputs: toSignInputs
    })


    const signedPsbt = bitcoinjs.Psbt.fromHex(signedPsbtHex);

    const sigs: Array<string> = [];

    for (let i = 0; i < signedPsbt.inputCount; i++) {

      if(tx.inputs[i].output.script.isTaproot()) {
        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');

        if(pkh === xpubkeyToken) {
          
          const tapScriptSig = getTapScriptSigFromPSBT(signedPsbt, i);
          if(tapScriptSig) {
            sigs.push(tapScriptSig.toString('hex'));
          } else {
            console.warn('invalid tapScriptSig');
          }
        } else if(pkh === xpubkeyFee){
          const keySig = getTapKeySigFromPSBT(signedPsbt, i);
          if(keySig) {
            tx.inputs[i].setWitnesses([
              keySig,
            ]);
          } else {
            console.warn('invalid keySig');
          }
        }
      }  else if(tx.inputs[i].output.script.isWitnessPublicKeyHashOut()) {
        const pkh = tx.inputs[i].output.script.getPublicKeyHash().toString('hex');
        if(pkh === publicKeyHash) {
          const keySig = getPartialSigFromPSBT(signedPsbt, i);
          if(keySig) {
            tx.inputs[i].setWitnesses([
              keySig,
              pubkey.toBuffer()
            ]);
          }
        }
      }
    }

    return sigs;
  }
}
