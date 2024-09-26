import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1727071643783 implements MigrationInterface {
  name = 'Init1727071643783';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "tx_out" ("txid" character varying(64) NOT NULL, "output_index" integer NOT NULL, "block_height" integer NOT NULL, "satoshis" bigint NOT NULL, "locking_script" character varying NOT NULL, "xonly_pubkey" character varying, "owner_pkh" character varying, "token_amount" bigint, "state_hash" character varying, "spend_txid" character varying, "spend_input_index" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "update_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bf339c207c55632c1b44cb4dcce" PRIMARY KEY ("txid", "output_index"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_842a85dd927879c12574bc8c23" ON "tx_out" ("block_height") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_98f2d953553befed7ac91dcef6" ON "tx_out" ("xonly_pubkey") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_86da4cbf17aa7cdc2ae2e1fc9b" ON "tx_out" ("owner_pkh") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_b957c010e5dc41997dbe432b5b" ON "tx_out" ("spend_txid") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "tx" ("txid" character varying(64) NOT NULL, "block_height" integer NOT NULL, "tx_index" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e5bf84e0e897ce668b82ca3f833" PRIMARY KEY ("txid"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_dda1249bcfce884c26070b1f96" ON "tx" ("block_height") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "token_mint" ("txid" character varying(64) NOT NULL, "token_pubkey" character varying(64) NOT NULL, "owner_pkh" character varying NOT NULL, "token_amount" bigint NOT NULL, "block_height" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_21865bb90d676d5e24693eccf55" PRIMARY KEY ("txid"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_6cda73ea74baf9ce0a3e51db23" ON "token_mint" ("token_pubkey") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_630181ee96ff88d9341cebdaae" ON "token_mint" ("block_height") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "token_info" ("token_id" character varying NOT NULL, "reveal_txid" character varying NOT NULL, "reveal_height" integer NOT NULL, "genesis_txid" character varying NOT NULL, "name" character varying NOT NULL, "symbol" character varying NOT NULL, "decimals" integer NOT NULL, "raw_info" jsonb NOT NULL, "minter_pubkey" character varying(64) NOT NULL, "token_pubkey" character varying(64), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_84c0d8366cd8317811709c9e3f4" PRIMARY KEY ("token_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_530dcb59ea83d11c640dd31d99" ON "token_info" ("reveal_txid") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c22e5423743e6c29055aee529b" ON "token_info" ("genesis_txid") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_7bed7ff4597424517e6199af07" ON "token_info" ("minter_pubkey") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_1f0d5f053ec979babce24f626b" ON "token_info" ("token_pubkey") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "block" ("hash" character varying(64) NOT NULL, "height" integer NOT NULL, "n_tx" integer NOT NULL DEFAULT '0', "time" integer NOT NULL, "previous_hash" character varying(64), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f8fba63d7965bfee9f304c487aa" PRIMARY KEY ("hash"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bce676e2b005104ccb768495db" ON "block" ("height") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bce676e2b005104ccb768495db"`,
    );
    await queryRunner.query(`DROP TABLE "block"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1f0d5f053ec979babce24f626b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7bed7ff4597424517e6199af07"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c22e5423743e6c29055aee529b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_530dcb59ea83d11c640dd31d99"`,
    );
    await queryRunner.query(`DROP TABLE "token_info"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_630181ee96ff88d9341cebdaae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6cda73ea74baf9ce0a3e51db23"`,
    );
    await queryRunner.query(`DROP TABLE "token_mint"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dda1249bcfce884c26070b1f96"`,
    );
    await queryRunner.query(`DROP TABLE "tx"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b957c010e5dc41997dbe432b5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86da4cbf17aa7cdc2ae2e1fc9b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98f2d953553befed7ac91dcef6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_842a85dd927879c12574bc8c23"`,
    );
    await queryRunner.query(`DROP TABLE "tx_out"`);
  }
}
