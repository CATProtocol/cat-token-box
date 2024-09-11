#!/bin/bash

while true; do
    response=$(curl -s https://mempool.fractalbitcoin.io/api/v1/fees/mempool-blocks)
    fastestFee=$(echo $response | jq '.[0].feeRange | .[-3]') # 倒数第三档
    echo $fastestFee

    # 如果没有获取到 fastestFee，默认给 100
    if [ -z "$fastestFee" ] || [ "$fastestFee" == "null" ]; then
        fastestFee=1200
    fi

    echo $fastestFee
    command="yarn cli mint -i 45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b_0 5 --fee-rate $fastestFee"
    $command

    if [ $? -ne 0 ]; then
        echo "命令执行失败，退出循环"
        exit 1
    fi

    sleep 1
done