#!/bin/bash

# Set the path for the count file
COUNT_FILE="/tmp/mint_run_count.txt"

# Reset the count to zero at the start of the script
RUN_COUNT=0
echo "$RUN_COUNT" > "$COUNT_FILE"

# Check if fee-rate argument is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <fee-rate>"
  exit 1
fi

FEE_RATE=$1

# Infinite loop to repeat the mint command
while true; do
  # Increment the run count
  RUN_COUNT=$((RUN_COUNT + 1))

  # Save the new count back to the file (for record-keeping during execution)
  echo "$RUN_COUNT" > "$COUNT_FILE"

  # Run the yarn command with dynamic fee-rate
  yarn cli mint -i cc1b4c7e844c8a7163e0fccb79a9ade20b0793a2e86647825b7c05e8002b9f6a_0 20 --fee-rate "$FEE_RATE"

  # Output the number of times the script has been run
  echo "This script has been run $RUN_COUNT times."

  # Optional: Sleep for a few seconds between runs (e.g., 5 seconds)
  # sleep 5
done