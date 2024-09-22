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
  yarn cli mint -i c468e99ac3b533e503eac5ccf4f0e3362772f80cead8b7f71d802305d02f73d0_0 3 --fee-rate "$FEE_RATE"

  # Output the number of times the script has been run
  echo "This script has been run $RUN_COUNT times."

  # Optional: Sleep for a few seconds between runs (e.g., 5 seconds)
  # sleep 5
done