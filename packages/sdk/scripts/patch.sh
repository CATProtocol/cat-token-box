#!/bin/bash

set -e

if [ ! -e .npmignore ]; then
    cd ..
    cd ..
    cd ..
    npx patch-package --patch-dir=./node_modules/@cat-protocol/cat-sdk/patches
fi
