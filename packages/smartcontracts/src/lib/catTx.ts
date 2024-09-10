import { ProtocolState } from './state'
import { ByteString, SmartContract, hash160, toByteString } from 'scrypt-ts'
import { getTxCtx } from './txTools'
import { Tap } from '@cmdcode/tapscript' // Requires node >= 19
import { btc } from './btc'

const TAPROOT_ONLY_SCRIPT_SPENT_KEY =
    '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

export type ContractIns<T> = {
    catTx: CatTx
    preCatTx?: CatTx
    contract: SmartContract
    contractTaproot: TaprootSmartContract
    state: T
    atOutputIndex: number
}

export type ContractCallResult<T> = {
    catTx: CatTx
    contract: SmartContract
    state: T
    contractTaproot: TaprootSmartContract
    atInputIndex: number
    nexts: ContractIns<T>[]
}

export class TaprootSmartContract {
    contract: SmartContract
    contractScript: btc.Script
    contractScriptBuffer: Buffer
    contractScriptHash: ByteString
    tapleaf: string
    tapleafBuffer: Buffer
    tpubkey: string
    cblock: string
    cblockBuffer: Buffer
    lockingScript: btc.Script
    lockingScriptHex: string

    constructor(contract: SmartContract) {
        const contractScript = contract.lockingScript
        const tapleaf = Tap.encodeScript(contractScript.toBuffer())
        const [tpubkey, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
            target: tapleaf,
        })
        const lockingScript = new btc.Script(`OP_1 32 0x${tpubkey}}`)
        this.contract = contract
        this.contractScript = contractScript
        this.contractScriptBuffer = contractScript.toBuffer()
        this.contractScriptHash = hash160(
            this.contractScriptBuffer.toString('hex')
        )
        this.tapleaf = tapleaf
        this.tapleafBuffer = Buffer.from(tapleaf, 'hex')
        this.tpubkey = tpubkey
        this.cblock = cblock
        this.cblockBuffer = Buffer.from(cblock, 'hex')
        this.lockingScript = lockingScript
        this.lockingScriptHex = lockingScript.toBuffer().toString('hex')
    }

    static create(contract: SmartContract) {
        return new TaprootSmartContract(contract)
    }
}

export class TaprootMastSmartContract {
    tpubkey: string
    lockingScript: btc.Script
    lockingScriptHex: string
    contractTaprootMap: Record<string, TaprootSmartContract>

    constructor(contractMap: Record<string, SmartContract>) {
        const contractTaprootMap: Record<string, TaprootSmartContract> = {}
        const tapTree = []
        for (const cK of Object.keys(contractMap)) {
            const contract = contractMap[cK]
            contractTaprootMap[cK] = TaprootSmartContract.create(contract)
            const script = contract.lockingScript
            const tapleaf = Tap.encodeScript(script.toBuffer())
            tapTree.push(tapleaf)
            contractTaprootMap[cK].tapleaf = tapleaf
            contractTaprootMap[cK].tapleafBuffer = Buffer.from(tapleaf, 'hex')
        }
        const [tpubkey] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
            tree: tapTree,
        })
        const lockingScript = new btc.Script(`OP_1 32 0x${tpubkey}}`)
        for (const cK of Object.keys(contractTaprootMap)) {
            const contractTaproot = contractTaprootMap[cK]
            const [, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
                target: contractTaproot.tapleaf,
                tree: tapTree,
            })
            contractTaproot.tpubkey = tpubkey
            contractTaproot.cblock = cblock
            contractTaproot.cblockBuffer = Buffer.from(cblock, 'hex')
            contractTaproot.lockingScript = lockingScript
            contractTaproot.lockingScriptHex = lockingScript
                .toBuffer()
                .toString('hex')
        }
        this.tpubkey = tpubkey
        this.lockingScript = lockingScript
        this.lockingScriptHex = lockingScript.toBuffer().toString('hex')
        this.contractTaprootMap = contractTaprootMap
    }

    static create(contractMap: Record<string, SmartContract>) {
        return new TaprootMastSmartContract(contractMap)
    }
}
export class CatTx {
    tx: btc.Transaction
    state: ProtocolState
    constructor() {
        this.tx = new btc.Transaction()
        this.state = ProtocolState.getEmptyState()
        this.tx.addOutput(
            new btc.Transaction.Output({
                satoshis: 0,
                script: this.state.stateScript,
            })
        )
    }

    updateState() {
        this.tx.outputs[0] = new btc.Transaction.Output({
            satoshis: 0,
            script: this.state.stateScript,
        })
    }

    static create() {
        return new CatTx()
    }

    fromCatTx(otherCatTx: CatTx, outputIndex: number) {
        this.tx.from(otherCatTx.getUTXO(outputIndex))
        return this.tx.inputs.length - 1
    }

    addContractOutput(lockingScript, satoshis: number = 330) {
        this.tx.addOutput(
            new btc.Transaction.Output({
                satoshis: satoshis,
                script: lockingScript,
            })
        )
        const index = this.tx.outputs.length - 1
        this.state.updateDataList(index - 1, toByteString(''))
        this.updateState()
        return this.tx.outputs.length - 1
    }

    addStateContractOutput(
        lockingScript,
        stateString: ByteString,
        satoshis: number = 330
    ) {
        this.tx.addOutput(
            new btc.Transaction.Output({
                satoshis: satoshis,
                script: lockingScript,
            })
        )
        const index = this.tx.outputs.length - 1
        this.state.updateDataList(index - 1, stateString)
        this.updateState()
        return index
    }

    getUTXO(outputIndex: number) {
        return {
            txId: this.tx.id,
            outputIndex: outputIndex,
            script: this.tx.outputs[outputIndex].script,
            satoshis: this.tx.outputs[outputIndex].satoshis,
        }
    }

    sign(seckey) {
        this.tx.sign(seckey)
    }

    getInputCtx(inputIndex, lockingScriptBuffer) {
        return getTxCtx(this.tx, inputIndex, lockingScriptBuffer)
    }

    getPreState() {
        return {
            statesHashRoot: this.state.hashRoot,
            txoStateHashes: this.state.stateHashList,
        }
    }
}

export function script2P2TR(script: Buffer): {
    p2tr: string
    tapScript: string
    cblock: string
} {
    const tapScript = Tap.encodeScript(script)
    const [p2tr, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
        target: tapScript,
    })
    return {
        p2tr: new btc.Script(`OP_1 32 0x${p2tr}}`).toHex(),
        tapScript: tapScript,
        cblock,
    }
}
