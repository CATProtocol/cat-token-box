
// import * as bip39 from 'bip39';

const express = require('express');
// import { ConfigService, WalletService } from './packages/cli/src/providers';
// const axios = ç

const app = express();

const port = 3000;

// import { ConfigService, WalletService } from 'src/providers';
// import { randomBytes } from 'crypto';

// import { logerror, Wallet } from 'src/common';

// const Wallet = require('packages/cli/src/wallet');
// import {ConfigService, WalletService} from './packages/cli/dist/providers/'

// const bip39 = require('bip39');

// const walletService = require('./packages/cli/dist/providers/');


const walletService = require('./packages/cli/dist/providers/walletService');
const configService = require('./packages/cli/dist/providers/configService');

const walletHD = {
    accountPath: "m/86'/0'/0'/0/0",
     name:"AVF",
    mnemonic: "aaa",
};

console.log("walletService 11 " , WalletService)
console.log("ConfigService 22 " , ConfigService)
console.log("walletHD 33 " , walletHD)

app.use(express.json());

// Start the server
app.listen(port, () => {  
    console.log(`Server is running on port ${port}`);
  });
  

app.get('/hello', (req, res) => {
  res.status(200).json({ message: "hello" });

});

app.get('/healthz', async (req, res) => {
    res.status(200).json({ status: "OK" });
  });
  

app.get('/create-wallet', (req, res) => {

    try {
      
      console.log("1111")
        const aa = new WalletService(new ConfigService());
        console.log("aa ", aa)

        const walletFile = aa.foundWallet();
        if (walletFile !== null) {
          console.log(`found an existing wallet: ${walletFile}`, new Error());
          // return;
        }
  
        // const name = options.name
        //   ? options.name
        //   : `cat-${randomBytes(4).toString('hex')}`;
  
        // const wallet: Wallet = {
        //   accountPath: "m/86'/0'/0'/0/0",
        //   name: name,
        //   mnemonic: bip39.generateMnemonic(),
        // };
  
        // this.walletService.createWallet(wallet);
  
        // console.log('Your wallet mnemonic is: ', wallet.mnemonic);
  
        // console.log('exporting address to the RPC node ... ');
  
        // const success = await WalletService.importWallet(true);
        // if (success) {
        //   console.log('successfully.');
        // }
      } catch (error) {
        // logerror('Create wallet failed!', error);
        console.log(error)
      }
    
    res.status(200).json({ message: "hello" });
  
  });