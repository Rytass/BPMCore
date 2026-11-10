import { BadRequestException } from '@nestjs/common';
import {
  type ApprovalInstanceFieldFilter,
  type ApprovalInstanceSort,
  readFilterableFieldPaths,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  type CompileApprovalInstanceFieldFiltersInput,
  type CompiledSqlFragment,
  ApprovalInstanceFieldFilterCompiler,
  readStaticOptionsByPath,
} from './approval-instance-field-filter.compiler';

const schema: FormDefinitionSchema = {
  fields: [
    {
      fieldKey: 'reason',
      filterable: true,
      required: false,
      label: '事由',
      type: 'text',
    },
    {
      fieldKey: 'amount',
      filterable: true,
      required: false,
      label: '金額',
      type: 'number',
    },
    {
      fieldKey: 'expectedDate',
      filterable: true,
      required: false,
      label: '預計日期',
      type: 'date',
    },
    {
      fieldKey: 'submittedOn',
      filterable: true,
      required: false,
      label: '送出時間',
      type: 'datetime',
    },
    {
      fieldKey: 'urgency',
      filterable: true,
      required: false,
      label: '緊急度',
      options: [
        { label: '高', value: 'high' },
        { label: '低', value: 'low' },
      ],
      type: 'select',
    },
    {
      dataSource: { bindings: [], key: 'vendors', version: 1 },
      fieldKey: 'vendor',
      filterable: true,
      required: false,
      label: '廠商',
      type: 'autocomplete',
    },
    {
      fieldKey: 'note',
      filterable: true,
      required: false,
      label: '備註',
      type: 'textarea',
    },
    {
      fieldKey: 'paid',
      filterable: true,
      required: false,
      label: '已付款',
      type: 'boolean',
    },
    {
      fieldKey: 'requester',
      filterable: true,
      required: false,
      label: '申請人',
      type: 'member',
    },
    {
      columns: [
        {
          fieldKey: 'item',
          filterable: true,
          required: false,
          label: '品項',
          type: 'text',
        },
        {
          fieldKey: 'qty',
          filterable: true,
          required: false,
          label: '數量',
          type: 'number',
        },
        {
          fieldKey: 'unit',
          filterable: true,
          required: false,
          label: '單位',
          options: [
            { label: '箱', value: 'box' },
            { label: '件', value: 'piece' },
          ],
          type: 'select',
        },
      ],
      fieldKey: 'lines',
      label: '明細',
      required: false,
      type: 'table',
    },
    {
      columns: [
        {
          fieldKey: 'name',
          filterable: true,
          required: false,
          label: '檔名',
          type: 'text',
        },
      ],
      fieldKey: 'attachments',
      label: '附件',
      required: false,
      type: 'table',
    },
  ],
  schemaVersion: 1,
};

const paths = readFilterableFieldPaths(schema);
const staticOptionsByPath = readStaticOptionsByPath([schema]);
const compiler = new ApprovalInstanceFieldFilterCompiler();

const compileWith = (
  fieldFilters: readonly ApprovalInstanceFieldFilter[] = [],
  sort: readonly ApprovalInstanceSort[] = [],
): ReturnType<ApprovalInstanceFieldFilterCompiler['compile']> =>
  compiler.compile({
    alias: 'approvalInstance',
    fieldFilters,
    paths,
    sort,
    staticOptionsByPath,
  } satisfies CompileApprovalInstanceFieldFiltersInput);

const onlyCondition = (
  fieldFilters: readonly ApprovalInstanceFieldFilter[],
): CompiledSqlFragment => {
  const [condition, ...rest] = compileWith(fieldFilters).conditions;

  if (!condition || rest.length > 0) {
    throw new Error('expected exactly one condition');
  }

  return condition;
};

/** Every `:name` placeholder in the SQL text. */
const placeholdersOf = (sql: string): string[] => [
  ...new Set(
    [...sql.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/gu)].map(
      (match): string => match[1] ?? '',
    ),
  ),
];

