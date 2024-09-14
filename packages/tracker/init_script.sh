#!/bin/bash

path=$(pwd)
ENV_FILE="$path/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo ".env file not found: $ENV_FILE"
  exit 1
fi

USER_HOME=$(grep -E '^USER_HOME=' "$ENV_FILE" | cut -d '=' -f 2)
DATABASE_VOLUME_PATH=$(grep -E '^DATABASE_VOLUME_PATH=' "$ENV_FILE" | cut -d '=' -f 2)
BITCOIND_DATA_DIR=$(grep -E '^BITCOIND_DATA_DIR=' "$ENV_FILE" | cut -d '=' -f 2)

NESTED_DIRS=("$USER_HOME/data/pgdata" "$USER_HOME/data/bitcoin")
for DIR in "${NESTED_DIRS[@]}"; do
  if [ -d "$DIR" ]; then
    echo "Checking directory: $DIR"
    if [ ! -w "$DIR" ]; then
      echo "Changing permissions: $DIR"
      sudo chmod -R 777 "$DIR"
    else
      echo "Permissions are correct: $DIR"
    fi
  else
    echo "Directory does not exist: $DIR"
    echo "Creating directory: $DIR"
    sudo mkdir -p "$DIR"
    sudo chmod -R 777 "$DIR"
  fi
done

echo "Check completed"

sudo cp docker/data/bitcoin.conf "${NESTED_DIRS[1]}"
echo "Starting services"

docker compose down

# Check if the network exists
if ! docker network ls | grep -q cat20_network; then
  echo "Creating network cat20_network"
  docker network create cat20_network
else
  echo "Network cat20_network already exists"
fi

docker compose up -d

cd ../../
echo "Building tracker service"
docker build -t tracker:latest .
echo "Starting tracker service"

if docker ps -a | grep -q tracker; then
  echo "Tracker service already exists, removing..."
  docker rm -f tracker
fi

docker run -d \
    --name tracker \
    --network cat20_network \
    --add-host="host.docker.internal:host-gateway" \
    -e DATABASE_HOST="host.docker.internal" \
    -e BITCOIND_RPC_HOST="bitcoind" \
    -p 3000:3000 \
    tracker:latest

echo "Tracker service started"