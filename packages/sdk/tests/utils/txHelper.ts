import { randomBytes } from 'crypto'
import { DummyProvider, TestWallet, sha256, toByteString } from 'scrypt-ts'
import * as dotenv from 'dotenv'
import { bitcoinjs, btc } from '../../src/lib/btc'
import { toBtcTransaction } from '../../src/lib/utils'

// Load the .env file
dotenv.config()

export const sleep = async (seconds: number) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({})
    }, seconds * 1000)
  })
}

export type UTXO = {
  address?: string
  txId: string
  outputIndex: number
  satoshis: number
  script: string
}

export function getDummySigner(): TestWallet {
  if (global.dummySigner === undefined) {
    global.dummySigner = TestWallet.random(new DummyProvider())
  }
  return global.dummySigner
}

export const inputSatoshis = 10000

export const dummyUTXO = {
  txId: randomBytes(32).toString('hex'),
  outputIndex: 0,
  script: '', // placeholder
  satoshis: inputSatoshis,
}

export function getDummyUTXO(
  satoshis: number = inputSatoshis,
  unique = false
): UTXO {
  if (unique) {
    return Object.assign({}, dummyUTXO, {
      satoshis,
      txId: randomBytes(32).toString('hex'),
    })
  }
  return Object.assign({}, dummyUTXO, { satoshis })
}

export function getBtcDummyUtxo(address: btc.Address): UTXO {
  return {
    address: address.toString(),
    txId: sha256(toByteString(Math.random().toString(), true)),
    outputIndex: 4,
    script: btc.Script.fromAddress(address).toHex(),
    satoshis: 999999999999,
  }
}

export function getDummyGenesisTx(seckey, address: btc.Address) {
  const utxos = [getBtcDummyUtxo(address)]
  const txFee = new btc.Transaction()
    .from(utxos)
    .to(address, 10000)
    .change(address)
    .feePerByte(2)
    .sign(seckey)
  const genesisTx = new btc.Transaction(txFee.toBuffer())
  const genesisUtxo = {
    address: address.toString(),
    txId: genesisTx.id,
    outputIndex: 0,
    script: new btc.Script(address),
    satoshis: genesisTx.outputs[0].satoshis,
  }
  return { genesisTx, genesisUtxo }
}

export const interpreter = new btc.Script.Interpreter()
export const flags =
  btc.Script.Interpreter.SCRIPT_VERIFY_WITNESS |
  btc.Script.Interpreter.SCRIPT_VERIFY_TAPROOT

export function verifyInputSpent(
  psbt: bitcoinjs.Psbt,
  inputIndex: number
): string | true {
  const interpreter = new btc.Script.Interpreter()
  const flags =
    btc.Script.Interpreter.SCRIPT_VERIFY_WITNESS |
    btc.Script.Interpreter.SCRIPT_VERIFY_TAPROOT

  const _tx = toBtcTransaction(psbt)

  const witnesses = _tx.inputs[inputIndex].witnesses

  const res = interpreter.verify(
    new btc.Script(''),
    _tx.inputs[inputIndex].output.script,
    _tx,
    inputIndex,
    flags,
    witnesses,
    _tx.inputs[inputIndex].output.satoshis
  )
  if (!res) {
    console.log('verify input failed:', res)
    console.log('the witness is:', witnesses)
    return interpreter.errstr
  }
  return true
}
