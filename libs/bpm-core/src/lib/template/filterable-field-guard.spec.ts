import { BadRequestException, ConflictException } from '@nestjs/common';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { EntityManager } from 'typeorm';
import {
  assertTemplateFilterableFieldsEnabled,
  readFilterableFieldSchemaFromJson,
  readFormDefinitionFilterableFieldIssues,
  readTemplateFilterableFieldIssues,
} from './filterable-field-guard';

interface FakeInstance {
  readonly id: string;
  readonly formData: Readonly<Record<string, unknown>>;
}

interface FakeHistory {
  readonly id: string;
  readonly versionNumber: number;
  readonly schema: FormDefinitionSchema;
}

interface FakeData {
  readonly formDefinitionTemplates?: readonly string[];
  readonly history?: readonly FakeHistory[];
  readonly instances?: readonly FakeInstance[];
  readonly templateName?: string;
}

/**
 * A manager whose `query` answers by the SQL's shape, the way the database
 * would: the instance query returns only the keys it was asked for, and a key
 * the instance lacks is left out (`jsonb_object_agg` over nothing gives NULL).
 */
function createFakeManager(data: FakeData): {
  readonly manager: EntityManager;
  readonly query: jest.Mock;
} {
  const query = jest.fn(
    (sql: string, params: readonly unknown[]): Promise<readonly unknown[]> => {
      if (sql.includes('jsonb_object_agg')) {
        const keys = params[1] as readonly string[];

        return Promise.resolve(
          (data.instances ?? []).map((instance) => {
            const picked = keys.filter((key) =>
              Object.prototype.hasOwnProperty.call(instance.formData, key),
            );

            return {
              form_data:
                picked.length === 0
                  ? null
                  : Object.fromEntries(
                      picked.map((key) => [key, instance.formData[key]]),
                    ),
              id: instance.id,
            };
          }),
        );
      }

      if (sql.includes('"versionNumber", fv.schema')) {
        return Promise.resolve(data.history ?? []);
      }

      if (sql.includes('fv.form_definition_id')) {
        return Promise.resolve(
          (data.formDefinitionTemplates ?? []).map((templateId) => ({
            templateId,
          })),
        );
      }

      if (sql.includes('FROM approval_templates WHERE id')) {
        return Promise.resolve([{ name: data.templateName ?? '' }]);
      }

      return Promise.reject(new Error(`unexpected SQL: ${sql}`));
    },
  );

  return {
    manager: { query } as unknown as EntityManager,
    query,
  };
}

function schemaOf(fields: readonly Record<string, unknown>[]): FormDefinitionSchema {
  return {
    fields,
    schemaVersion: 1,
  } as unknown as FormDefinitionSchema;
}

const TEXT_NOTE_V1 = schemaOf([
  { fieldKey: 'note', label: '備註', required: false, type: 'text' },
]);

const MONEY_NOTE_V2 = schemaOf([
  {
    fieldKey: 'note',
    filterable: true,
    label: '備註',
    required: false,
    type: 'money',
  },
]);

