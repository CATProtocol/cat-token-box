import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alter1729444309666 implements MigrationInterface {
  name = 'Alter1729444309666';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "token_info" ADD COLUMN IF NOT EXISTS "content_type" character varying`);
    await queryRunner.query(`ALTER TABLE "token_info" ADD COLUMN IF NOT EXISTS "content_encoding" character varying`);
    await queryRunner.query(`ALTER TABLE "token_info" ADD COLUMN IF NOT EXISTS "content_raw" bytea`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "token_info" DROP COLUMN "content_raw"`);
    await queryRunner.query(`ALTER TABLE "token_info" DROP COLUMN "content_encoding"`);
    await queryRunner.query(`ALTER TABLE "token_info" DROP COLUMN "content_type"`);
  }
}
