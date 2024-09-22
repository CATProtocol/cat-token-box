import { btc } from './btc';
import * as btcSigner from '@scure/btc-signer';

import { hash160, UTXO } from 'scrypt-ts';
import { getTokenContractP2TR, toP2tr, toXOnlyFromTaproot } from './utils';
import { TokenMetadata } from './metadata';
import * as bitcoinjs from 'bitcoinjs-lib'
export const DUMMY_SIG = '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' 


function tx2PSBT(tx: btc.Transaction) {
  const psbt = btcSigner.Transaction.fromRaw(tx.toBuffer(), { allowUnknownOutputs: true });
  return bitcoinjs.Psbt.fromBuffer(psbt.toPSBT());
}

function getKeySigFromPSBT(psbt: bitcoinjs.Psbt, inputIndex: number) {
  const tapKeySig = psbt.data.inputs[inputIndex].tapKeySig
  if(tapKeySig) {
    return Buffer.from(tapKeySig);
  }
}

function getScriptSigFromPSBT(psbt: bitcoinjs.Psbt, inputIndex: number) {
  const tapScriptSig = psbt.data.inputs[inputIndex].tapScriptSig
  if(Array.isArray(tapScriptSig)&& tapScriptSig.length >= 1) {
    return Buffer.from(tapScriptSig[0].signature);
  }
}

export class WalletService {

  async getAddress(): Promise<btc.Address> {

    const accounts = await window.unisat.getAccounts();

    return btc.Address.fromString(accounts[0]);
  }

  async getXOnlyPublicKey(): Promise<string> {
    const address = await this.getAddress();
    return btc.Script.fromAddress(address).getPublicKeyHash().toString('hex');
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

  getPubKeyPrefix(): string {
    return '';
  }

  async getTokenAddress(): Promise<string> {
    const xpubkey = await this.getXOnlyPublicKey();
    return hash160(xpubkey);
  }



  async signFeeInput(tx: btc.Transaction) {
    const psbt = tx2PSBT(tx);

    const xpubkey = await this.getXOnlyPublicKey();

    const toSignInputs: Array<{
			index: number,
			address?: string,
			publicKey?: string,
			sighashTypes?: number[],
			disableTweakSigner?: boolean,
		}> = [];
    const address = await this.getAddress();
    for (let i = 0; i < psbt.inputCount; i++) {

      if(tx.inputs[i].output.script.isTaproot()) {

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
        if(pkh === xpubkey) {
          const keySig = getKeySigFromPSBT(signedPsbt, i);
          if(keySig) {
            tx.inputs[i].setWitnesses([
              keySig,
            ]);
          }
        }
      }
    }
  }


  dummySignFeeInput(tx: btc.Transaction, xpubkey: string) {
    for (let i = 0; i < tx.inputs.length; i++) {
      const output = tx.inputs[i].output;

      if(output.script.isTaproot()) {

        const pkh = output.script.getPublicKeyHash().toString('hex');

        if(pkh === xpubkey) {
          tx.inputs[i].setWitnesses([Buffer.from(DUMMY_SIG, 'hex')])
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
    const toSignInputs: Array<{
			index: number,
			address?: string,
			publicKey?: string,
			sighashTypes?: number[],
			disableTweakSigner?: boolean,
		}> = [];
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
            sighashTypes: [1]
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
          
          const tapScriptSig = getScriptSigFromPSBT(signedPsbt, i);
          if(tapScriptSig) {
            sigs.push(tapScriptSig.toString('hex'));
          } else {
            console.warn('invalid tapScriptSig');
          }
        } else if(pkh === xpubkeyFee){
          const keySig = getKeySigFromPSBT(signedPsbt, i);
          if(keySig) {
            tx.inputs[i].setWitnesses([
              keySig,
            ]);
          } else {
            console.warn('invalid keySig');
          }
        }
      }
    }

    return sigs;
  }
}
