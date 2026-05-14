import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveAttachmentEncryptionKey0000000011000 implements MigrationInterface {
  name = 'RemoveAttachmentEncryptionKey0000000011000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "attachments"
      DROP COLUMN IF EXISTS "encryption_key_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "attachments"
      ADD COLUMN IF NOT EXISTS "encryption_key_id" text NULL
    `);
  }
}
