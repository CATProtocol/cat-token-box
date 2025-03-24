import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alter1730693484057 implements MigrationInterface {
  name = 'Alter1730693484057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_64dc10ae35b0b320fe29fe37c5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_41eccc4d16ad59f7d60e3ffffd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7c34e770bfd147b45f053ae328"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_016aa4b4d86115beff7679b908"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_016aa4b4d86115beff7679b908" ON "tx_out_archive" ("spend_txid", "spend_input_index") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c34e770bfd147b45f053ae328" ON "tx_out_archive" ("xonly_pubkey", "owner_pkh") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_41eccc4d16ad59f7d60e3ffffd" ON "tx_out_archive" ("owner_pkh") `);
    await queryRunner.query(`CREATE INDEX "IDX_64dc10ae35b0b320fe29fe37c5" ON "tx_out_archive" ("block_height") `);
  }
}
