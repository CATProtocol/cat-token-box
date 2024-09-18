#!/bin/bash

# Set the path for the count file
COUNT_FILE="/tmp/mint_run_count.txt"

# Initialize the count if the file does not exist
if [ ! -f "$COUNT_FILE" ]; then
  echo 0 > "$COUNT_FILE"
fi

# Read the current count from the file
RUN_COUNT=$(cat "$COUNT_FILE")

# Increment the run count
RUN_COUNT=$((RUN_COUNT + 1))

# Save the new count back to the file
echo "$RUN_COUNT" > "$COUNT_FILE"

# Check if fee-rate argument is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <fee-rate>"
  exit 1
fi

FEE_RATE=$1

# Run the yarn command with dynamic fee-rate
yarn cli mint -i cc1b4c7e844c8a7163e0fccb79a9ade20b0793a2e86647825b7c05e8002b9f6a_0 20 --fee-rate "$FEE_RATE"

# Output the number of times the script has been run
echo "This script has been run $RUN_COUNT times."