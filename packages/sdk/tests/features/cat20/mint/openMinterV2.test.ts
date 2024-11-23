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
import { addrToP2trLockingScript, toTokenAddress } from '../../../../src/lib/utils'
import { Psbt } from 'bitcoinjs-lib'
import { CatPsbt } from '../../../../src/lib/catPsbt'
import { OpenMinterV2Covenant } from '../../../../src/covenants/openMinterV2Covenant'
import { OpenMinterV2Proto } from '../../../../src/contracts/token/openMinterV2Proto'
import { CAT20Covenant } from '../../../../src/covenants/cat20Covenant'
import { CAT20Proto } from '../../../../src/contracts/token/cat20Proto'
import { testSigner } from '../../../utils/testSigner'
import { deployToken, mintToken } from '../openMinterV2.utils'
import { TransferGuard } from '../../../../src/contracts/token/transferGuard'
import { BurnGuard } from '../../../../src/contracts/token/burnGuard'
import { Postage } from '../../../../src/lib/constants'
import { Cat20MinterUtxo } from '../../../../src/lib/provider'

use(chaiAsPromised)

describe('Test the feature `mint` for `openMinterV2Covenant`', () => {
  let address: string
  let tokenReceiverAddr: Ripemd160

  let tokenId: string
  let tokenAddr: string
  let minterAddr: string
  let metadata: OpenMinterCat20Meta

  let spentMinterTx: CatPsbt
  let spentMinterPreTx: Psbt

  before(async () => {
    await OpenMinterV2.loadArtifact()
    await CAT20.loadArtifact()
    await TransferGuard.loadArtifact()
    await BurnGuard.loadArtifact()
    address = await testSigner.getAddress()
    tokenReceiverAddr = toTokenAddress(address)
    metadata = {
      name: 'c',
      symbol: 'C',
      decimals: 2,
      max: 21000000n,
      limit: 1000n,
      premine: 3150000n,
      preminerAddr: tokenReceiverAddr,
      minterMd5: OpenMinterV2Covenant.LOCKED_ASM_VERSION,
    }

    const { genesisTx, revealTx, tokenId: deployedTokenId, tokenAddr: deployedTokenAddr, minterAddr: deployedMinterAddr } = await deployToken(metadata)
    tokenId = deployedTokenId
    tokenAddr = deployedTokenAddr
    spentMinterPreTx = genesisTx
    spentMinterTx = revealTx
    minterAddr = deployedMinterAddr
  })

  describe('When minting an existed token', () => {

    it('should mint the premined tokens successfully', async () => {

      const cat20MinterUtxo: Cat20MinterUtxo = {
        utxo: {
          txId: spentMinterTx.extractTransaction().getId(),
          outputIndex: 1,
          script: addrToP2trLockingScript(minterAddr),
          satoshis: Postage.MINTER_POSTAGE,
        },
        txoStateHashes: spentMinterTx.getTxStatesInfo().txoStateHashes,
        state:  OpenMinterV2Proto.create(
          addrToP2trLockingScript(tokenAddr),
          false,
          (metadata.max - metadata.premine) / metadata.limit,
        )
      }

      await testMintResult(
        cat20MinterUtxo,
        minterAddr,
        [8925n, 8925n],
        3150000n * 100n,
      )

    })

    it('should mint a new token successfully', async () => {
      // use the second minter in previous outputs
      const minterOutputIndex = 2


      const cat20MinterUtxo: Cat20MinterUtxo = {
        utxo: {
          txId: spentMinterTx.extractTransaction().getId(),
          outputIndex: minterOutputIndex,
          script: addrToP2trLockingScript(minterAddr),
          satoshis: Postage.MINTER_POSTAGE,
        },
        txoStateHashes: spentMinterTx.getTxStatesInfo().txoStateHashes,
        state:  OpenMinterV2Proto.create(
          addrToP2trLockingScript(tokenAddr),
          true,
          8925n,
        )
      }

      await testMintResult(
        cat20MinterUtxo,
        minterAddr,
        [4462n, 4462n],
        1000n * 100n,
      )

    })
  })

  async function testMintResult(
    cat20MinterUtxo: Cat20MinterUtxo,
    minterAddr: string,
    expectedNextMinterCounts: bigint[],
    expectedMintedAmount: bigint,
  ) {
    const { mintTx } = await mintToken(
      cat20MinterUtxo,
      tokenId,
      metadata,
    )

    expect(mintTx).to.not.be.null
    expect(mintTx.isFinalized).to.be.true

    // ensure the spentMinter is spent
    expect(verifyInputSpent(
      mintTx,
      0,
    )).to.be.true



    let outputIndex = 1
    for(let i = 0; i < expectedNextMinterCounts.length; i++) {
      // ensure a new minter is created
      const nextMinterOutputIndex = outputIndex++
      const nextMinter = new OpenMinterV2Covenant(
        tokenId,
        metadata,
        OpenMinterV2Proto.create(
          cat20MinterUtxo.state.tokenScript,
          true,
          expectedNextMinterCounts[i],
        )
      )
      expect(Buffer.from(mintTx.txOutputs[nextMinterOutputIndex].script).toString('hex')).to.eq(nextMinter.lockingScript.toHex())
      expect(mintTx.txState.stateHashList[nextMinterOutputIndex - 1], `incorrect minter state on outputs[${nextMinterOutputIndex}]`).eq(nextMinter.stateHash)
    }

    // ensure the minted token is sent to the receiver
    const tokenOutputIndex = outputIndex
    const mintedToken = new CAT20Covenant(
      minterAddr,
      CAT20Proto.create(
        expectedMintedAmount,
        tokenReceiverAddr
      )
    )
    expect(Buffer.from(mintTx.txOutputs[tokenOutputIndex].script).toString('hex')).to.eq(mintedToken.lockingScript.toHex())
    expect(mintTx.txState.stateHashList[tokenOutputIndex - 1]).eq(mintedToken.stateHash)

    // update the references
    spentMinterPreTx = spentMinterTx
    spentMinterTx = mintTx
  }

})

