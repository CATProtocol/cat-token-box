# CAT Tracker

The tracker reads CAT token transactions from the blockchain, stores them in a database (`Postgres`) in a structured way, which can be quickly retrieved via RESTful APIs. The Swagger documentation for all the APIs can be found at http://127.0.0.1:3000 after running.

## Installation

```bash
yarn install
```

## Build

```sh
yarn build
```

## Before Run

The tracker needs a full node and Postgres. We use Fractal node as an example here.

Make sure you have `docker` installed, you can follow this [guide](https://docs.docker.com/engine/install/) to install it.

1. Update `.env` file with your own configuration.
2. Update directory permission

```bash
sudo chmod 777 docker/data
sudo chmod 777 docker/pgdata
```

3. Run `postgresql` and `bitcoind`:

```bash
docker compose up -d
```

## Run the tracker service

### Use `Docker` (Recommended)

1. Build docker image under the project root directory

```bash
cd ../../ && docker build -t tracker:latest .
```

2. Run the container

```bash
docker run -d \
    --name tracker \
    --add-host="host.docker.internal:host-gateway" \
    -e DATABASE_HOST="host.docker.internal" \
    -e RPC_HOST="host.docker.internal" \
    -p 3000:3000 \
    tracker:latest
```

3. Check tracker logs

```bash
docker logs -f tracker
```

### Use `yarn`

* development mode
```bash
yarn run start
```

* production mode
```bash
yarn run start:prod
```

> **Note:** Make sure the tracker syncs to the latest block before you run CLI over it. The sync-up progress can be found at http://127.0.0.1:3000/api after running.
