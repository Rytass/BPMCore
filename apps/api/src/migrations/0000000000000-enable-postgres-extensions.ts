import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnablePostgresExtensions2026043000000 implements MigrationInterface {
  readonly name = 'EnablePostgresExtensions2026043000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "ltree"');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS "ltree"');
  }
}
