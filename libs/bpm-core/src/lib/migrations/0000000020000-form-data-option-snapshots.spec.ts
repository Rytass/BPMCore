import { QueryRunner } from 'typeorm';
import { FormDataOptionSnapshots0000000020000 } from './0000000020000-form-data-option-snapshots';

describe('FormDataOptionSnapshots0000000020000', () => {
  it('adds a defaulted non-null snapshot column', async (): Promise<void> => {
    const query = jest.fn(() => Promise.resolve());
    const migration = new FormDataOptionSnapshots0000000020000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ADD COLUMN IF NOT EXISTS "form_data_option_snapshot" jsonb NOT NULL DEFAULT \'{}\'::jsonb',
      ),
    );
  });

  it('removes the snapshot column on rollback', async (): Promise<void> => {
    const query = jest.fn(() => Promise.resolve());
    const migration = new FormDataOptionSnapshots0000000020000();

    await migration.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'DROP COLUMN IF EXISTS "form_data_option_snapshot"',
      ),
    );
  });
});
