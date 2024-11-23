import * as dotenv from 'dotenv'
dotenv.config()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { OpenMinterCat20Meta } from '../../../../src/lib/metadata'
import { OpenMinterV2 } from '../../../../src/contracts/token/openMinterV2'
import { verifyInputSpent } from '../../../utils/txHelper'
import { CAT20 } from '../../../../src/contracts/token/cat20'
import {  deployToken } from '../openMinterV2.utils'
import { testSigner } from '../../../utils/testSigner'
import { TransferGuard } from '../../../../src/contracts/token/transferGuard'
import { BurnGuard } from '../../../../src/contracts/token/burnGuard'
import { CAT20Covenant } from '../../../../src/covenants/cat20Covenant'
import { CAT20Proto } from '../../../../src/contracts/token/cat20Proto'
import { hash160 } from 'scrypt-ts'
import { OpenMinterV2Covenant } from '../../../../src/covenants/openMinterV2Covenant'
import { toTokenAddress } from '../../../../src/lib/utils'

use(chaiAsPromised)

describe('Test the feature `deploy` for `openMinterV2Covenant`', () => {

  let metadata: OpenMinterCat20Meta

  before(async () => {
    await OpenMinterV2.loadArtifact()
    await CAT20.loadArtifact()
    await TransferGuard.loadArtifact()
    await BurnGuard.loadArtifact()
    const address = await testSigner.getAddress()
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

  })

  describe('When deploying a new token', () => {
    it('should build and sign the genesis and reveal txns successfully', async () => {

      const { genesisTx, revealTx } = await deployToken(metadata)

      // test genesis(commit) tx
      expect(genesisTx).to.not.be.null
      expect(verifyInputSpent(
        genesisTx,
        0,
      )).to.be.true

      // test reveal tx
      expect(revealTx).to.not.be.null
      expect(revealTx.isFinalized).to.be.true
      expect(verifyInputSpent(
        revealTx,
        0,
      )).to.be.true
      expect(verifyInputSpent(
        revealTx,
        1,
      )).to.be.true

    })

    it('shoud premine the token if applicable', async () => {
      const { premineTx, minterAddr } = await deployToken(metadata)

      expect(premineTx).to.not.be.null
      expect(premineTx!.isFinalized).to.be.true
      expect(verifyInputSpent(
        premineTx!,
        0,
      )).to.be.true

      const mintedToken = new CAT20Covenant(
        minterAddr,
        CAT20Proto.create(
          metadata.premine * (10n ** BigInt(metadata.decimals)),
          metadata.preminerAddr!
        )
      )

      // console.log('states', premineTx!.txState, mintedToken.state, mintedToken.serializedState(), mintedToken.stateHash)

      const tokenOutputIndex = 3
      // ensure it has the minted token output
      expect(Buffer.from(premineTx!.txOutputs[tokenOutputIndex].script).toString('hex')).to.eq(mintedToken.lockingScript.toHex())
      // ensure the state hash is correct
      expect(premineTx!.txState.stateHashList[tokenOutputIndex - 1]).eq(mintedToken.stateHash)

    })
  })

})

