import type { QueryRunner } from 'typeorm';

export async function ensureApiTestMemberTable(
  queryRunner: QueryRunner,
): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE IF NOT EXISTS api_test_members (
      member_id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      roles jsonb NOT NULL DEFAULT '[]'::jsonb,
      permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
      custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await queryRunner.query(`
    CREATE INDEX IF NOT EXISTS idx_api_test_members_email_lower
    ON api_test_members (lower(email))
  `);
}
