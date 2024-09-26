# CAT Tracker

The tracker reads CAT token transactions from the blockchain, stores them in Postgres in a structured way, which can be quickly retrieved via RESTful APIs. The Swagger documentation for all the APIs can be found at http://127.0.0.1:3000 after running.

## Installation

```bash
yarn install && yarn build
```

## Prerequisite

The tracker needs a full node and Postgres. We use Fractal node as an example here.

Make sure you have `docker` installed, or follow this [guide](https://docs.docker.com/engine/install/) to install it.

1. Update `.env` file with your own configuration.

2. Update directory permission to avoid `docker` doesn't have rights to write data.

```bash
sudo chmod o+w docker/data
```

3. Run `postgresql` and `bitcoind`.

```bash
docker compose up -d
```

## Migration

Run the following command to initialize database when run for the first time, or migrate data when upgrading from a previous version.

```bash
yarn migration:run
```

**Note: When upgrading tracker from a previous version, migrating the database may take a few hours. Make a [database backup](https://www.postgresql.org/docs/current/app-pgdump.html) before migration.**

## Run

The tracker consists of two modules:

- `worker`, reads CAT token transactions from the blockchain and stores them in a database.
- `api`, reads data from the database and serves the RESTful APIs.

To run the `worker` module:

```bash
# development
yarn start:worker

# production mode
yarn start:worker:prod
```

To run the `api` module:

```bash
# development
yarn start:api

# production mode
yarn start:api:prod
```

**Note:** Make sure the tracker syncs to the latest block before you run CLI over it. The sync-up progress can be found at http://127.0.0.1:3000/api after running.
