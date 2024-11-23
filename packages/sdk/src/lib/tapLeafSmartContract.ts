import { hash160, int2ByteString, SmartContract } from 'scrypt-ts'
import { Tap } from '@cmdcode/tapscript' // Requires node >= 19
import { bitcoinjs, btc } from './btc'
import { TAPROOT_ONLY_SCRIPT_SPENT_KEY } from './constants'
import { unlockingScriptToWitness } from './txTools'
import { ABICoder, Arguments } from 'scryptlib/dist/abi'

export type TapScript = string

export class TapLeafSmartContract {
  readonly contract: SmartContract
  readonly contractScriptHash: string
  readonly tapScript: TapScript

  tpubkey: string
  cblock: string

  constructor(contract: SmartContract) {
      const contractScript = contract.lockingScript
      const tapScript = Tap.encodeScript(contractScript.toBuffer())
      const [tpubkey, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
          target: tapScript,
      })
      this.contract = contract
      this.contractScriptHash = hash160(
        this.contract.lockingScript.toBuffer().toString('hex')
      )
      this.tapScript = tapScript
      this.tpubkey = tpubkey
      this.cblock = cblock
  }

  get contractScript(): btc.Script {
    return this.contract.lockingScript
  }

  get p2trLockingScript(): btc.Script {
    return new btc.Script(`OP_1 32 0x${this.tpubkey}`)
  }

  get controlBlock(): Buffer {
    return Buffer.from(this.cblock, 'hex')
  }

  contractCallToWitness(method: string, args: any[]): Buffer[] {
    const args_ = args.map(arg => this.argMapper(arg))
    const unlockingScript = (this.contract as any).delegateInstance[method](...args_).unlockingScript
    return unlockingScriptToWitness(unlockingScript)
  }

  argMapper(arg: any) {
    for (const key in arg) {
      if (Object.prototype.hasOwnProperty.call(arg, key)) {
        const value = arg[key]
        if (typeof value === 'function') {
          arg[key] = value()
        } else if (typeof value === 'object' && value !== null) {
          arg[key] = this.argMapper(value)
        }
      }
    }
    return typeof arg === 'function' ? arg() : arg
  }

  witnessToContractCallArgs(witness: Buffer[], method: string): Arguments {
    const abiCoder: ABICoder = (this.contract as any).getDelegateClazz().abiCoder
    const abiEntity = abiCoder.abi.find(abi => abi.name === method)
    if (!abiEntity) {
      throw new Error(`Method ${method} not found in ABI`)
    }
    const argsWitness = witness.slice(0, -2)
    if (abiEntity.params.length > argsWitness.length) {
      throw new Error(`Unexpected number of witness elements, got ${witness.length - 2}, expected at least ${abiEntity.params.length}`)
    }
    let unlockingScriptHex = Buffer.from(bitcoinjs.script.compile(argsWitness)).toString('hex')
    if (abiEntity.index) {
      unlockingScriptHex = unlockingScriptHex + int2ByteString(BigInt(abiEntity.index))
    }
    try {
      const callData = abiCoder.parseCallData(unlockingScriptHex)
      return callData.args
    } catch (error) {
      throw new Error(`Error parsing call data: ${error}`)
    }
  }

  static create(contract: SmartContract) {
      return new TapLeafSmartContract(contract)
  }
}
