import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alter1727073874554 implements MigrationInterface {
  name = 'Alter1727073874554';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tx" ADD COLUMN IF NOT EXISTS "state_hashes" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_info" ADD COLUMN IF NOT EXISTS "first_mint_height" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_f455b12fb529b81794dedb7fda" ON "tx_out" ("xonly_pubkey", "owner_pkh") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_4bb884940e61aa867fc229d5da" ON "tx_out" ("spend_txid", "spend_input_index") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_d5bf8259aef176088c980dfa41" ON "token_mint" ("owner_pkh") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_e89b422b5caff0c3aa27d95404" ON "token_mint" ("token_pubkey", "owner_pkh") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_899a44411763b33029cd4231cd" ON "token_info" ("first_mint_height") `,
    );

    // update tx.state_hashes from tx_out
    const before = Date.now();
    await Promise.all([
      this.updateTxStateHashes(queryRunner, 0, 10000),
      this.updateTxStateHashes(queryRunner, 10000, 20000),
      this.updateTxStateHashes(queryRunner, 20000, 30000),
      this.updateTxStateHashes(queryRunner, 30000, 40000),
      this.updateTxStateHashes(queryRunner, 40000),
    ]);
    console.log(`updateTxStateHashes ${Math.ceil(Date.now() - before)} ms`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_98f2d953553befed7ac91dcef6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b957c010e5dc41997dbe432b5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6cda73ea74baf9ce0a3e51db23"`,
    );
  }

  async updateTxStateHashes(
    queryRunner: QueryRunner,
    start: number,
    end?: number,
  ) {
    let where = `tx.block_height >= ${start}`;
    if (end !== undefined) {
      where += ` AND tx.block_height < ${end}`;
    }
    return queryRunner.query(`
      WITH concatenated_hashes AS (
          SELECT txid, STRING_AGG(state_hash, ';' ORDER BY output_index) AS concatenated_hashes
          FROM tx_out
          GROUP BY txid
      )
      -- Update the tx table for records
      UPDATE tx
      SET state_hashes = (
          SELECT concatenated_hashes
          FROM concatenated_hashes
          WHERE concatenated_hashes.txid = tx.txid
      ) WHERE ${where};`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_6cda73ea74baf9ce0a3e51db23" ON "token_mint" ("token_pubkey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b957c010e5dc41997dbe432b5b" ON "tx_out" ("spend_txid") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98f2d953553befed7ac91dcef6" ON "tx_out" ("xonly_pubkey") `,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_899a44411763b33029cd4231cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e89b422b5caff0c3aa27d95404"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5bf8259aef176088c980dfa41"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4bb884940e61aa867fc229d5da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f455b12fb529b81794dedb7fda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_info" DROP COLUMN "first_mint_height"`,
    );
    await queryRunner.query(`ALTER TABLE "tx" DROP COLUMN "state_hashes"`);
  }
}