describe('filterable field guard (ADR 25 §5.4)', () => {
  it('reads nothing when the schema has no filterable field', async (): Promise<void> => {
    const { manager, query } = createFakeManager({
      history: [{ id: 'fv-1', schema: TEXT_NOTE_V1, versionNumber: 1 }],
      instances: [{ formData: { note: 'abc' }, id: 'i-1' }],
    });

    await expect(
      readTemplateFilterableFieldIssues(manager, 'template-1', TEXT_NOTE_V1),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a type change against a version that still has instances', async (): Promise<void> => {
    const { manager } = createFakeManager({
      history: [{ id: 'fv-1', schema: TEXT_NOTE_V1, versionNumber: 1 }],
      instances: [{ formData: { note: 'abc' }, id: 'i-1' }],
      templateName: '請款簽核',
    });

    const reports = await readTemplateFilterableFieldIssues(
      manager,
      'template-1',
      MONEY_NOTE_V2,
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(
      expect.objectContaining({
        templateId: 'template-1',
        templateName: '請款簽核',
      }),
    );
    expect(reports[0].issue).toEqual({
      conflicts: [{ type: 'text', versionNumber: 1 }],
      kind: 'TYPE_CHANGED',
      label: '備註',
      path: 'note',
      type: 'money',
    });
  });

  it('fetches only the filterable keys, never the whole form_data', async (): Promise<void> => {
    const { manager, query } = createFakeManager({
      instances: [
        { formData: { note: 'abc', secret: 'do-not-read' }, id: 'i-1' },
      ],
    });

    await readTemplateFilterableFieldIssues(manager, 'template-1', MONEY_NOTE_V2);

    const instanceCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('jsonb_object_agg'),
    );

    expect(instanceCall?.[1]).toEqual(['template-1', ['note']]);
  });

  it('counts instances whose stored value does not fit the type, and samples them', async (): Promise<void> => {
    const { manager } = createFakeManager({
      instances: [
        { formData: { amount: 'abc' }, id: 'i-1' },
        { formData: { amount: '' }, id: 'i-2' },
        { formData: {}, id: 'i-3' },
        { formData: { amount: '11/3' }, id: 'i-4' },
      ],
    });
    const schema = schemaOf([
      {
        fieldKey: 'amount',
        filterable: true,
        label: '金額',
        required: false,
        type: 'money',
      },
    ]);

    const [report] = await readTemplateFilterableFieldIssues(
      manager,
      'template-1',
      schema,
    );

    expect(report.issue.kind).toBe('INVALID_VALUES');
    expect(report.issue).toEqual(
      expect.objectContaining({
        invalidInstanceCount: 2,
        path: 'amount',
      }),
    );
    expect(
      report.issue.kind === 'INVALID_VALUES'
        ? report.issue.samples.map((sample) => sample.instanceId)
        : [],
    ).toEqual(['i-1', 'i-4']);
  });

  it('checks a table column through its whole table key, row by row', async (): Promise<void> => {
    const { manager, query } = createFakeManager({
      instances: [
        {
          formData: { items: [{ price: 'x' }, { price: 10 }] },
          id: 'i-1',
        },
      ],
    });
    const schema = schemaOf([
      {
        columns: [
          {
            fieldKey: 'price',
            filterable: true,
            label: '單價',
            required: false,
            type: 'money',
          },
        ],
        fieldKey: 'items',
        label: '明細',
        required: false,
        type: 'table',
      },
    ]);

    const [report] = await readTemplateFilterableFieldIssues(
      manager,
      'template-1',
      schema,
    );

    expect(report.issue).toEqual(
      expect.objectContaining({
        invalidInstanceCount: 1,
        kind: 'INVALID_VALUES',
        path: 'items.price',
      }),
    );
    const instanceCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('jsonb_object_agg'),
    );

    expect(instanceCall?.[1]).toEqual(['template-1', ['items']]);
  });

  it('lets null, empty strings and missing values through', async (): Promise<void> => {
    const { manager, query } = createFakeManager({
      instances: [
        { formData: { amount: null }, id: 'i-1' },
        { formData: { amount: '' }, id: 'i-2' },
        { formData: {}, id: 'i-3' },
      ],
    });
    const schema = schemaOf([
      {
        fieldKey: 'amount',
        filterable: true,
        label: '金額',
        required: false,
        type: 'money',
      },
    ]);

    await expect(
      readTemplateFilterableFieldIssues(manager, 'template-1', schema),
    ).resolves.toEqual([]);
    // Clean data must not add a name lookup either.
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('FROM approval_templates WHERE id'),
      ),
    ).toBe(false);
  });

  it('lets a new key through even when the old key holds dirty values', async (): Promise<void> => {
    const { manager } = createFakeManager({
      history: [{ id: 'fv-1', schema: TEXT_NOTE_V1, versionNumber: 1 }],
      instances: [{ formData: { note: 'abc' }, id: 'i-1' }],
    });
    const schema = schemaOf([
      {
        fieldKey: 'amountTwd',
        filterable: true,
        label: '金額',
        required: false,
        type: 'money',
      },
    ]);

    await expect(
      readTemplateFilterableFieldIssues(manager, 'template-1', schema),
    ).resolves.toEqual([]);
  });

  it('throws one conflict line per issue when asserting', async (): Promise<void> => {
    const { manager } = createFakeManager({
      history: [{ id: 'fv-1', schema: TEXT_NOTE_V1, versionNumber: 1 }],
      instances: [{ formData: { amount: 'xyz', note: 'abc' }, id: 'i-1' }],
    });
    const schema = schemaOf([
      {
        fieldKey: 'note',
        filterable: true,
        label: '備註',
        required: false,
        type: 'money',
      },
      {
        fieldKey: 'amount',
        filterable: true,
        label: '金額',
        required: false,
        type: 'money',
      },
    ]);

    await expect(
      assertTemplateFilterableFieldsEnabled(manager, 'template-1', schema),
    ).rejects.toThrow(ConflictException);
    await expect(
      assertTemplateFilterableFieldsEnabled(manager, 'template-1', schema),
    ).rejects.toThrow(/無法啟用篩選/u);

    const error: unknown = await assertTemplateFilterableFieldsEnabled(
      manager,
      'template-1',
      schema,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message.split('\n')).toHaveLength(2);
  });

  it('resolves when the schema is safe to enable', async (): Promise<void> => {
    const { manager } = createFakeManager({
      instances: [{ formData: { amount: 5 }, id: 'i-1' }],
    });
    const schema = schemaOf([
      {
        fieldKey: 'amount',
        filterable: true,
        label: '金額',
        required: false,
        type: 'money',
      },
    ]);

    await expect(
      assertTemplateFilterableFieldsEnabled(manager, 'template-1', schema),
    ).resolves.toBeUndefined();
  });

  describe('against the in-force schema (ADR 25 §15)', () => {
    const MONEY_AMOUNT = {
      fieldKey: 'amount',
      filterable: true,
      label: '金額',
      required: false,
      type: 'money',
    };
    const TEXT_VENDOR = {
      fieldKey: 'vendor',
      filterable: true,
      label: '廠商',
      required: false,
      type: 'text',
    };

    it('reads no instance when the publish makes nothing newly filterable', async (): Promise<void> => {
      // The stored value is dirty, but the field was already filterable with
      // this type: the guard at enable time and on every write keeps it clean,
      // so a publish that enables nothing new has nothing to scan.
      const { manager, query } = createFakeManager({
        instances: [{ formData: { amount: 'abc' }, id: 'i-1' }],
      });
      const inForce = schemaOf([MONEY_AMOUNT]);
      const next = schemaOf([
        MONEY_AMOUNT,
        { fieldKey: 'memo', label: '說明', required: false, type: 'text' },
      ]);

      await expect(
        assertTemplateFilterableFieldsEnabled(
          manager,
          'template-1',
          next,
          inForce,
        ),
      ).resolves.toBeUndefined();
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('jsonb_object_agg'),
        ),
      ).toBe(false);
    });

    it('scans only the field made filterable here, and refuses its dirty values', async (): Promise<void> => {
      const { manager, query } = createFakeManager({
        instances: [{ formData: { amount: 'abc', vendor: 'x' }, id: 'i-1' }],
      });
      const inForce = schemaOf([
        TEXT_VENDOR,
        { ...MONEY_AMOUNT, filterable: false },
      ]);
      const next = schemaOf([TEXT_VENDOR, MONEY_AMOUNT]);

      const reports = await readTemplateFilterableFieldIssues(
        manager,
        'template-1',
        next,
        inForce,
      );
      const instanceCall = query.mock.calls.find(([sql]) =>
        String(sql).includes('jsonb_object_agg'),
      );

      expect(instanceCall?.[1]).toEqual(['template-1', ['amount']]);
      expect(reports.map((report) => report.issue.path)).toEqual(['amount']);
      expect(reports[0].issue.kind).toBe('INVALID_VALUES');
    });

    it('scans a field whose type changed even though it was already filterable', async (): Promise<void> => {
      const { manager, query } = createFakeManager({
        instances: [{ formData: { amount: 'abc' }, id: 'i-1' }],
      });
      const inForce = schemaOf([{ ...MONEY_AMOUNT, type: 'text' }]);
      const next = schemaOf([MONEY_AMOUNT]);

      const reports = await readTemplateFilterableFieldIssues(
        manager,
        'template-1',
        next,
        inForce,
      );
      const instanceCall = query.mock.calls.find(([sql]) =>
        String(sql).includes('jsonb_object_agg'),
      );

      expect(instanceCall?.[1]).toEqual(['template-1', ['amount']]);
      expect(reports.map((report) => report.issue.kind)).toContain(
        'INVALID_VALUES',
      );
    });

    it('scans every filterable field when the template has no published version', async (): Promise<void> => {
      const { manager, query } = createFakeManager({
        instances: [],
      });

      await readTemplateFilterableFieldIssues(
        manager,
        'template-1',
        schemaOf([TEXT_VENDOR, MONEY_AMOUNT]),
        null,
      );
      const instanceCall = query.mock.calls.find(([sql]) =>
        String(sql).includes('jsonb_object_agg'),
      );

      expect(instanceCall?.[1]).toEqual(['template-1', ['vendor', 'amount']]);
    });
  });

  it('checks every template on a shared form definition, labelling each', async (): Promise<void> => {
    const { manager } = createFakeManager({
      formDefinitionTemplates: ['template-a'],
      history: [{ id: 'fv-1', schema: TEXT_NOTE_V1, versionNumber: 1 }],
      instances: [{ formData: { note: 'abc' }, id: 'i-1' }],
      templateName: '出差申請',
    });

    const reports = await readFormDefinitionFilterableFieldIssues(
      manager,
      'form-1',
      MONEY_NOTE_V2,
    );

    expect(reports).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ kind: 'TYPE_CHANGED' }),
        templateId: 'template-a',
        templateName: '出差申請',
      }),
    ]);
  });

  it('returns nothing for a form definition when its schema has no filterable field', async (): Promise<void> => {
    const { manager, query } = createFakeManager({
      formDefinitionTemplates: ['template-a'],
    });

    await expect(
      readFormDefinitionFilterableFieldIssues(manager, 'form-1', TEXT_NOTE_V1),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a schemaJson that is not valid JSON', (): void => {
    expect(() => readFilterableFieldSchemaFromJson('{oops')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a schemaJson that is not an object', (): void => {
    expect(() => readFilterableFieldSchemaFromJson('[1,2]')).toThrow(
      BadRequestException,
    );
    expect(() => readFilterableFieldSchemaFromJson('null')).toThrow(
      BadRequestException,
    );
  });
});
