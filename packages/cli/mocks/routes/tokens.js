module.exports = [
  {
    id: 'get-token-metadata', // id of the route
    url: '/api/tokens/:id', // url in path-to-regexp format
    method: 'GET', // HTTP method
    variants: [
      {
        id: 'openmint', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: {
              info: {
                name: 'NN',
                symbol: 'nn',
                decimals: 0,
                max: '21000000',
                premine: '0',
                limit: '1000',
                minterMd5: '795b08bf811020ef902af47dbdb9c0e3',
              },
              tokenId:
                'af9d6bc8baa9e5706702f29177a4ecaa4ada28c8f79ad8c2d89286e64808f7b6_0',
              tokenAddr:
                'bc1pmuhdn8syyx8e2jcqp2feaz6arq4k9klfd6dqnhhnydfhwyl6jgwskzmzxg',
              minterAddr:
                'bc1phc97jvsaedl5vtjl0meu9y6glx0wp5h708rvur84qppyfe3m6l4q44y0c9',
              genesisTxId:
                'af9d6bc8baa9e5706702f29177a4ecaa4ada28c8f79ad8c2d89286e64808f7b6',
              revealTxId:
                'a0fc8d896afd2072eebfd95736b696180f17f31f69e729661ecaa1b357d960a6',
              timestamp: 1724246662313,
            },
          }
        },
      },
      {
        id: 'closemint', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: {
              info: {
                name: 'gg',
                symbol: 'gg',
                decimals: 0,
                minterMd5: '5c7cb3a7962024e0acc7bbb5d22db213',
              },
              tokenId:
                'dfc641d015cbcea2b0294b0b09c66f968c9bbcc910930655af063a298a91e835_0',
              tokenAddr:
                'bc1ph548mhwuw8mx7rwx0r7hx6rdwh3jagycd7g96nf3lsfa3zvmperqzm45up',
              minterAddr:
                'bc1psc7gtx6c053d0vxfemcrcjgf3mr0ynaw3z62tnyy03j6sfma60lsq0gn28',
              genesisTxId:
                'dfc641d015cbcea2b0294b0b09c66f968c9bbcc910930655af063a298a91e835',
              revealTxId:
                '3850397cadc728126a661ef5dcb438407d84045f03cd6e1bd196c5429d4f821f',
              timestamp: 1724253895350,
            },
          }
        },
      },
    ],
  },
  {
    id: 'get-tokens', // id of the route
    url: '/api/tokens/:tokenId/addresses/:address/utxos', // url in path-to-regexp format
    method: 'GET', // HTTP method
    variants: [
      {
        id: 'closemint', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: '23ba445650db24bc91a4757b01b54b8891c93c5b3e8bbd824d2454ea19cabf98',
                outputIndex: 2,
                script:
                  '5120bd2a7ddddc71f66f0dc678fd73686d75e32ea0986f905d4d31fc13d8899b0e46',
                satoshis: 330,
              },
              state: {
                address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                amount: '1000',
              },
              txoStateHashes: [
                '9c64d73a0e691620b1112ff446dacd3e984fdad8',
                '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
      {
        id: 'closemint-01', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: [
              {
                utxo: {
                  txId: '0a2015a5f3a3c172b594062f0093f2407430c0502f82d7b30e1e8b3b19d9bedb',
                  outputIndex: 2,
                  script:
                    '51205e7eda027e46401527d8a2313419a3e3e98f133cafa8979f5c86618b732d3a6c',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1000',
                },
                txoStateHashes: [
                  'b39afb16aec343f230093ce433bdef5c883d67c2',
                  '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'e903d3d5deace096cef31ae77524ad493aa45ef00a9f6d046383b93a63528a2d',
                  outputIndex: 2,
                  script:
                    '51205e7eda027e46401527d8a2313419a3e3e98f133cafa8979f5c86618b732d3a6c',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1000',
                },
                txoStateHashes: [
                  'b39afb16aec343f230093ce433bdef5c883d67c2',
                  '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                  '',
                  '',
                  '',
                ],
              },
            ],
          },
        },
      },
      {
        id: 'closemint-02', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: 'eefe108f4bf521cbdde4aa636a4ef4fb3c34e3d93dcfa955a0df76497888b848',
                outputIndex: 2,
                script:
                  '512028157aa6a74d261bbe73256695c0b17069b70e84b38b5f092a3269f015d4226b',
                satoshis: 330,
              },
              state: {
                address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                amount: '10000',
              },
              txoStateHashes: [
                'a87a6b6d51197edb43f271eae03724083bc2ddf8',
                'aaaf4b0cc02970e3df9abcb5abd0935c6ce0f3d9',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
      {
        id: 'openmint', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: [
              {
                utxo: {
                  txId: '0a2015a5f3a3c172b594062f0093f2407430c0502f82d7b30e1e8b3b19d9bedb',
                  outputIndex: 2,
                  script:
                    '51205e7eda027e46401527d8a2313419a3e3e98f133cafa8979f5c86618b732d3a6c',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1000',
                },
                txoStateHashes: [
                  'b39afb16aec343f230093ce433bdef5c883d67c2',
                  '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: '7720627a26ac7c74d63563496abe2537c14e56d2f26e6c62d07083246f4c8c95',
                  outputIndex: 2,
                  script:
                    '5120e71e712c1b1c912660a5673d027b0ca2690810cb4c4ad88384349a9eadfddc72',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1000',
                },
                txoStateHashes: [
                  'fe37e24b66f19c1e8f1a86de193e4ef94d0e4f0f',
                  '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                  '',
                  '',
                  '',
                ],
              },
            ],
          },
        },
      },
      {
        id: 'openmint-01', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: 'b9e977a029c9dc2a7c6c1fdc92a18773c58d43b02630044912344f81bcf0c2fc',
                outputIndex: 1,
                script:
                  '5120ef470a8c24eed25e2d946ef7050de8498a5afe42eaeff0eb9b84d3aa90b28d1e',
                satoshis: 330,
              },
              state: {
                address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                amount: '100',
              },
              txoStateHashes: [
                '9b212fa8035d21c0b980fff8c7ee2f4ee5ae8831',
                '6e7778822305a0456d8eb958259d3124a79be1e5',
                '',
                '',
                '',
              ],
            },
            {
              utxo: {
                txId: 'b9e977a029c9dc2a7c6c1fdc92a18773c58d43b02630044912344f81bcf0c2fc',
                outputIndex: 2,
                script:
                  '5120ef470a8c24eed25e2d946ef7050de8498a5afe42eaeff0eb9b84d3aa90b28d1e',
                satoshis: 330,
              },
              state: {
                address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                amount: '900',
              },
              txoStateHashes: [
                '9b212fa8035d21c0b980fff8c7ee2f4ee5ae8831',
                '6e7778822305a0456d8eb958259d3124a79be1e5',
                '',
                '',
                '',
              ],
            },
            {
              utxo: {
                txId: '5727a1d25f8bdba24c07cc245c18d3e196dc411b143256963a2476431777f7a3',
                outputIndex: 2,
                script:
                  '5120ef470a8c24eed25e2d946ef7050de8498a5afe42eaeff0eb9b84d3aa90b28d1e',
                satoshis: 330,
              },
              state: {
                address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                amount: '1000',
              },
              txoStateHashes: [
                '8beb34daeed8aa04c8afb328dfda5ce6a417a79f',
                '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
      {
        id: 'merge', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: [
              {
                utxo: {
                  txId: '7068979e6f7fd10f5f1ac8525bc894583537e76f6825ba215f5c89469680dcf1',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'c0cf1ef0f0c3f5959242e93bb2026ee4fc361a83265e9ddc2ef9e9d557a68cc0',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: '494ee7c42350513ed48917b0689d7f65be999c51dc74bf8932162e76c1ed5e19',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'a71d24267ae6e5dfd0a1ece41fd6a89cc124df7eae96f4d299e2e7d4862df1c5',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'd607b0426731e5f25e65bb94adf17b94b16f2aff315c0c29700f29fb098e4461',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'db2890361042691fc6dff7ddd205610dc895ead51cee09700e33d84446644a41',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'cf1232888e149937299ccc4d2c51231ba9d7530aa734e2175b51f9d94887ee2f',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: 'f2535a9ecb0b412ec7562b5aebe6390846b25fd999836992fa1fc42eb038c407',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: '002d9b5d4d035e29facb641969185d0a55ec2683707cb983450399301a0bc440',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
              {
                utxo: {
                  txId: '98c2a982c92a859badec5754183213bf754d3c1cecb2118673ad7dc44968e5d2',
                  outputIndex: 2,
                  script:
                    '51205e2538902760bab49eda3dc6116da499bf836d65e5c7bbaaa49dc76c09dd2ef5',
                  satoshis: 330,
                },
                state: {
                  address: '1b346f07ab69e8dbe5b949249848fecaa029b551',
                  amount: '1',
                },
                txoStateHashes: [
                  '82425a6a578ad996884d15bd997d73bf84209b9c',
                  '32430fb8de99d841fd9a841290143a284fcb121a',
                  '',
                  '',
                  '',
                ],
              },
            ],
          },
        },
      },
    ],
  },
  {
    id: 'get-minters', // id of the route
    url: '/api/minters/:tokenId/utxos', // url in path-to-regexp format
    method: 'GET', // HTTP method
    variants: [
      {
        id: 'closemint', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: [
              {
                utxo: {
                  txId: '0a2015a5f3a3c172b594062f0093f2407430c0502f82d7b30e1e8b3b19d9bedb',
                  outputIndex: 1,
                  script:
                    '5120d00a183079cbb4f7577d7368395c998bbbcdb4145496ff7623f53d210c5a0f5b',
                  satoshis: 331,
                },
                state: {},
                txoStateHashes: [
                  'b39afb16aec343f230093ce433bdef5c883d67c2',
                  '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                  '',
                  '',
                  '',
                ],
              },
            ],
          },
        },
      },
      {
        id: 'closemint-01', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: '3f394222b81d96d433ca011c29c5973d19ba974f6016b7567ceb159aac15936d',
                outputIndex: 1,
                script:
                  '512015a6cb597f443929a9b67f36980a5c7338450bc2038aefc8dabdf0b9c80a7393',
                satoshis: 331,
              },
              state: {},
              txoStateHashes: [
                'a87a6b6d51197edb43f271eae03724083bc2ddf8',
                '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
      {
        id: 'closemint-02', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: '7238d3ae51b098c988503e21f36555abd3a86f16487df0a2c615857fb0b3ac45',
                outputIndex: 1,
                script:
                  '512015a6cb597f443929a9b67f36980a5c7338450bc2038aefc8dabdf0b9c80a7393',
                satoshis: 331,
              },
              state: {},
              txoStateHashes: [
                'a87a6b6d51197edb43f271eae03724083bc2ddf8',
                '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
      {
        id: 'openmint', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: [
              {
                utxo: {
                  txId: '7720627a26ac7c74d63563496abe2537c14e56d2f26e6c62d07083246f4c8c95',
                  outputIndex: 1,
                  script:
                    '5120da489d6402ad975f1116ae6099c277b61c413319c205e103b88f10d6c6da61a8',
                  satoshis: 331,
                },
                state: {},
                txoStateHashes: [
                  'fe37e24b66f19c1e8f1a86de193e4ef94d0e4f0f',
                  '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                  '',
                  '',
                  '',
                ],
              },
            ],
          },
        },
      },
      {
        id: 'openmint-01', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: 'd3b5f81a9edfa5793df411b00101ca87532363107d45d6b026fdf1c725743feb',
                outputIndex: 1,
                script:
                  '512089515ef4e5712505eb77c7b026889f1b0735add4d9abda71535cc70f8e30cc40',
                satoshis: 331,
              },
              state: {},
              txoStateHashes: [
                'c203e3d2bbe3704a164ac6a5d1103613a40fe078',
                '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
      {
        id: 'openmint-02', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: [
            {
              utxo: {
                txId: '98c479e9816c817104b829e8423b46c3f937fe62bc7e689559cecc625154bf2e',
                outputIndex: 1,
                script:
                  '512089515ef4e5712505eb77c7b026889f1b0735add4d9abda71535cc70f8e30cc40',
                satoshis: 331,
              },
              state: {},
              txoStateHashes: [
                'bcc98c7487743af897ae199b9605acec1d52ebb6',
                '8db816363b2a4bf7a58aa90efa6a5038437a4637',
                '',
                '',
                '',
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'get-balance', // id of the route
    url: '/api/tokens/:id/addresses/:address/balance', // url in path-to-regexp format
    method: 'GET', // HTTP method
    variants: [
      {
        id: 'success', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            tokenId: '6f4fea11dfd06bbf81e174670fd81ca9128925208886aae56e53d328279a6545_0',
            confirmed: '10000',
          },
        },
      },
    ],
  },
  {
    id: 'get-balance-all', // id of the route
    url: '/api/addresses/:address/balances', // url in path-to-regexp format
    method: 'GET', // HTTP method
    variants: [
      {
        id: 'success', // id of the variant
        type: 'json', // variant type
        options: {
          status: 200,
          body: {
            code: 0,
            data: [
              {
                tokenId: '6f4fea11dfd06bbf81e174670fd81ca9128925208886aae56e53d328279a6545_0',
                confirmed: '10000',
              },
              {
                tokenId: '9ed595ea6658f676492191362840b323b66b177d24797edc19215ae6ff95cd32_0',
                confirmed: '100010',
              },
            ],
          }
        },
      },
    ],
  },
];
