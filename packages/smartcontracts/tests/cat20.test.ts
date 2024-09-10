import * as dotenv from 'dotenv'
dotenv.config()

import { expect, use } from 'chai'
import {
    emptyTokenArray,
    getBackTraceInfoSearch,
    getTxHeaderCheck,
} from '../src/lib/proof'
import chaiAsPromised from 'chai-as-promised'
import { MethodCallOptions, fill, hash160, toByteString } from 'scrypt-ts'
import { getOutpointObj, getOutpointString, getTxCtx } from '../src/lib/txTools'
import { CAT20Proto, CAT20State } from '../src/contracts/token/cat20Proto'
import { GuardProto } from '../src/contracts/token/guardProto'
import { CAT20, GuardInfo } from '../src/contracts/token/cat20'
import { ClosedMinter } from '../src/contracts/token/closedMinter'
import { TransferGuard } from '../src/contracts/token/transferGuard'
import {
    UTXO,
    getBtcDummyUtxo,
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from './utils/txHelper'
import {
    MAX_INPUT,
    MAX_TOKEN_INPUT,
    MAX_TOKEN_OUTPUT,
} from '../src/contracts/utils/txUtil'
import { KeyInfo, getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import { unlockTaprootContractInput } from './utils/contractUtils'
import {
    closedMinterCall,
    closedMinterDeploy,
    getGuardContractInfo,
    guardDeloy,
} from './cat20'
import {
    CatTx,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '../src/lib/catTx'
import { BurnGuard } from '../src/contracts/token/burnGuard'
import { btc } from '../src/lib/btc'
use(chaiAsPromised)

export async function tokenTransferCall(
    feeGuardUtxo,
    feeTokenUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    inputTokens: ContractIns<CAT20State>[],
    receivers: CAT20State[],
    minterScript: string,
    guardInfo: TaprootMastSmartContract,
    burn: boolean,
    options: {
        errorGuardTokenScript?: boolean
        errorGuardScript?: boolean
        errorGuardInputIndex?: boolean
        contractUnlock?: boolean
        wrongBacktraceInfo?: boolean
        withoutGuardInput?: boolean
        haveOutput?: boolean
        notOwner?: boolean
        stateOutput?: { locking: string; stateString: string }
    } = {}
): Promise<ContractIns<CAT20State>[]> {
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    if (options.errorGuardTokenScript) {
        guardState.tokenScript = '0000'
    }
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index] =
                inputTokens[index].state.amount
        }
    }
    const guardDeployInfo = await guardDeloy(
        feeGuardUtxo,
        seckey,
        guardState,
        guardInfo,
        burn,
        options.errorGuardScript
    )
    const catTx = CatTx.create()
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
    }
    catTx.fromCatTx(guardDeployInfo.catTx, guardDeployInfo.atOutputIndex)
    catTx.tx.from(feeTokenUtxo)
    if (!burn) {
        for (const receiver of receivers) {
            catTx.addStateContractOutput(
                guardState.tokenScript,
                CAT20Proto.toByteString(receiver)
            )
        }
        if (options.stateOutput) {
            catTx.addStateContractOutput(
                options.stateOutput.locking,
                options.stateOutput.stateString
            )
        }
    }
    if (options.haveOutput) {
        for (const receiver of receivers) {
            catTx.addStateContractOutput(
                guardState.tokenScript,
                CAT20Proto.toByteString(receiver)
            )
        }
    }
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                catTx.tx,
                i,
                inputToken.contractTaproot.tapleafBuffer
            )
        let sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        if (options.wrongBacktraceInfo) {
            backtraceInfo.preTx.outputScriptList[0] += '00'
        }
        const amountCheckTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        let guardInputIndex = inputTokens.length
        if (options.errorGuardInputIndex) {
            guardInputIndex -= 1
        }
        if (options.withoutGuardInput) {
            guardInputIndex = MAX_INPUT + 1
        }
        if (options.notOwner) {
            sig = ''
        }
        const amountCheckInfo: GuardInfo = {
            outputIndex: getOutpointObj(guardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(guardInputIndex),
            tx: amountCheckTx.tx,
            guardState: guardDeployInfo.state,
        }
        await inputToken.contract.connect(getDummySigner())
        const tokenCall = await inputToken.contract.methods.unlock(
            {
                isUserSpend: !options.contractUnlock,
                userPubKeyPrefix: pubKeyPrefix,
                userPubKey: pubkeyX,
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(inputTokens.length + 1),
            },
            inputToken.state,
            inputToken.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20>
        )
        unlockTaprootContractInput(
            tokenCall,
            inputToken.contractTaproot,
            catTx.tx,
            preTx,
            i,
            true,
            true
        )
    }
    const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
        catTx.tx,
        inputTokens.length,
        guardDeployInfo.contractTaproot.tapleafBuffer
    )
    const preTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
    await guardDeployInfo.contract.connect(getDummySigner())
    if (!burn) {
        const tokenOutputMaskArray = fill(false, MAX_TOKEN_OUTPUT)
        const tokenAmountArray = fill(0n, MAX_TOKEN_OUTPUT)
        const mixArray = emptyTokenArray()
        const outputSatoshiArray = emptyTokenArray()
        for (let i = 0; i < receivers.length; i++) {
            const receiver = receivers[i]
            tokenOutputMaskArray[i] = true
            tokenAmountArray[i] = receiver.amount
            mixArray[i] = receiver.ownerAddr
        }
        if (options.stateOutput) {
            mixArray[receivers.length] = options.stateOutput.locking
            outputSatoshiArray[receivers.length] =
                toByteString('4a01000000000000')
        }
        const tokenTransferCheckCall =
            await guardDeployInfo.contract.methods.transfer(
                catTx.state.stateHashList,
                mixArray,
                tokenAmountArray,
                tokenOutputMaskArray,
                outputSatoshiArray,
                toByteString('4a01000000000000'),
                guardDeployInfo.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                spentScripts,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<TransferGuard>
            )
        unlockTaprootContractInput(
            tokenTransferCheckCall,
            guardDeployInfo.contractTaproot,
            catTx.tx,
            guardDeployInfo.catTx.tx,
            inputTokens.length,
            true,
            true
        )
    } else {
        {
            const outputArray = emptyTokenArray()
            const outputSatoshiArray = emptyTokenArray()
            const burnGuardCall = await guardDeployInfo.contract.methods.burn(
                catTx.state.stateHashList,
                outputArray,
                outputSatoshiArray,
                guardDeployInfo.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<BurnGuard>
            )
            unlockTaprootContractInput(
                burnGuardCall,
                guardDeployInfo.contractTaproot,
                catTx.tx,
                guardDeployInfo.catTx.tx,
                inputTokens.length,
                true,
                true
            )
        }
    }
    if (!burn) {
        return receivers.map((tokenState, index) => {
            return {
                catTx: catTx,
                preCatTx: inputTokens[0].catTx,
                contract: inputTokens[0].contract,
                state: tokenState,
                contractTaproot: inputTokens[0].contractTaproot,
                atOutputIndex: index + 1,
            }
        })
    } else {
        return []
    }
}

