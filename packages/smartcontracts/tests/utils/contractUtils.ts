import { Tap } from '@cmdcode/tapscript' // Requires node >= 19
import { expect } from 'chai'
import { SmartContract } from 'scrypt-ts'
import { callToBufferList, checkDisableOpCode } from '../../src/lib/txTools'
import { btc } from '../../src/lib/btc'

const TAPROOT_ONLY_SCRIPT_SPENT_KEY =
    '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

export function getContractTaprootInfo(contract: SmartContract) {
    const contractScript = contract.lockingScript
    expect(checkDisableOpCode(contractScript)).to.be.equal(false)
    const tapleaf = Tap.encodeScript(contractScript.toBuffer())
    const [tpubkey, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
        target: tapleaf,
    })
    const lockingScript = new btc.Script(`OP_1 32 0x${tpubkey}}`)
    return {
        contractScript: contractScript,
        contractScriptBuffer: contractScript.toBuffer(),
        tapleaf: tapleaf,
        tapleafBuffer: Buffer.from(tapleaf, 'hex'),
        tpubkey: tpubkey,
        cblock: cblock,
        cblockBuffer: Buffer.from(cblock, 'hex'),
        lockingScript: lockingScript,
        lockingScriptHex: lockingScript.toBuffer().toString('hex'),
    }
}

export function unlockTaprootContractInput(
    methodCall,
    contractInfo,
    tx: btc.Transaction,
    preTx: btc.Transaction,
    inputIndex: number,
    verify: boolean,
    expected: boolean
) {
    const witnesses = [
        ...callToBufferList(methodCall),
        // taproot script + cblock
        contractInfo.contractScriptBuffer,
        contractInfo.cblockBuffer,
    ]
    tx.inputs[inputIndex].witnesses = witnesses
    if (verify) {
        const input = tx.inputs[inputIndex]
        const interpreter = new btc.Script.Interpreter()
        const flags =
            btc.Script.Interpreter.SCRIPT_VERIFY_WITNESS |
            btc.Script.Interpreter.SCRIPT_VERIFY_TAPROOT
        const res = interpreter.verify(
            new btc.Script(''),
            preTx.outputs[input.outputIndex].script,
            tx,
            inputIndex,
            flags,
            witnesses,
            preTx.outputs[input.outputIndex].satoshis
        )
        expect(checkDisableOpCode(contractInfo.contractScript)).to.be.equal(
            false
        )
        expect(res).to.be.equal(expected)
    }
}
