import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdentityOrganizationFoundation0000000001000 implements MigrationInterface {
  readonly name = 'IdentityOrganizationFoundation0000000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS member_metadata_cache (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        member_id text NOT NULL UNIQUE,
        metadata jsonb NOT NULL,
        fetched_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS org_units (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        parent_id uuid NULL REFERENCES org_units(id),
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        type text NOT NULL,
        path ltree NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        deleted_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_org_units_parent_id ON org_units(parent_id)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_org_units_path_gist ON org_units USING gist(path)',
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_units_not_deleted
      ON org_units(deleted_at)
      WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        level int NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memberships (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        member_id text NOT NULL,
        org_unit_id uuid NOT NULL REFERENCES org_units(id),
        position_id uuid NULL REFERENCES positions(id),
        is_primary boolean NOT NULL DEFAULT false,
        effective_from date NOT NULL,
        effective_to date NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_memberships_effective UNIQUE (
          member_id,
          org_unit_id,
          position_id,
          effective_from
        )
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_memberships_member_id ON memberships(member_id)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_memberships_org_unit_id ON memberships(org_unit_id)',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS manager_resolutions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        scope_type text NOT NULL,
        scope_id text NOT NULL,
        manager_member_id text NOT NULL,
        priority int NOT NULL DEFAULT 0,
        effective_from date NOT NULL,
        effective_to date NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_manager_resolutions_scope
      ON manager_resolutions(scope_type, scope_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS manager_resolutions');
    await queryRunner.query('DROP TABLE IF EXISTS memberships');
    await queryRunner.query('DROP TABLE IF EXISTS positions');
    await queryRunner.query('DROP TABLE IF EXISTS org_units');
    await queryRunner.query('DROP TABLE IF EXISTS member_metadata_cache');
  }
}