export async function tokenBurnAndClosedMinterCall(
    feeGuardUtxo,
    feeTokenUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    inputTokens: ContractIns<CAT20State>[],
    closedMinterIns: ContractIns<string>,
    receiver: CAT20State,
    minterScript: string,
    guardInfo: TaprootMastSmartContract
): Promise<ContractIns<CAT20State>[]> {
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index] =
                inputTokens[index].state.amount
        }
    }
    const guardDeployInfo = await guardDeloy(
        feeGuardUtxo,
        seckey,
        guardState,
        guardInfo,
        true
    )
    const catTx = CatTx.create()
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
    }
    catTx.fromCatTx(guardDeployInfo.catTx, guardDeployInfo.atOutputIndex)
    // add closedMinter contract
    catTx.fromCatTx(closedMinterIns.catTx, closedMinterIns.atOutputIndex)
    catTx.tx.from(feeTokenUtxo)
    // add output
    catTx.addStateContractOutput(
        closedMinterIns.state,
        CAT20Proto.toByteString(receiver)
    )
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                catTx.tx,
                i,
                inputToken.contractTaproot.tapleafBuffer
            )
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        const amountCheckTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        const guardInputIndex = inputTokens.length
        const amountCheckInfo: GuardInfo = {
            outputIndex: getOutpointObj(guardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(guardInputIndex),
            tx: amountCheckTx.tx,
            guardState: guardDeployInfo.state,
        }
        await inputToken.contract.connect(getDummySigner())
        const tokenCall = await inputToken.contract.methods.unlock(
            {
                isUserSpend: true,
                userPubKeyPrefix: pubKeyPrefix,
                userPubKey: pubkeyX,
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(inputTokens.length + 1),
            },
            inputToken.state,
            inputToken.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20>
        )
        unlockTaprootContractInput(
            tokenCall,
            inputToken.contractTaproot,
            catTx.tx,
            preTx,
            i,
            true,
            true
        )
    }
    const { shPreimage, prevoutsCtx } = await getTxCtx(
        catTx.tx,
        inputTokens.length,
        guardDeployInfo.contractTaproot.tapleafBuffer
    )
    const preTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
    await guardDeployInfo.contract.connect(getDummySigner())
    const outputArray = emptyTokenArray()
    outputArray[0] = closedMinterIns.state
    const outputSatoshiArray = emptyTokenArray()
    outputSatoshiArray[0] = toByteString('4a01000000000000')
    const burnGuardCall = await guardDeployInfo.contract.methods.burn(
        catTx.state.stateHashList,
        outputArray,
        outputSatoshiArray,
        guardDeployInfo.state,
        preTx.tx,
        shPreimage,
        prevoutsCtx,
        {
            fromUTXO: getDummyUTXO(),
            verify: false,
            exec: false,
        } as MethodCallOptions<BurnGuard>
    )
    unlockTaprootContractInput(
        burnGuardCall,
        guardDeployInfo.contractTaproot,
        catTx.tx,
        guardDeployInfo.catTx.tx,
        inputTokens.length,
        true,
        true
    )
    return []
}

