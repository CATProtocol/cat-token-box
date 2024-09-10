import { MAX_NEXT_MINTERS, OpenMinter } from '../src/contracts/token/openMinter'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '../src/lib/catTx'
import {
    OpenMinterProto,
    OpenMinterState,
} from '../src/contracts/token/openMinterProto'
import { int32 } from '../src/contracts/utils/txUtil'
import { CAT20Proto, CAT20State } from '../src/contracts/token/cat20Proto'
import { getTxCtx } from '../src/lib/txTools'
import { getBackTraceInfo } from '../src/lib/proof'
import { getDummySigner, getDummyUTXO } from './utils/txHelper'
import { KeyInfo } from './utils/privateKey'
import { MethodCallOptions, toByteString } from 'scrypt-ts'
import { unlockTaprootContractInput } from './utils/contractUtils'
import { btc } from '../src/lib/btc'

export type GetTokenScript = (minterScript: string) => Promise<string>

export async function openMinterDeploy(
    seckey,
    address,
    genesisTx,
    genesisUtxo,
    openMinter: OpenMinter,
    getTokenScript: GetTokenScript,
    max: int32,
    premine: int32,
    limit: int32,
    options: {
        wrongRemainingSupply?: boolean
    } = {}
): Promise<ContractIns<OpenMinterState>> {
    const openMinterTaproot = TaprootSmartContract.create(openMinter)
    const tokenScript = await getTokenScript(openMinterTaproot.lockingScriptHex)
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    let remainingSupply = max - premine
    if (options.wrongRemainingSupply) {
        remainingSupply -= 1n
    }
    const openMinterState = OpenMinterProto.create(
        tokenScript,
        false,
        remainingSupply
    )
    const atIndex = catTx.addStateContractOutput(
        openMinterTaproot.lockingScript,
        OpenMinterProto.toByteString(openMinterState)
    )
    catTx.sign(seckey)
    const preCatTx = CatTx.create()
    preCatTx.tx = genesisTx
    return {
        catTx: catTx,
        contract: openMinter,
        state: openMinterState,
        preCatTx: preCatTx,
        contractTaproot: openMinterTaproot,
        atOutputIndex: atIndex,
    }
}

export async function openMinterCall(
    keyInfo: KeyInfo,
    contractIns: ContractIns<OpenMinterState>,
    tokenState: CAT20State,
    max: int32,
    premine: int32,
    limit: int32,
    options: {
        moreThanOneToken?: boolean
        minterExceeedLimit?: boolean
        wrongRemainingSupply?: boolean
    } = {}
): Promise<ContractCallResult<OpenMinterState | CAT20State>> {
    let NEXT_MINTERS = MAX_NEXT_MINTERS
    if (options.minterExceeedLimit) {
        NEXT_MINTERS += 1
    }
    if (options.wrongRemainingSupply) {
        max -= 1n
    }
    // if
    let splitAmountList = OpenMinterProto.getSplitAmountList(
        max,
        premine,
        limit,
        // number of new openMinter utxo
        NEXT_MINTERS
    )
    if (contractIns.state.isPremined) {
        splitAmountList = OpenMinterProto.getSplitAmountList(
            contractIns.state.remainingSupply,
            tokenState.amount,
            limit,
            // number of new openMinter utxo
            NEXT_MINTERS
        )
    }
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    const nexts: ContractIns<OpenMinterState | CAT20State>[] = []
    const openMinterState = contractIns.state
    for (let i = 0; i < splitAmountList.length; i++) {
        const amount = splitAmountList[i]
        if (amount > 0n) {
            const splitMinterState = OpenMinterProto.create(
                openMinterState.tokenScript,
                true,
                amount
            )
            const atOutputIndex = catTx.addStateContractOutput(
                contractIns.contractTaproot.lockingScript,
                OpenMinterProto.toByteString(splitMinterState)
            )
            nexts.push({
                catTx: catTx,
                contract: contractIns.contract,
                preCatTx: contractIns.catTx,
                state: splitMinterState,
                contractTaproot: contractIns.contractTaproot,
                atOutputIndex: atOutputIndex,
            })
        }
    }
    if (tokenState.amount > 0n) {
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.state.tokenScript,
            CAT20Proto.toByteString(tokenState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            preCatTx: contractIns.catTx,
            state: tokenState,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    if (options.moreThanOneToken) {
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.state.tokenScript,
            CAT20Proto.toByteString(tokenState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            preCatTx: contractIns.catTx,
            state: tokenState,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    const { shPreimage, prevoutsCtx, spentScripts, sighash } = await getTxCtx(
        catTx.tx,
        atInputIndex,
        contractIns.contractTaproot.tapleafBuffer
    )
    const backtraceInfo = getBackTraceInfo(
        contractIns.catTx.tx,
        contractIns.preCatTx?.tx,
        0
    )
    const sig = btc.crypto.Schnorr.sign(keyInfo.seckey, sighash.hash)
    await contractIns.contract.connect(getDummySigner())
    const openMinterFuncCall = await contractIns.contract.methods.mint(
        catTx.state.stateHashList,
        tokenState,
        splitAmountList,
        keyInfo.pubKeyPrefix,
        keyInfo.pubkeyX,
        () => sig.toString('hex'),
        toByteString('4a01000000000000'),
        toByteString('4a01000000000000'),
        contractIns.state,
        contractIns.catTx.getPreState(),
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
        } as MethodCallOptions<OpenMinter>
    )
    unlockTaprootContractInput(
        openMinterFuncCall,
        contractIns.contractTaproot,
        catTx.tx,
        contractIns.catTx.tx,
        0,
        true,
        true
    )
    return {
        catTx: catTx,
        contract: contractIns.contract,
        state: contractIns.state,
        contractTaproot: contractIns.contractTaproot,
        atInputIndex: atInputIndex,
        nexts: nexts,
    }
}
