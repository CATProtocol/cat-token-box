import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alter1727348571285 implements MigrationInterface {
  name = 'Alter1727348571285';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tx_out_archive" ("txid" character varying(64) NOT NULL, "output_index" integer NOT NULL, "block_height" integer NOT NULL, "satoshis" bigint NOT NULL, "locking_script" character varying NOT NULL, "xonly_pubkey" character varying, "owner_pkh" character varying, "token_amount" bigint, "spend_txid" character varying, "spend_input_index" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_80e1532f0cc61b9408923c710d3" PRIMARY KEY ("txid", "output_index"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_64dc10ae35b0b320fe29fe37c5" ON "tx_out_archive" ("block_height") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41eccc4d16ad59f7d60e3ffffd" ON "tx_out_archive" ("owner_pkh") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c34e770bfd147b45f053ae328" ON "tx_out_archive" ("xonly_pubkey", "owner_pkh") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_016aa4b4d86115beff7679b908" ON "tx_out_archive" ("spend_txid", "spend_input_index") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_016aa4b4d86115beff7679b908"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c34e770bfd147b45f053ae328"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41eccc4d16ad59f7d60e3ffffd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_64dc10ae35b0b320fe29fe37c5"`,
    );
    await queryRunner.query(`DROP TABLE "tx_out_archive"`);
  }
}