describe('Test `CAT20` tokens', () => {
    let keyInfo: KeyInfo
    let genesisTx: btc.Transaction
    let genesisUtxo: UTXO
    let genesisOutpoint: string
    let closedMinter: ClosedMinter
    let closedMinterTaproot: TaprootSmartContract
    let guardInfo: TaprootMastSmartContract
    let token: CAT20
    let tokenTaproot: TaprootSmartContract
    let closedMinterIns: ContractIns<string>
    let closedMinterInsFake: ContractIns<string>
    let closedMinterInsUpgrade: ContractIns<string>
    let feeGuardUtxo
    let feeTokenUtxo
    let wrongFeeTokenUtxo

    before(async () => {
        // init load
        await ClosedMinter.loadArtifact()
        await CAT20.loadArtifact()
        await TransferGuard.loadArtifact()
        await BurnGuard.loadArtifact()
        // key info
        keyInfo = getKeyInfoFromWif(getPrivKey())
        // dummy genesis
        const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        genesisTx = dummyGenesis.genesisTx
        genesisUtxo = dummyGenesis.genesisUtxo
        genesisOutpoint = getOutpointString(genesisTx, 0)
        // minter
        closedMinter = new ClosedMinter(keyInfo.xAddress, genesisOutpoint)
        closedMinterTaproot = TaprootSmartContract.create(closedMinter)
        // guard
        guardInfo = getGuardContractInfo()
        // token
        token = new CAT20(
            closedMinterTaproot.lockingScriptHex,
            guardInfo.lockingScriptHex
        )
        tokenTaproot = TaprootSmartContract.create(token)
        // deploy minter
        closedMinterIns = await closedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            closedMinter,
            tokenTaproot.lockingScriptHex
        )
        const dummyFakeGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        // minter
        const fakeClosedMinter = new ClosedMinter(
            keyInfo.xAddress,
            getOutpointString(dummyFakeGenesis.genesisTx, 0)
        )
        closedMinterInsFake = await closedMinterDeploy(
            keyInfo.seckey,
            dummyFakeGenesis.genesisUtxo,
            fakeClosedMinter,
            tokenTaproot.lockingScriptHex
        )
        // closedMinterInsUpgrade
        const dummyGenesisUpgrade = getDummyGenesisTx(
            keyInfo.seckey,
            keyInfo.addr
        )
        const closedMinterUpgrade = new ClosedMinter(
            keyInfo.xAddress,
            getOutpointString(dummyGenesisUpgrade.genesisTx, 0)
        )
        const closedMinterUpgradeTaproot =
            TaprootSmartContract.create(closedMinterUpgrade)
        // upgrade token
        const upgradeToken = new CAT20(
            closedMinterUpgradeTaproot.lockingScriptHex,
            guardInfo.lockingScriptHex
        )
        const upgradeTokenTaproot = TaprootSmartContract.create(upgradeToken)
        closedMinterInsUpgrade = await closedMinterDeploy(
            keyInfo.seckey,
            dummyGenesisUpgrade.genesisUtxo,
            closedMinterUpgrade,
            upgradeTokenTaproot.lockingScriptHex
        )
        feeGuardUtxo = getBtcDummyUtxo(keyInfo.addr)
        feeTokenUtxo = getBtcDummyUtxo(keyInfo.addr)
        wrongFeeTokenUtxo = getBtcDummyUtxo(
            new btc.PrivateKey().toAddress(
                null,
                btc.Address.PayToWitnessPublicKeyHash
            )
        )
    })

    async function mintToken(tokenState: CAT20State) {
        const closedMinterCallInfo = await closedMinterCall(
            closedMinterIns,
            tokenTaproot,
            tokenState,
            true
        )
        closedMinterIns = closedMinterCallInfo.nexts[0] as ContractIns<string>
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT20State>
    }

    async function mintFakeToken(tokenState: CAT20State) {
        const closedMinterCallInfo = await closedMinterCall(
            closedMinterInsFake,
            tokenTaproot,
            tokenState,
            true
        )
        closedMinterInsFake = closedMinterCallInfo
            .nexts[0] as ContractIns<string>
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT20State>
    }

    async function getTokenByNumber(
        count: number,
        xAddress: string,
        overflow: boolean = false
    ): Promise<ContractIns<CAT20State>[]> {
        const inputTokens: ContractIns<CAT20State>[] = []
        for (let i = 0; i < count; i++) {
            let amount = BigInt(Math.floor(Math.random() * 100)) + 10n
            if (overflow) {
                amount = BigInt(2147483647)
            }
            inputTokens.push(
                await mintToken(CAT20Proto.create(amount, xAddress))
            )
        }
        return inputTokens
    }

    function devideRecevierByNumber(
        inputTokens: ContractIns<CAT20State>[],
        devideNumber: number,
        xAddress: string
    ) {
        const total = inputTokens.reduce(
            (prev, current) => prev + current.state.amount,
            0n
        )
        const per = total / BigInt(devideNumber)
        const delta = total - per * BigInt(devideNumber)
        const respList: CAT20State[] = []
        for (let index = 0; index < devideNumber - 1; index++) {
            respList.push(CAT20Proto.create(per, xAddress))
        }
        respList.push(CAT20Proto.create(per + delta, xAddress))
        return respList
    }

    describe('When a token is being transferred by users', () => {
        it('t01: should succeed with multiple inputs and outputs', async () => {
            for (let i = 1; i <= MAX_TOKEN_INPUT; i++) {
                for (let j = 1; j <= MAX_TOKEN_OUTPUT; j++) {
                    const inputTokens = await getTokenByNumber(
                        i,
                        keyInfo.xAddress
                    )
                    const receviers = devideRecevierByNumber(
                        inputTokens,
                        j,
                        keyInfo.xAddress
                    )
                    // minter create token transfer
                    const nextInputTokens = await tokenTransferCall(
                        [],
                        [],
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        inputTokens,
                        receviers,
                        closedMinterTaproot.lockingScriptHex,
                        guardInfo,
                        false
                    )
                    // transfer create token transfer
                    await tokenTransferCall(
                        [],
                        [],
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        nextInputTokens,
                        receviers,
                        closedMinterTaproot.lockingScriptHex,
                        guardInfo,
                        false
                    )
                }
            }
        })

        it('t02: should succeed with a stand-alone fee input', async () => {
            for (let i = 1; i <= MAX_TOKEN_INPUT - 1; i++) {
                for (let j = 1; j <= MAX_TOKEN_OUTPUT - 1; j++) {
                    const inputTokens = await getTokenByNumber(
                        i,
                        keyInfo.xAddress
                    )
                    const receviers = devideRecevierByNumber(
                        inputTokens,
                        j,
                        keyInfo.xAddress
                    )
                    // minter create token transfer
                    const nextInputTokens = await tokenTransferCall(
                        [feeGuardUtxo],
                        [feeTokenUtxo],
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        inputTokens,
                        receviers,
                        closedMinterTaproot.lockingScriptHex,
                        guardInfo,
                        false
                    )
                    // transfer create token transfer
                    await tokenTransferCall(
                        [feeGuardUtxo],
                        [feeTokenUtxo],
                        keyInfo.seckey,
                        keyInfo.pubKeyPrefix,
                        keyInfo.pubkeyX,
                        nextInputTokens,
                        receviers,
                        closedMinterTaproot.lockingScriptHex,
                        guardInfo,
                        false
                    )
                }
            }
        })

        it('t03: should fail when token inputs count is greater than maxInputLimit', async () => {
            const inputTokens = await getTokenByNumber(
                MAX_TOKEN_INPUT + 1,
                keyInfo.xAddress
            )
            const receviers = devideRecevierByNumber(
                inputTokens,
                1,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t04: should fail when token outputs count is greater than maxOutputLimit', async () => {
            const inputTokens = await getTokenByNumber(1, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                MAX_TOKEN_OUTPUT + 2,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t05: should fail when inputs total amount is greater than outputs total amount', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            // input total add 1
            inputTokens[0].state.amount += 1n
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t06: should fail when inputs total amount is less than outputs total amount', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            // output total add 1
            receviers[0].amount += 1n
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t07: should fail when inputs total amount is overflowed', async () => {
            const inputTokens = await getTokenByNumber(
                3,
                keyInfo.xAddress,
                true
            )
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t08: should fail when any output amount is zero', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            receviers.push(CAT20Proto.create(0n, keyInfo.xAddress))
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t09: should fail when without guard input', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    { withoutGuardInput: true }
                )
            ).to.be.rejected
        })

        it('t10: should fail when with a guard of the wrong state', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    { errorGuardTokenScript: true }
                )
            ).to.be.rejected
        })

        it('t11: should fail when with a wrong guard input', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    { errorGuardScript: true }
                )
            ).to.be.rejected
        })

        it('t12: should fail when from a wrong genesis', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const fakeToken = await mintFakeToken(
                CAT20Proto.create(100n, keyInfo.xAddress)
            )
            inputTokens.push(fakeToken)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false
                )
            ).to.be.rejected
        })

        it('t13: should fail when from wrong transferGuardInputIndex', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    { errorGuardInputIndex: true }
                )
            ).to.be.rejected
        })

        it('t14: should fail when wrong backtraceInfo', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    {
                        wrongBacktraceInfo: true,
                    }
                )
            ).to.be.rejected
        })

        it('t15: should fail when from a contract', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    { contractUnlock: true }
                )
            ).to.be.rejected
        })
    })

    describe('When a token is being transferred by contracts', () => {
        it('t01: should succeed when unlocking from the right contract', async () => {
            const addrOutput = genesisTx.outputs[0]
            const addrLocking = addrOutput.script.toHex()
            const tokenAddress = hash160(addrLocking)
            const inputTokens = await getTokenByNumber(3, tokenAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                tokenAddress
            )
            // minter create token transfer
            await tokenTransferCall(
                [feeGuardUtxo],
                [feeTokenUtxo],
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                inputTokens,
                receviers,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                false,
                {
                    contractUnlock: true,
                }
            )
        })

        it('t02: should fail when unlocking from a wrong contract', async () => {
            const addrOutput = genesisTx.outputs[0]
            const addrLocking = addrOutput.script.toHex()
            const tokenAddress = hash160(addrLocking)
            const inputTokens = await getTokenByNumber(3, tokenAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                tokenAddress
            )
            // minter create token transfer
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [wrongFeeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    {
                        contractUnlock: true,
                    }
                )
            ).to.be.rejected
        })

        it('t03: should fail when without guard input', async () => {
            const addrOutput = genesisTx.outputs[0]
            const addrLocking = addrOutput.script.toHex()
            const tokenAddress = hash160(addrLocking)
            const inputTokens = await getTokenByNumber(3, tokenAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                tokenAddress
            )
            // minter create token transfer
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    {
                        contractUnlock: true,
                        withoutGuardInput: true,
                    }
                )
            ).to.be.rejected
        })

        it('t04: should fail when from a user signature', async () => {
            const addrOutput = genesisTx.outputs[0]
            const addrLocking = addrOutput.script.toHex()
            const tokenAddress = hash160(addrLocking)
            const inputTokens = await getTokenByNumber(3, tokenAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                tokenAddress
            )
            // minter create token transfer
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    false,
                    {
                        contractUnlock: false,
                    }
                )
            ).to.be.rejected
        })

        it('t05: should succeed when output have state', async () => {
            const addrOutput = genesisTx.outputs[0]
            const addrLocking = addrOutput.script.toHex()
            const tokenAddress = hash160(addrLocking)
            const inputTokens = await getTokenByNumber(3, tokenAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                tokenAddress
            )
            // minter create token transfer
            await tokenTransferCall(
                [feeGuardUtxo],
                [feeTokenUtxo],
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                inputTokens,
                receviers,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                false,
                {
                    contractUnlock: true,
                    stateOutput: {
                        locking: guardInfo.lockingScriptHex,
                        stateString: toByteString('01'),
                    },
                }
            )
        })
    })

    describe('When a token is being burt', () => {
        it('t01: should success', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await tokenTransferCall(
                [feeGuardUtxo],
                [feeTokenUtxo],
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                inputTokens,
                receviers,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                true
            )
        })

        it('t02: should fail when there is any same kind of token output', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    true,
                    {
                        haveOutput: true,
                    }
                )
            ).to.be.rejected
        })

        it('t03: should fail when without guard input', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    true,
                    {
                        withoutGuardInput: true,
                    }
                )
            ).to.be.rejected
        })

        it('t04: should fail when with a wrong guard input', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    true,
                    {
                        errorGuardInputIndex: true,
                    }
                )
            ).to.be.rejected
        })

        it('t05: should fail when by anyone who is not the owner', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receviers = devideRecevierByNumber(
                inputTokens,
                3,
                keyInfo.xAddress
            )
            await expect(
                tokenTransferCall(
                    [feeGuardUtxo],
                    [feeTokenUtxo],
                    keyInfo.seckey,
                    keyInfo.pubKeyPrefix,
                    keyInfo.pubkeyX,
                    inputTokens,
                    receviers,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    true,
                    {
                        errorGuardInputIndex: true,
                    }
                )
            ).to.be.rejected
        })

        it('t06: should success with minter upgrade token', async () => {
            const inputTokens = await getTokenByNumber(3, keyInfo.xAddress)
            const receiver = CAT20Proto.create(100n, keyInfo.xAddress)
            await tokenBurnAndClosedMinterCall(
                feeGuardUtxo,
                feeTokenUtxo,
                keyInfo.seckey,
                keyInfo.pubKeyPrefix,
                keyInfo.pubkeyX,
                inputTokens,
                closedMinterInsUpgrade,
                receiver,
                closedMinterTaproot.lockingScriptHex,
                guardInfo
            )
        })
    })
})