const expectParametersMatchPlaceholders = (
  fragment: CompiledSqlFragment,
): void => {
  expect(placeholdersOf(fragment.sql).sort()).toEqual(
    Object.keys(fragment.parameters).sort(),
  );
};

describe('ApprovalInstanceFieldFilterCompiler', (): void => {
  describe('top-level operators', (): void => {
    it('compiles EQUALS on text to a containment test the GIN index serves', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'reason', operator: 'EQUALS', values: ['採購'] },
      ]);

      expect(condition.sql).toContain(
        '"approvalInstance"."form_data" @> CAST(:ff0_v0_s0 AS jsonb)',
      );
      expect(condition.parameters['ff0_v0_s0']).toBe(
        JSON.stringify({ reason: '採購' }),
      );
      expectParametersMatchPlaceholders(condition);
    });

    it('matches an option by its string or its one-element list', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'urgency', operator: 'EQUALS', values: ['high'] },
      ]);

      expect(condition.sql).toContain('@> CAST(:ff0_v0_s0 AS jsonb)');
      expect(condition.sql).toContain('@> CAST(:ff0_v0_s1 AS jsonb)');
      expect(condition.parameters['ff0_v0_s1']).toBe(
        JSON.stringify({ urgency: ['high'] }),
      );
      expectParametersMatchPlaceholders(condition);
    });

    it('ORs every value of IN', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'urgency', operator: 'IN', values: ['high', 'low'] },
      ]);

      expect(condition.sql.startsWith('(')).toBe(true);
      expect(condition.sql).toContain('ff0_v1_s0');
      expect(condition.parameters['ff0_v1_s0']).toBe(
        JSON.stringify({ urgency: 'low' }),
      );
      expectParametersMatchPlaceholders(condition);
    });

    it('compares a number as a numeric cast, guarded by its JSON type', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'amount', operator: 'EQUALS', values: ['1500.50'] },
      ]);

      expect(condition.sql).toContain(
        'jsonb_typeof(("approvalInstance"."form_data" -> :ff0_key)) = \'number\'',
      );
      expect(condition.sql).toContain('= CAST(:ff0_v0 AS numeric)');
      expect(condition.parameters['ff0_v0']).toBe('1500.50');
      expectParametersMatchPlaceholders(condition);
    });

    it('bounds a number RANGE on both sides, inclusive', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'amount', from: '100', operator: 'RANGE', to: '500' },
      ]);

      expect(condition.sql).toContain('>= CAST(:ff0_from AS numeric)');
      expect(condition.sql).toContain('<= CAST(:ff0_to AS numeric)');
      expectParametersMatchPlaceholders(condition);
    });

    it('compares a date RANGE as canonical text, with a pattern guard', (): void => {
      const condition = onlyCondition([
        {
          fieldKey: 'expectedDate',
          from: '2026-11-01',
          operator: 'RANGE',
          to: '2026-11-30',
        },
      ]);

      expect(condition.parameters['ff0_re']).toBe(
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
      );
      expect(condition.parameters['ff0_from']).toBe('2026-11-01');
      expect(condition.parameters['ff0_to']).toBe('2026-11-30');
      expectParametersMatchPlaceholders(condition);
    });

    it('negates EQUALS but requires a value, so an empty field matches no NOT_EQUALS', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'reason', operator: 'NOT_EQUALS', values: ['採購'] },
      ]);

      expect(condition.sql).toContain('IS NOT NULL');
      expect(condition.sql).toContain('NOT (');
      expectParametersMatchPlaceholders(condition);
    });

    it('matches a boolean by its JSON value', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'paid', operator: 'EQUALS', values: ['true'] },
      ]);

      expect(condition.parameters['ff0_v0_s0']).toBe(
        JSON.stringify({ paid: true }),
      );
      expectParametersMatchPlaceholders(condition);
    });

    it('escapes LIKE wildcards and the escape character in CONTAINS', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'reason', operator: 'CONTAINS', values: ['50%_off\\'] },
      ]);

      expect(condition.parameters['ff0_pat']).toBe('%50\\%\\_off\\\\%');
      expect(condition.sql).toContain('ILIKE :ff0_pat');
      expectParametersMatchPlaceholders(condition);
    });

    it('matches CONTAINS on a static option by its name and by its stored value', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'urgency', operator: 'CONTAINS', values: ['高'] },
      ]);

      expect(condition.sql).toContain('jsonb_array_elements_text(');
      expect(condition.parameters['ff0_l0']).toBe(JSON.stringify(['high']));
      expectParametersMatchPlaceholders(condition);
    });

    it('matches CONTAINS on a data-source option through the option snapshot', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'vendor', operator: 'CONTAINS', values: ['台'] },
      ]);

      expect(condition.sql).toContain(
        '"approvalInstance"."form_data_option_snapshot"',
      );
      expect(condition.sql).toContain("'label' ILIKE :ff0_pat");
      expectParametersMatchPlaceholders(condition);
    });
  });

  describe('table columns', (): void => {
    it('puts every condition on one table in the same row', (): void => {
      const { conditions } = compileWith([
        { fieldKey: 'lines.item', operator: 'CONTAINS', values: ['螺絲'] },
        { fieldKey: 'lines.qty', operator: 'RANGE', from: '2' },
      ]);

      expect(conditions).toHaveLength(1);
      const [condition] = conditions;

      expect(condition).toBeDefined();
      expect(condition?.sql.match(/EXISTS/gu)).toHaveLength(1);
      expect(condition?.sql).toContain('ffrow0 ->> :ff0_key');
      expect(condition?.sql).toContain('ffrow0 -> :ff1_key');
      expect(condition?.sql.startsWith('EXISTS (SELECT 1 FROM')).toBe(true);
      expect(condition?.sql).toContain(' AND ');
      expect(condition).toBeDefined();
      expectParametersMatchPlaceholders(condition as CompiledSqlFragment);
    });

    it('gives each table its own row subquery', (): void => {
      const { conditions } = compileWith([
        { fieldKey: 'lines.item', operator: 'EQUALS', values: ['螺絲'] },
        {
          fieldKey: 'attachments.name',
          operator: 'CONTAINS',
          values: ['合約'],
        },
      ]);

      expect(conditions).toHaveLength(2);
      expect(conditions.every((item) => item.sql.startsWith('EXISTS'))).toBe(
        true,
      );
      expect(conditions[0]?.sql).toContain('ffrow0');
      expect(conditions[1]?.sql).toContain('ffrow1');
    });

    it('compares a table option cell by array containment', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'lines.unit', operator: 'EQUALS', values: ['box'] },
      ]);

      expect(condition.sql).toContain(
        'jsonb_build_array((ffrow0 -> :ff0_key))',
      );
      expect(condition.parameters['ff0_v0']).toBe(JSON.stringify(['box']));
      expectParametersMatchPlaceholders(condition);
    });

    it('keeps a top-level field and a table in separate conditions', (): void => {
      const { conditions } = compileWith([
        { fieldKey: 'reason', operator: 'CONTAINS', values: ['採'] },
        { fieldKey: 'lines.item', operator: 'EQUALS', values: ['螺絲'] },
      ]);

      expect(conditions).toHaveLength(2);
      expect(conditions[0]?.sql.startsWith('EXISTS')).toBe(false);
      expect(conditions[1]?.sql.startsWith('EXISTS')).toBe(true);
    });
  });

  describe('the field key is never spliced into SQL', (): void => {
    it('rejects an injected key as not filterable, with no key text in any output', (): void => {
      const injected = "reason'; DROP TABLE approval_instances; --";

      expect((): void => {
        compileWith([
          { fieldKey: injected, operator: 'EQUALS', values: ['x'] },
        ]);
      }).toThrow(new BadRequestException('這個欄位不能用來篩選'));
    });

    it('passes a real key only as a parameter', (): void => {
      const condition = onlyCondition([
        { fieldKey: 'reason', operator: 'EQUALS', values: ['x'] },
      ]);

      expect(condition.sql).not.toContain('reason');
      expect(condition.parameters['ff0_v0_s0']).toBe(
        JSON.stringify({ reason: 'x' }),
      );
      expect(condition.parameters['ff0_key']).toBeUndefined();
    });
  });

  describe('validation', (): void => {
    it('refuses a field the template does not mark filterable', (): void => {
      expect((): void => {
        compileWith([
          { fieldKey: 'missing', operator: 'EQUALS', values: ['x'] },
        ]);
      }).toThrow('這個欄位不能用來篩選');
    });

    it('refuses an operator the field type does not accept', (): void => {
      expect((): void => {
        compileWith([{ fieldKey: 'note', operator: 'EQUALS', values: ['x'] }]);
      }).toThrow('欄位「備註」不能使用 EQUALS 條件篩選');
    });

    it('refuses a non-decimal number', (): void => {
      expect((): void => {
        compileWith([
          { fieldKey: 'amount', operator: 'EQUALS', values: ['1e3'] },
        ]);
      }).toThrow('欄位「金額」的篩選值不正確：需要十進位數字');
    });

    it('refuses a NUL character, which PostgreSQL cannot store', (): void => {
      expect((): void => {
        compileWith([
          { fieldKey: 'reason', operator: 'CONTAINS', values: ['a\u0000b'] },
        ]);
      }).toThrow('不能包含 NUL 字元');
    });

    it('refuses a date that is not YYYY-MM-DD', (): void => {
      expect((): void => {
        compileWith([
          {
            fieldKey: 'expectedDate',
            operator: 'EQUALS',
            values: ['2026-1-3'],
          },
        ]);
      }).toThrow('需要 YYYY-MM-DD 格式的日期');
    });

    it('refuses a datetime without an explicit offset', (): void => {
      expect((): void => {
        compileWith([
          {
            fieldKey: 'submittedOn',
            from: '2026-11-03T08:30:00',
            operator: 'RANGE',
          },
        ]);
      }).toThrow('需要含時區的 ISO 8601 時間');
    });

    it('normalizes a datetime with an offset to UTC ISO text', (): void => {
      const condition = onlyCondition([
        {
          fieldKey: 'submittedOn',
          from: '2026-11-03T16:30:00+08:00',
          operator: 'RANGE',
        },
      ]);

      expect(condition.parameters['ff0_from']).toBe('2026-11-03T08:30:00.000Z');
      expect(condition.parameters['ff0_re']).toBe(
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$',
      );
    });

    it('refuses a boolean that is not true or false', (): void => {
      expect((): void => {
        compileWith([
          { fieldKey: 'paid', operator: 'EQUALS', values: ['yes'] },
        ]);
      }).toThrow('需要 true 或 false');
    });

    it('refuses an IN with no value or an empty one', (): void => {
      expect((): void => {
        compileWith([{ fieldKey: 'urgency', operator: 'IN', values: [] }]);
      }).toThrow('需要至少一個值，且不可為空字串');
      expect((): void => {
        compileWith([
          { fieldKey: 'urgency', operator: 'IN', values: ['high', ''] },
        ]);
      }).toThrow('需要至少一個值，且不可為空字串');
    });

    it('refuses a RANGE with neither bound', (): void => {
      expect((): void => {
        compileWith([{ fieldKey: 'amount', operator: 'RANGE' }]);
      }).toThrow('需要下界或上界');
    });
  });

  describe('request limits', (): void => {
    it('refuses more than 20 field filters', (): void => {
      const filters = Array.from(
        { length: 21 },
        (): ApprovalInstanceFieldFilter => ({
          fieldKey: 'reason',
          operator: 'EQUALS',
          values: ['x'],
        }),
      );

      expect((): void => {
        compileWith(filters);
      }).toThrow('篩選條件最多 20 個');
    });

    it('refuses more than 5 sort keys', (): void => {
      const sorts = Array.from({ length: 6 }, (): ApprovalInstanceSort => ({
        field: 'submittedAt',
      }));

      expect((): void => {
        compileWith([], sorts);
      }).toThrow('排序條件最多 5 個');
    });
  });

  describe('sort and paging order', (): void => {
    it('defaults to created_at DESC with id as the tie-breaker', (): void => {
      const { orderBy } = compileWith();

      expect(orderBy.map((item) => [item.sql, item.direction])).toEqual([
        ['"approvalInstance"."created_at"', 'DESC'],
        ['"approvalInstance"."id"', 'DESC'],
      ]);
    });

    it('maps the time sort fields to their columns', (): void => {
      const { orderBy } = compileWith(
        [],
        [{ direction: 'ASC', field: 'submittedAt' }],
      );

      expect(orderBy[0]?.sql).toBe('"approvalInstance"."started_at"');
      expect(orderBy[0]?.direction).toBe('ASC');
      expect(orderBy[orderBy.length - 1]).toEqual({
        direction: 'ASC',
        parameters: {},
        sql: '"approvalInstance"."id"',
      });
    });

    it('maps updatedAt and completedAt', (): void => {
      const { orderBy } = compileWith(
        [],
        [{ field: 'updatedAt' }, { field: 'completedAt', direction: 'ASC' }],
      );

      expect(orderBy[0]?.sql).toBe('"approvalInstance"."updated_at"');
      expect(orderBy[0]?.direction).toBe('DESC');
      expect(orderBy[1]?.sql).toBe('"approvalInstance"."completed_at"');
    });

    it('sorts a top-level number by a guarded numeric key', (): void => {
      const { orderBy } = compileWith(
        [],
        [{ direction: 'DESC', field: 'amount' }],
      );
      const [key] = orderBy;

      expect(key?.sql).toContain(
        'jsonb_typeof(("approvalInstance"."form_data" -> :fs0_key)) = \'number\'',
      );
      expect(key?.parameters).toEqual({ fs0_key: 'amount' });
    });

    it('sorts a top-level text key to NULL when the stored value is not a string', (): void => {
      const { orderBy } = compileWith([], [{ field: 'reason' }]);

      expect(orderBy[0]?.sql).toContain(
        'THEN ("approvalInstance"."form_data" ->> :fs0_key)',
      );
      expect(orderBy[0]?.sql).toContain(
        'jsonb_typeof(("approvalInstance"."form_data" -> :fs0_key)) = \'string\'',
      );
    });

    it('refuses a table column as a sort key', (): void => {
      expect((): void => {
        compileWith([], [{ field: 'lines.qty' }]);
      }).toThrow('這個欄位不能用來排序');
    });

    it('refuses a textarea as a sort key', (): void => {
      expect((): void => {
        compileWith([], [{ field: 'note' }]);
      }).toThrow('這個欄位不能用來排序');
    });

    it('refuses an unknown sort key with the same message', (): void => {
      expect((): void => {
        compileWith([], [{ field: 'nope' }]);
      }).toThrow('這個欄位不能用來排序');
    });
  });

  describe('static option lists', (): void => {
    it('keys a table column by tableKey.columnKey', (): void => {
      expect(staticOptionsByPath.get('lines.unit')).toEqual([
        { label: '箱', value: 'box' },
        { label: '件', value: 'piece' },
      ]);
      expect(staticOptionsByPath.get('urgency')).toHaveLength(2);
      expect(staticOptionsByPath.has('vendor')).toBe(false);
    });
  });
});
