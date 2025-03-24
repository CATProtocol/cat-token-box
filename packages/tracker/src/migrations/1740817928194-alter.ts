import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alter1740817928194 implements MigrationInterface {
  name = 'Alter1740817928194';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tx" ADD COLUMN IF NOT EXISTS "tx_hash_preimage" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tx" DROP COLUMN "tx_hash_preimage"`);
  }
}
