import { getMetadataArgsStorage } from 'typeorm';
import { BPM_CORE_MIGRATIONS } from '../migrations';
import { OrgUnitEntity } from './org-unit.entity';

/**
 * The schema half of the org unit code contract.
 *
 * `assertOrgUnitCodeAvailable` ignores soft-deleted rows, so the database must
 * too. When it did not, deleting a unit consumed its code forever and the
 * recreate failed in the driver with a raw
 * `duplicate key value violates unique constraint "org_units_code_key"`,
 * naming a row no query could return. Nothing in the service layer can catch
 * that regression, so it is asserted here.
 */
describe('OrgUnitEntity code uniqueness', () => {
  it('does not declare a plain unique column on code', (): void => {
    const codeColumn = getMetadataArgsStorage().columns.find(
      (column): boolean =>
        column.target === OrgUnitEntity && column.propertyName === 'code',
    );

    expect(codeColumn).toBeDefined();
    expect(codeColumn?.options.unique).toBeFalsy();
  });

  it('declares the unique index only over rows that are not soft-deleted', (): void => {
    const index = getMetadataArgsStorage().indices.find(
      (candidate): boolean =>
        candidate.target === OrgUnitEntity &&
        candidate.name === 'org_units_code_active_key',
    );

    expect(index).toBeDefined();
    expect(index?.unique).toBe(true);
    expect(index?.columns).toEqual(['code']);
    expect(index?.where).toBe('"deleted_at" IS NULL');
  });

  it('ships the migration that brings an existing database to that shape', (): void => {
    const names = BPM_CORE_MIGRATIONS.map(
      (migration): string => migration.name,
    );

    expect(names).toContain('OrgUnitCodeActiveUnique0000000022000');
  });
});
