import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnablePostgresExtensions0000000000001 implements MigrationInterface {
  readonly name = 'EnablePostgresExtensions0000000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "ltree"');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS "ltree"');
  }
}
