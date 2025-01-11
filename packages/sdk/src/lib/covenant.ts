import { ByteString, FixedArray, hash160, SmartContract, UTXO } from 'scrypt-ts'
import { Tap } from '@cmdcode/tapscript' // Requires node >= 19
import { btc, LEAF_VERSION_TAPSCRIPT } from './btc'
import { SupportedNetwork, TAPROOT_ONLY_SCRIPT_SPENT_KEY } from './constants'
import { TapLeafSmartContract } from './tapLeafSmartContract'
import { Optional, p2trLockingScriptToAddr } from './utils'
import { cloneDeep } from "lodash";
import { MAX_STATE } from '../contracts/utils/txUtil'
import { md5 } from 'scryptlib'

type AliasedContract = {
  alias?: string;
  contract: SmartContract;
}

export interface StatefulCovenantUtxo {
  utxo: UTXO,
  txoStateHashes: FixedArray<ByteString, typeof MAX_STATE>,
}

export abstract class Covenant<StateT = undefined> {
  tapLeafContracts: Record<string, TapLeafSmartContract>

  readonly tpubkey: string
  readonly lockingScript: btc.Script
  readonly address: string

  // to identify the underlying asm scripts.
  readonly asmVersion: string

  state?: StateT;
  utxo?: UTXO;

  constructor(
    subContracts: Array<AliasedContract>,
    options: {
      lockedAsmVersion: string;
      network?: SupportedNetwork;
    },
  ) {
      const tapLeafContracts: Record<string, TapLeafSmartContract> = {}
      const tapTree = []
      for (const {alias, contract} of subContracts) {
          const aliasName = alias || 'default'
          if (tapLeafContracts[aliasName]) {
              throw new Error(`Alias ${aliasName} for contract already exists`)
          }
          const taprootContract = TapLeafSmartContract.create(contract)
          tapLeafContracts[aliasName] = taprootContract
          tapTree.push(taprootContract.tapScript)
      }
      const [tpubkey] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
          tree: tapTree,
          version: LEAF_VERSION_TAPSCRIPT
      })

      for (const cK of subContracts.map(c => c.alias || 'default')) {
          const taprootContract = tapLeafContracts[cK]
          const [, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
              target: taprootContract.tapScript,
              tree: tapTree,
              version: LEAF_VERSION_TAPSCRIPT
          })
          taprootContract.tpubkey = tpubkey
          taprootContract.cblock = cblock
      }

      this.tpubkey = tpubkey
      this.lockingScript = new btc.Script(`OP_1 32 0x${tpubkey}`)
      this.tapLeafContracts = tapLeafContracts
      this.address = p2trLockingScriptToAddr(this.lockingScript.toHex(), options.network)
      this.asmVersion = Covenant.calculateAsmVersion(
        subContracts.map(c => (c.contract.constructor as typeof SmartContract).getArtifact().md5)
      )

      if (this.asmVersion !== options.lockedAsmVersion) {
          throw new Error(`Locked ASM version mismatch: current(${this.asmVersion}) vs locked(${options.lockedAsmVersion})`)
      }
  }

  static calculateAsmVersion(subContractMd5: string[]): string {
    if (subContractMd5.length === 1) {
      return subContractMd5[0]
    }
    return md5(subContractMd5.join('-'))
  }

  abstract serializedState(): ByteString;

  bindToUtxo(utxo: Optional<UTXO, 'script'>): this {
    if (utxo.script && this.lockingScript.toHex() !== utxo.script) {
      throw new Error(`Different script, can not bind covenant '${this.constructor.name}' to this UTXO: ${JSON.stringify(utxo)}!`)
    }
    this.utxo = {...utxo, script: this.lockingScript.toHex()}
    return this
  }

  get lockingScriptHex(): ByteString {
    return this.lockingScript.toHex()
  }

  getTapLeafContract(alias: string = 'default'): TapLeafSmartContract {
    return this.tapLeafContracts[alias]
  }

  getSubContract(alias: string = 'default'): SmartContract {
    return this.getTapLeafContract(alias).contract
  }

  next(state: StateT): Covenant<StateT> {
    const next = cloneDeep(this)
    next.state = state
    next.utxo = undefined
    return next
  }

  get stateHash(): ByteString {
    return this.state ? hash160(this.serializedState()) : ''
  }

  getSubContractCallArg(
    inputWitness: Buffer[],
    method: string,
    argName: string,
    alias?: string
  ) {
    const tapLeafContract = this.getTapLeafContract(alias)
    const callArgs = tapLeafContract.witnessToContractCallArgs(
      inputWitness,
      method,
    )
    return (
      callArgs.find(arg => arg.name === argName)?.value
    )
  }

}
