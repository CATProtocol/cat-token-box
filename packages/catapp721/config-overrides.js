
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const { buffer } = require('stream/consumers');
const webpack = require('webpack');
module.exports = function override(config, env) {

  config.resolve.fallback = {
    fs: false,
    path: false,
    net: false,
    tls: false,
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    assert: require.resolve('assert'),
    http: require.resolve('stream-http'),
    https: require.resolve('https-browserify'),
    os: require.resolve('os-browserify'),
    url: require.resolve('url')
  }

  const scopePluginIndex = config.resolve.plugins.findIndex(
    ({ constructor }) => constructor && constructor.name === 'ModuleScopePlugin'
  );

  config.resolve.plugins.splice(scopePluginIndex, 1);

  config.plugins.push(new NodePolyfillPlugin({
    excludeAliases: ['console']
  }))

  config.plugins.push(new webpack.ProvidePlugin({
    process: 'process/browser',
    Buffer: ['buffer', 'Buffer']
  }))

  console.log('config', config)
  return config;
}