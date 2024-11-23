#!/bin/bash

set -e

npx patch-package

cd ./node_modules/scryptlib

node ./postinstall.js