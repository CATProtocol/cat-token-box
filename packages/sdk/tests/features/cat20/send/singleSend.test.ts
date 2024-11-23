import * as dotenv from 'dotenv'
dotenv.config()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Ripemd160 } from 'scrypt-ts'
import { OpenMinterCat20Meta } from '../../../../src/lib/metadata'
import { OpenMinterV2 } from '../../../../src/contracts/token/openMinterV2'
import { verifyInputSpent } from '../../../utils/txHelper'
import { CAT20 } from '../../../../src/contracts/token/cat20'
import { CatPsbt } from '../../../../src/lib/catPsbt'
import { testSigner } from '../../../utils/testSigner'
import { TransferGuard } from '../../../../src/contracts/token/transferGuard'
import { BurnGuard } from '../../../../src/contracts/token/burnGuard'
import { deployToken,  mintToken, singleSendToken } from '../openMinterV2.utils'
import { CAT20Proto } from '../../../../src/contracts/token/cat20Proto'
import { CAT20Covenant } from '../../../../src/covenants/cat20Covenant'
import { int32 } from '../../../../src/contracts/utils/txUtil'
import { Cat20MinterUtxo, Cat20Utxo } from '../../../../src/lib/provider'
import { OpenMinterV2Covenant } from '../../../../src/covenants/openMinterV2Covenant'
import { addrToP2trLockingScript, toTokenAddress } from '../../../../src/lib/utils'
import { Postage } from '../../../../src/lib/constants'
import { OpenMinterV2Proto } from '../../../../src/contracts/token/openMinterV2Proto'

use(chaiAsPromised)

describe('Test the feature `send` for `Cat20Covenant`', () => {
  let address: string
  let pubkey: string
  let toReceiverAddr: Ripemd160
  let tokenChangeAddr: Ripemd160

  let tokenId: string
  let tokenAddr: string
  let minterAddr: string
  let metadata: OpenMinterCat20Meta

  let firstMintTx: CatPsbt
  let secondMintTx: CatPsbt

  before(async () => {
    await OpenMinterV2.loadArtifact()
    await CAT20.loadArtifact()
    await TransferGuard.loadArtifact()
    await BurnGuard.loadArtifact()
    address = await testSigner.getAddress()
    pubkey = await testSigner.getPublicKey()
    toReceiverAddr = toTokenAddress(address);
    tokenChangeAddr = toTokenAddress(address);

    metadata = {
      name: 'c',
      symbol: 'C',
      decimals: 2,
      max: 21000000n,
      limit: 1000n,
      premine: 3150000n,
      preminerAddr: toTokenAddress(address),
      minterMd5: OpenMinterV2Covenant.LOCKED_ASM_VERSION,
    }

    const {
      tokenId: deployedTokenId,
      tokenAddr: deployedTokenAddr,
      minterAddr: deployedMinterAddr,
      premineTx,
    } = await deployToken(metadata)

    tokenId = deployedTokenId
    tokenAddr = deployedTokenAddr
    minterAddr = deployedMinterAddr

    firstMintTx = premineTx!

    const cat20MinterUtxo: Cat20MinterUtxo = {
      utxo: {
        txId: premineTx!.extractTransaction().getId(),
        outputIndex: 1,
        script: addrToP2trLockingScript(minterAddr),
        satoshis: Postage.MINTER_POSTAGE,
      },
      txoStateHashes: premineTx!.getTxStatesInfo().txoStateHashes,
      state:  OpenMinterV2Proto.create(
        addrToP2trLockingScript(tokenAddr),
        true,
        8925n,
      )
    }

    const {
      mintTx,
    } = await mintToken(cat20MinterUtxo, tokenId, metadata)

    secondMintTx = mintTx
  })

  describe('When sending tokens in a single tx', () => {

    it('should send one token utxo successfully', async () => {
      const toReceiverAmount = 1000n * 10n ** BigInt(metadata.decimals)
      await testSendResult(
        [{
          utxo: firstMintTx.getUtxo(3),
          txoStateHashes: firstMintTx.txState.stateHashList,
          state: CAT20Proto.create(
            metadata.premine * 10n ** BigInt(metadata.decimals),
            toReceiverAddr,
          )
        }],
        toReceiverAmount,
        metadata.premine * 10n ** BigInt(metadata.decimals) - toReceiverAmount,
      )
    })

    it('should send multiple token utxos successfully', async () => {
      await testSendResult(
        [
          // first token utxo
          {
            utxo: firstMintTx.getUtxo(3),
            txoStateHashes: firstMintTx.txState.stateHashList,
            state: CAT20Proto.create(
              metadata.premine * 10n ** BigInt(metadata.decimals),
              toReceiverAddr,
            )
          },
          // second token utxo
          {
            utxo: secondMintTx.getUtxo(3),
            txoStateHashes: secondMintTx.txState.stateHashList,
            state: CAT20Proto.create(
              metadata.limit * 10n ** BigInt(metadata.decimals),
              toReceiverAddr,
            )
          }
        ],
        (metadata.premine + metadata.limit) * 10n ** BigInt(metadata.decimals),
      )
    })

  })

  async function testSendResult(
    cat20Utxos: Cat20Utxo[],
    toReceiverAmount: int32,
    tokenChangeAmount?: int32,
  ) {
    const {
      guardTx,
      sendTx,
    } = await singleSendToken(
      minterAddr,
      toReceiverAmount,
      cat20Utxos,
      toReceiverAddr,
    )

    // check guard tx
    expect(guardTx).not.to.be.undefined
    expect(guardTx.isFinalized).to.be.true
    
    // check send tx
    expect(sendTx).not.to.be.undefined
    expect(sendTx.isFinalized).to.be.true

    // verify token input unlock
    for (let i = 0; i < cat20Utxos.length; i++) {
      expect(verifyInputSpent(
        sendTx,
        i
      )).to.be.true
    }

    // verify guard input unlock
    expect(verifyInputSpent(
      sendTx,
      cat20Utxos.length
    )).to.be.true

    // verify token to receiver
    const toReceiverOutputIndex = 1
    const toReceiverToken = new CAT20Covenant(
      minterAddr,
      CAT20Proto.create(
        toReceiverAmount,
        toReceiverAddr,
      )
    )
    expect(Buffer.from(sendTx.txOutputs[toReceiverOutputIndex].script).toString('hex')).to.eq(toReceiverToken.lockingScript.toHex())
    expect(sendTx.txState.stateHashList[toReceiverOutputIndex - 1]).to.eq(toReceiverToken.stateHash)

    // verify token change
    if (tokenChangeAmount && tokenChangeAmount > 0) {
      const tokenChangeOutputIndex = 2
      const tokenChange = new CAT20Covenant(
        minterAddr,
        CAT20Proto.create(
          tokenChangeAmount,
          tokenChangeAddr,
        )
      )
      expect(Buffer.from(sendTx.txOutputs[tokenChangeOutputIndex].script).toString('hex')).to.eq(tokenChange.lockingScript.toHex())
      expect(sendTx.txState.stateHashList[tokenChangeOutputIndex - 1]).to.eq(tokenChange.stateHash)
    }

  }
})

