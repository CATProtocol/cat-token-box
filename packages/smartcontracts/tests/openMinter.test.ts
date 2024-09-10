import * as dotenv from 'dotenv'
dotenv.config()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { UTXO, hash160 } from 'scrypt-ts'
import { getOutpointString } from '../src/lib/txTools'
import { OpenMinter } from '../src/contracts/token/openMinter'
import { getBtcDummyUtxo, getDummyGenesisTx } from './utils/txHelper'
import {
    OpenMinterProto,
    OpenMinterState,
} from '../src/contracts/token/openMinterProto'
import { CAT20Proto, CAT20State } from '../src/contracts/token/cat20Proto'
import { KeyInfo, getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import { openMinterCall, openMinterDeploy } from './openMinter'
import {
    CatTx,
    ContractIns,
    TaprootSmartContract,
    script2P2TR,
} from '../src/lib/catTx'
import { getCatCommitScript } from '../src/lib/commit'
import { CAT20 } from '../src/contracts/token/cat20'
import { getGuardContractInfo } from './cat20'
import { TransferGuard } from '../src/contracts/token/transferGuard'
import { BurnGuard } from '../src/contracts/token/burnGuard'
import { btc } from '../src/lib/btc'
use(chaiAsPromised)

export interface TokenInfo {
    name: string
    symbol: string
    decimals: number
    minterMd5: string
}

export interface OpenMinterTokenInfo extends TokenInfo {
    max: bigint
    limit: bigint
    premine: bigint
}

describe('Test SmartContract `OpenMinter`', () => {
    let keyInfo: KeyInfo
    let max: bigint
    let limit: bigint
    let premine: bigint

    before(async () => {
        await OpenMinter.loadArtifact()
        await CAT20.loadArtifact()
        await TransferGuard.loadArtifact()
        await BurnGuard.loadArtifact()
        // key info
        keyInfo = getKeyInfoFromWif(getPrivKey())
    })

    describe('When deploying a new token', () => {
        it('should deploy an OpenMinter contract', async () => {
            // create genesisTx
            const info: OpenMinterTokenInfo = {
                name: 'CAT',
                symbol: 'C',
                decimals: 2,
                minterMd5: '0417a28b9d921607cab0454595860641',
                max: 21000000n,
                limit: 1000n,
                premine: 3150000n,
            }
            const commitScript = getCatCommitScript(keyInfo.pubkeyX, info)
            const lockingScript = Buffer.from(commitScript, 'hex')
            const {
                p2tr: p2trCommit,
                // tapScript,
                // cblock,
            } = script2P2TR(lockingScript)
            const utxos = [getBtcDummyUtxo(keyInfo.addr)]
            const genesisTx = new btc.Transaction().from([utxos]).addOutput(
                new btc.Transaction.Output({
                    satoshis: 330,
                    script: p2trCommit,
                })
            )
            const preCatTx = CatTx.create()
            preCatTx.tx = genesisTx
            // create revealTx
            const genesisUtxo = {
                address: keyInfo.addr.toString(),
                txId: genesisTx.id,
                outputIndex: 0,
                script: new btc.Script(keyInfo.addr),
                satoshis: genesisTx.outputs[0].satoshis,
            }
            const revealCatTx = CatTx.create()
            revealCatTx.tx.from(genesisUtxo)
            const genesisOutpoint = getOutpointString(genesisTx, 0)
            max = info.max * 10n ** BigInt(info.decimals)
            premine = info.premine * 10n ** BigInt(info.decimals)
            limit = info.limit * 10n ** BigInt(info.decimals)
            const openMinter = new OpenMinter(
                genesisOutpoint,
                max,
                premine,
                limit,
                keyInfo.xAddress
            )
            const openMinterTaproot = TaprootSmartContract.create(openMinter)
            const guardInfo = getGuardContractInfo()
            const token = new CAT20(
                openMinterTaproot.lockingScriptHex,
                guardInfo.lockingScriptHex
            )
            const tokenTaproot = TaprootSmartContract.create(token)
            const openMinterState = OpenMinterProto.create(
                tokenTaproot.lockingScriptHex,
                false,
                max - premine
            )
            const atIndex = revealCatTx.addStateContractOutput(
                openMinterTaproot.lockingScript,
                OpenMinterProto.toByteString(openMinterState)
            )
            const openMinterIns: ContractIns<OpenMinterState> = {
                catTx: revealCatTx,
                contract: openMinter,
                state: openMinterState,
                preCatTx: preCatTx,
                contractTaproot: openMinterTaproot,
                atOutputIndex: atIndex,
            }
            // mint tx (premine)
            const premineInfo = {
                // first mint amount equal premine
                // after mint amount need less than limit
                amount: premine,
                ownerAddr: hash160(keyInfo.pubkeyX),
            }
            const premineCallInfo = await openMinterCall(
                keyInfo,
                openMinterIns,
                premineInfo,
                max,
                premine,
                limit
            )
            // mint tx (after premine)
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const mintInfo = CAT20Proto.create(limit, keyInfo.xAddress)
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterState>
                await openMinterCall(
                    keyInfo,
                    nextOpenMinterIns,
                    mintInfo,
                    max,
                    premine,
                    limit
                )
            }
        })
    })

    describe('When minting an existed token', () => {
        let genesisTx: btc.Transaction
        let genesisUtxo: UTXO
        let genesisOutpoint: string
        let openMinter: OpenMinter
        let openMinterIns: ContractIns<OpenMinterState>
        let max: bigint
        let premine: bigint
        let limit: bigint
        let premineInfo: CAT20State
        let premineCallInfo
        const tokenScript =
            '5120c4043a44196c410dba2d7c9288869727227e8fcec717f73650c8ceadc90877cd'

        before(async () => {
            // dummy genesis
            const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
            genesisTx = dummyGenesis.genesisTx
            genesisUtxo = dummyGenesis.genesisUtxo
            genesisOutpoint = getOutpointString(genesisTx, 0)
            max = 10000n
            // 5% premine
            premine = (max * 5n) / 100n
            limit = 100n
            openMinter = new OpenMinter(
                genesisOutpoint,
                max,
                premine,
                limit,
                keyInfo.xAddress
            )
            const getTokenScript = async () => tokenScript
            openMinterIns = await openMinterDeploy(
                keyInfo.seckey,
                keyInfo.xAddress,
                genesisTx,
                genesisUtxo,
                openMinter,
                getTokenScript,
                max,
                premine,
                limit
            )
            premineInfo = {
                // first mint amount equal premine
                // after mint amount need less than limit
                amount: premine,
                ownerAddr: hash160(keyInfo.pubkeyX),
            }
            // premine pass
            premineCallInfo = await openMinterCall(
                keyInfo,
                openMinterIns,
                premineInfo,
                max,
                premine,
                limit
            )
        })

        it('should succeed in minting', async () => {
            // new minter mint pass
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const mintInfo = CAT20Proto.create(limit, keyInfo.xAddress)
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterState>
                await openMinterCall(
                    keyInfo,
                    nextOpenMinterIns,
                    mintInfo,
                    max,
                    premine,
                    limit
                )
            }
        })

        it('should fail when premine add remindingSupply not equal max', async () => {
            const max = 10000n
            // 5% premine
            const premine = (max * 5n) / 100n
            const limit = 100n
            const getTokenScript = async () => tokenScript
            const openMinterIns = await openMinterDeploy(
                keyInfo.seckey,
                keyInfo.xAddress,
                genesisTx,
                genesisUtxo,
                openMinter,
                getTokenScript,
                max,
                premine,
                limit,
                { wrongRemainingSupply: true }
            )
            const premineInfo = {
                // first mint amount equal premine
                // after mint amount need less than limit
                amount: premine,
                ownerAddr: hash160(keyInfo.pubkeyX),
            }
            await expect(
                openMinterCall(
                    keyInfo,
                    openMinterIns,
                    premineInfo,
                    max,
                    premine,
                    limit,
                    {
                        wrongRemainingSupply: true,
                    }
                )
            ).to.be.rejected
        })

        it('should fail when the minting amount exceeds the limit', async () => {
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const mintInfo = CAT20Proto.create(limit + 1n, keyInfo.xAddress)
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterState>
                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        mintInfo,
                        max,
                        premine,
                        limit
                    )
                ).to.be.rejected
            }
        })

        it('should fail when minting more than one token output', async () => {
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const mintInfo = CAT20Proto.create(limit + 1n, keyInfo.xAddress)
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterState>
                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        mintInfo,
                        max,
                        premine,
                        limit,
                        {
                            moreThanOneToken: true,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('should fail when subsequent minter outputs count exceeed the limit', async () => {
            for (
                let index = 0;
                index < premineCallInfo.nexts.length - 1;
                index++
            ) {
                const mintInfo = CAT20Proto.create(limit + 1n, keyInfo.xAddress)
                const nextOpenMinterIns = premineCallInfo.nexts[
                    index
                ] as ContractIns<OpenMinterState>
                await expect(
                    openMinterCall(
                        keyInfo,
                        nextOpenMinterIns,
                        mintInfo,
                        max,
                        premine,
                        limit,
                        {
                            minterExceeedLimit: true,
                        }
                    )
                ).to.be.rejected
            }
        })

        it('should fail when trying to premine more than once', async () => {
            // premine more than once
            await expect(
                openMinterCall(
                    keyInfo,
                    premineCallInfo.nexts[0],
                    premineInfo,
                    max,
                    premine,
                    limit
                )
            ).to.be.rejected
        })
    })
})
