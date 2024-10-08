#!/bin/bash
yarn start:worker:prod &
yarn start:api:pro &
wait
