import { MigrationInterface, QueryRunner } from 'typeorm';

export class DelegationRules0000000005000 implements MigrationInterface {
  name = 'DelegationRules0000000005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "delegation_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "principal_member_id" text NOT NULL,
        "agent_member_id" text NOT NULL,
        "scope_type" text NOT NULL,
        "scope_template_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
        "scope_condition_cel" text,
        "priority" integer NOT NULL DEFAULT 100,
        "start_at" timestamptz NOT NULL,
        "end_at" timestamptz,
        "requires_confirmation" boolean NOT NULL DEFAULT false,
        "status" text NOT NULL,
        "created_by_member_id" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz,
        "revoked_by_member_id" text,
        CONSTRAINT "PK_delegation_rules_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delegation_rules_principal_status"
      ON "delegation_rules" ("principal_member_id", "status", "start_at", "end_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_delegation_rules_agent"
      ON "delegation_rules" ("agent_member_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_delegation_rules_agent"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_delegation_rules_principal_status"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "delegation_rules"');
  }
}
