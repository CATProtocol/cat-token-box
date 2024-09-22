#!/bin/bash

set -e

cp ./scripts/bn.js.pkg.json ./node_modules/bn.js/package.json

cd ./node_modules/scryptlib

node ./postinstall.js