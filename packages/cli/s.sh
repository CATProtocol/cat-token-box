#!/bin/bash

log_file="mint_log.txt"
success_count=0

# 初始化日志文件
echo "Minting Script Started at $(date)" | tee -a $log_file

while true; do
    feeRate=$(curl -s 'https://explorer.unisat.io/fractal-mainnet/api/bitcoin-info/fee' | jq -r '.data.fastestFee')

    if [ "$feeRate" -gt 4000 ]; then
        echo "费率超过 3300,跳过当前循环" | tee -a $log_file
        sleep 1
        continue
    fi
    if [ "$feeRate" -gt 3500 ]; then
        feeRate=3300
    fi
	
	echo "正在使用当前 $feeRate 费率进行 Mint" | tee -a $log_file
    command="yarn cli mint -i cc1b4c7e844c8a7163e0fccb79a9ade20b0793a2e86647825b7c05e8002b9f6a_0 20 --fee-rate $feeRate"

    $command
    command_status=$?

    if [ $command_status -ne 0 ]; then
        echo "命令执行失败，退出循环" | tee -a $log_file
        exit 1
    else
        success_count=$((success_count + 1))
        echo "成功mint了 $success_count 次" | tee -a $log_file
    fi

    sleep 1
done
