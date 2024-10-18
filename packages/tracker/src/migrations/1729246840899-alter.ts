import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alter1729246840899 implements MigrationInterface {
  name = 'Alter1729246840899';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "nft_info" ("collection_id" character varying NOT NULL, "local_id" bigint NOT NULL, "mint_txid" character varying(64) NOT NULL, "mint_height" integer NOT NULL, "commit_txid" character varying(64) NOT NULL, "metadata" jsonb, "content_type" character varying, "content_encoding" character varying, "content_raw" bytea, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e1eaf4029498024bfc744325bb8" PRIMARY KEY ("collection_id", "local_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_43f2d6d3ac593d8a883d14d3a9" ON "nft_info" ("mint_txid") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_d7adb9bb7a79091f94373b43e9" ON "nft_info" ("mint_height") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7adb9bb7a79091f94373b43e9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43f2d6d3ac593d8a883d14d3a9"`,
    );
    await queryRunner.query(`DROP TABLE "nft_info"`);
  }
}
