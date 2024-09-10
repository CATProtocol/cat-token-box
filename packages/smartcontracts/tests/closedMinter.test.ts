import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import { ClosedMinter } from '../src/contracts/token/closedMinter'
import chaiAsPromised from 'chai-as-promised'
import { MethodCallOptions, hash160, toByteString } from 'scrypt-ts'
import { getOutpointString } from '../src/lib/txTools'
import {
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from './utils/txHelper'
import { CAT20Proto } from '../src/contracts/token/cat20Proto'
import { getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import {
    GetTokenScript,
    closedMinterCall,
    closedMinterDeploy,
} from './closedMinter'
import { CatTx, ContractCallResult, ContractIns } from '../src/lib/catTx'
import { getBackTraceInfo } from '../src/lib/proof'
import { unlockTaprootContractInput } from './utils/contractUtils'
import { btc } from '../src/lib/btc'
use(chaiAsPromised)

const DUST = toByteString('4a01000000000000')
const ZEROSAT = toByteString('0000000000000000')

export async function closedMinterUnlock<T>(
    callInfo: ContractCallResult<T>,
    getTokenScript: GetTokenScript,
    preCatTx: CatTx,
    seckey,
    tokenState,
    pubkeyX,
    pubKeyPrefix,
    prePreTx,
    increase: boolean
) {
    const { shPreimage, prevoutsCtx, spentScripts, sighash } =
        callInfo.catTx.getInputCtx(
            callInfo.atInputIndex,
            callInfo.contractTaproot.tapleafBuffer
        )
    const backtraceInfo = getBackTraceInfo(
        // pre
        preCatTx.tx,
        prePreTx,
        callInfo.atInputIndex
    )
    const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
    await callInfo.contract.connect(getDummySigner())
    const tokenScript = await getTokenScript(
        callInfo.contractTaproot.lockingScriptHex
    )
    const closedMinterFuncCall = await callInfo.contract.methods.mint(
        callInfo.catTx.state.stateHashList,
        tokenState,
        pubKeyPrefix,
        pubkeyX,
        () => sig.toString('hex'),
        increase ? DUST : ZEROSAT,
        toByteString('4a01000000000000'),
        {
            tokenScript: tokenScript,
        },
        // pre state
        preCatTx.getPreState(),
        backtraceInfo,
        shPreimage,
        prevoutsCtx,
        spentScripts,
        {
            script: toByteString(''),
            satoshis: toByteString('0000000000000000'),
        },
        {
            fromUTXO: getDummyUTXO(),
            verify: false,
            exec: false,
        } as MethodCallOptions<ClosedMinter>
    )
    unlockTaprootContractInput(
        closedMinterFuncCall,
        callInfo.contractTaproot,
        callInfo.catTx.tx,
        // pre tx
        preCatTx.tx,
        callInfo.atInputIndex,
        true,
        true
    )
}

// keyInfo
const keyInfo = getKeyInfoFromWif(getPrivKey())
const { addr: addrP2WPKH, seckey, xAddress, pubKeyPrefix, pubkeyX } = keyInfo
const { genesisTx, genesisUtxo } = getDummyGenesisTx(seckey, addrP2WPKH)
const genesisOutpoint = getOutpointString(genesisTx, 0)

// mint info
const tokenScript =
    '5120c4043a44196c410dba2d7c9288869727227e8fcec717f73650c8ceadc90877cd'
const getTokenScript = async () => tokenScript

describe('Test SmartContract `ClosedMinter`', () => {
    let closedMinter: ClosedMinter
    let contractIns: ContractIns<string>
    before(async () => {
        await ClosedMinter.loadArtifact()
        closedMinter = new ClosedMinter(xAddress, genesisOutpoint)
        contractIns = await closedMinterDeploy(
            seckey,
            genesisUtxo,
            closedMinter,
            getTokenScript
        )
    })

    it('should admin mint token with increase pass.', async () => {
        // tx call
        // token state
        const tokenState = CAT20Proto.create(100n, hash160(toByteString('00')))
        const increase = true
        const callInfo = await closedMinterCall(
            contractIns,
            tokenState,
            increase
        )
        await closedMinterUnlock(
            callInfo,
            getTokenScript,
            contractIns.catTx,
            seckey,
            tokenState,
            pubkeyX,
            pubKeyPrefix,
            genesisTx,
            increase
        )
        expect(callInfo.nexts.length).to.be.equal(1)
    })

    it('should admin mint token without increase pass.', async () => {
        // tx call
        // token state
        const tokenState = CAT20Proto.create(100n, hash160(toByteString('00')))
        const increase = false
        const callInfo = await closedMinterCall(
            contractIns,
            tokenState,
            increase
        )
        await closedMinterUnlock(
            callInfo,
            getTokenScript,
            contractIns.catTx,
            seckey,
            tokenState,
            pubkeyX,
            pubKeyPrefix,
            genesisTx,
            increase
        )
        expect(callInfo.nexts.length).to.be.equal(0)
    })

    it('should admin mint token with increase multi pass.', async () => {
        // tx call
        // token state
        const tokenState = CAT20Proto.create(100n, hash160(toByteString('00')))
        const increase = true
        let prePreTx = genesisTx
        for (let index = 0; index < 10; index++) {
            const callInfo = await closedMinterCall(
                contractIns,
                tokenState,
                increase
            )
            await closedMinterUnlock(
                callInfo,
                getTokenScript,
                contractIns.catTx,
                seckey,
                tokenState,
                pubkeyX,
                pubKeyPrefix,
                prePreTx,
                increase
            )
            expect(callInfo.nexts.length).to.be.equal(1)
            prePreTx = contractIns.catTx.tx
            contractIns = callInfo.nexts[0]
        }
    })
})
