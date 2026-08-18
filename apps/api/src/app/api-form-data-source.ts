import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, QueryRunner } from 'typeorm';
import type {
  BPMFormDataSource,
  BPMFormDataSourceDescriptor,
  BPMFormDataSourceRegistry,
  BPMFormDataSourceResolveRequest,
  BPMFormDataSourceSearchRequest,
  BPMFormDataSourceSearchResult,
} from '@rytass/bpm-core-nestjs-module';
import type { FormFieldOption, FormFieldValue } from '@rytass/bpm-core-shared/form';

export const API_FORM_DATA_SOURCE_OPTIONS_TABLE =
  'api_form_data_source_options';

export interface ApiFormDataSourceOptionSeed {
  /**
   * Only the optional-parameter fixture uses this; the original three sources
   * declare no `category` parameter, so their rows stay `null`.
   */
  readonly category: string | null;
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly isActive: boolean;
  readonly label: string;
  readonly plant: string;
  readonly sortOrder: number;
  readonly value: string;
}

const OPTIONAL_FILTER_CATEGORIES: readonly {
  readonly key: string;
  readonly label: string;
}[] = [
  { key: 'CAPEX', label: '資本支出中心' },
  { key: 'OPEX', label: '營運費用中心' },
];

export const API_FORM_DATA_SOURCE_OPTION_SEEDS: readonly ApiFormDataSourceOptionSeed[] = [
  ...createCostCenterSeeds('demo.cost-centers', 1),
  ...createCostCenterSeeds('demo.cost-centers-complete', 1),
  ...createCostCenterSeeds('demo.cost-centers-always', 1),
  ...createOptionalFilterSeeds('demo.cost-centers-optional-filter', 1),
];

const PAGED_DESCRIPTOR: BPMFormDataSourceDescriptor = {
  description: '依 plant 篩選成本中心，支援搜尋與 cursor 分頁。',
  key: 'demo.cost-centers',
  label: 'Demo 成本中心（分頁）',
  maximumResultCount: 50,
  minimumSearchLength: 1,
  pageSize: 3,
  paginationMode: 'CURSOR',
  parameters: [
    { key: 'plant', label: '廠別', required: true, type: 'STRING' },
  ],
  revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
  returnsCompleteList: false,
  supportedControls: ['autocomplete', 'select'],
  supportsSearch: true,
  version: 1,
};

const COMPLETE_LIST_DESCRIPTOR: BPMFormDataSourceDescriptor = {
  description: '依 plant 回傳 bounded complete list，供 Radio / Checkbox 使用。',
  key: 'demo.cost-centers-complete',
  label: 'Demo 成本中心（完整清單）',
  maximumResultCount: 50,
  minimumSearchLength: 0,
  pageSize: 50,
  paginationMode: 'NONE',
  parameters: [
    { key: 'plant', label: '廠別', required: true, type: 'STRING' },
  ],
  revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
  returnsCompleteList: true,
  supportedControls: ['checkbox', 'radio'],
  supportsSearch: false,
  version: 1,
};

const ALWAYS_DESCRIPTOR: BPMFormDataSourceDescriptor = {
  description: '依 plant 驗證即時成本中心值，每次送出或重新送出都重新解析。',
  key: 'demo.cost-centers-always',
  label: 'Demo 成本中心（每次驗證）',
  maximumResultCount: 50,
  minimumSearchLength: 1,
  pageSize: 3,
  paginationMode: 'CURSOR',
  parameters: [
    { key: 'plant', label: '廠別', required: true, type: 'STRING' },
  ],
  revalidationPolicy: 'ALWAYS',
  returnsCompleteList: false,
  supportedControls: ['autocomplete', 'select'],
  supportsSearch: true,
  version: 1,
};

/**
 * The only fixture with an optional parameter. `category` is `required: false`,
 * so a form may bind it to a field the requester never fills; the source then
 * returns every cost center of the plant instead of refusing to answer.
 */
const OPTIONAL_FILTER_DESCRIPTOR: BPMFormDataSourceDescriptor = {
  description:
    '依 plant 篩選成本中心；category 為選填參數，未取得值時回傳該廠全部成本中心。',
  key: 'demo.cost-centers-optional-filter',
  label: 'Demo 成本中心（選填類別）',
  maximumResultCount: 50,
  minimumSearchLength: 0,
  pageSize: 10,
  paginationMode: 'CURSOR',
  parameters: [
    { key: 'plant', label: '廠別', required: true, type: 'STRING' },
    { key: 'category', label: '費用類別', required: false, type: 'STRING' },
  ],
  revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
  returnsCompleteList: false,
  supportedControls: ['autocomplete', 'select'],
  supportsSearch: true,
  version: 1,
};

interface ApiFormDataSourceOptionRow {
  readonly label: string;
  readonly sort_order: number;
  readonly value: string;
}

@Injectable()
export class ApiFormDataSourceRegistry
  implements BPMFormDataSourceRegistry, OnModuleInit
{
  private readonly sources: readonly BPMFormDataSource[];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.sources = [
      createHostDataSource(dataSource, PAGED_DESCRIPTOR),
      createHostDataSource(dataSource, COMPLETE_LIST_DESCRIPTOR),
      createHostDataSource(dataSource, ALWAYS_DESCRIPTOR),
      createHostDataSource(dataSource, OPTIONAL_FILTER_DESCRIPTOR),
    ];
  }

  async onModuleInit(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      await ensureApiFormDataSourceOptionsTable(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  get(key: string, version: number): BPMFormDataSource | null {
    return (
      this.sources.find(
        (source) =>
          source.descriptor.key === key && source.descriptor.version === version,
      ) ?? null
    );
  }

  list(): readonly BPMFormDataSource[] {
    return this.sources;
  }
}

export async function ensureApiFormDataSourceOptionsTable(
  queryRunner: QueryRunner,
): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE IF NOT EXISTS ${API_FORM_DATA_SOURCE_OPTIONS_TABLE} (
      data_source_key text NOT NULL,
      data_source_version integer NOT NULL CHECK (data_source_version > 0),
      plant text NOT NULL,
      value text NOT NULL,
      label text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      category text,
      PRIMARY KEY (data_source_key, data_source_version, plant, value)
    )
  `);
  // `CREATE TABLE IF NOT EXISTS` leaves databases created before the optional
  // parameter fixture without the column, so add it separately.
  await queryRunner.query(`
    ALTER TABLE ${API_FORM_DATA_SOURCE_OPTIONS_TABLE}
      ADD COLUMN IF NOT EXISTS category text
  `);
  await queryRunner.query(`
    CREATE INDEX IF NOT EXISTS ${API_FORM_DATA_SOURCE_OPTIONS_TABLE}_lookup_idx
      ON ${API_FORM_DATA_SOURCE_OPTIONS_TABLE}
        (data_source_key, data_source_version, plant, sort_order, value)
  `);
}

function createHostDataSource(
  dataSource: DataSource,
  descriptor: BPMFormDataSourceDescriptor,
): BPMFormDataSource {
  return {
    descriptor,
    resolve: (
      request: BPMFormDataSourceResolveRequest,
    ): Promise<readonly FormFieldOption[]> =>
      resolveHostOptions(dataSource, descriptor, request),
    search: (
      request: BPMFormDataSourceSearchRequest,
    ): Promise<BPMFormDataSourceSearchResult> =>
      searchHostOptions(dataSource, descriptor, request),
  };
}

async function searchHostOptions(
  dataSource: DataSource,
  descriptor: BPMFormDataSourceDescriptor,
  request: BPMFormDataSourceSearchRequest,
): Promise<BPMFormDataSourceSearchResult> {
  assertRequestIsActive(request.signal);
  const plant = readPlantBinding(request.bindings);
  const category = readCategoryBinding(request.bindings);
  const offset = readCursor(request.cursor);
  const searchPattern = request.searchText
    ? `%${escapeLikePattern(request.searchText)}%`
    : null;
  const rows = await dataSource.query<ApiFormDataSourceOptionRow[]>(
    `
      SELECT value, label, sort_order
      FROM ${API_FORM_DATA_SOURCE_OPTIONS_TABLE}
      WHERE data_source_key = $1
        AND data_source_version = $2
        AND plant = $3
        AND is_active = true
        AND ($4::text IS NULL OR value ILIKE $4 ESCAPE '\\' OR label ILIKE $4 ESCAPE '\\')
        AND ($5::text IS NULL OR category = $5)
      ORDER BY sort_order ASC, value ASC
      LIMIT $6 OFFSET $7
    `,
    [
      descriptor.key,
      descriptor.version,
      plant,
      searchPattern,
      category,
      descriptor.pageSize + 1,
      offset,
    ],
  );
  assertRequestIsActive(request.signal);

  const page = rows.slice(0, descriptor.pageSize).map(toFormFieldOption);
  const hasNextPage = rows.length > descriptor.pageSize;

  return {
    nextCursor: hasNextPage ? String(offset + descriptor.pageSize) : null,
    options: page,
  };
}

async function resolveHostOptions(
  dataSource: DataSource,
  descriptor: BPMFormDataSourceDescriptor,
  request: BPMFormDataSourceResolveRequest,
): Promise<readonly FormFieldOption[]> {
  assertRequestIsActive(request.signal);
  const plant = readPlantBinding(request.bindings);
  const category = readCategoryBinding(request.bindings);
  const rows = await dataSource.query<ApiFormDataSourceOptionRow[]>(
    `
      SELECT value, label, sort_order
      FROM ${API_FORM_DATA_SOURCE_OPTIONS_TABLE}
      WHERE data_source_key = $1
        AND data_source_version = $2
        AND plant = $3
        AND is_active = true
        AND value = ANY($4::text[])
        AND ($5::text IS NULL OR category = $5)
      ORDER BY sort_order ASC, value ASC
    `,
    [descriptor.key, descriptor.version, plant, [...request.values], category],
  );
  assertRequestIsActive(request.signal);

  const optionsByValue = new Map(
    rows.map(
      (row): readonly [string, FormFieldOption] => [
        row.value,
        toFormFieldOption(row),
      ],
    ),
  );

  return request.values.flatMap((value) => {
    const option = optionsByValue.get(value);

    return option ? [option] : [];
  });
}

function createCostCenterSeeds(
  dataSourceKey: string,
  dataSourceVersion: number,
): readonly ApiFormDataSourceOptionSeed[] {
  return [
    ...Array.from({ length: 8 }, (_, index) =>
      createSeed(dataSourceKey, dataSourceVersion, 'TW01', index + 1),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      createSeed(dataSourceKey, dataSourceVersion, 'TW02', index + 1),
    ),
    {
      category: null,
      dataSourceKey,
      dataSourceVersion,
      isActive: true,
      label: 'TW01 共用成本中心',
      plant: 'TW01',
      sortOrder: 20,
      value: 'CC-SHARED-001',
    },
    {
      category: null,
      dataSourceKey,
      dataSourceVersion,
      isActive: false,
      label: 'TW01 已停用成本中心',
      plant: 'TW01',
      sortOrder: 21,
      value: 'CC-DISABLED-001',
    },
    {
      category: null,
      dataSourceKey,
      dataSourceVersion,
      isActive: false,
      label: 'TW02 已刪除成本中心',
      plant: 'TW02',
      sortOrder: 21,
      value: 'CC-SHARED-001',
    },
  ];
}

function createSeed(
  dataSourceKey: string,
  dataSourceVersion: number,
  plant: string,
  sequence: number,
): ApiFormDataSourceOptionSeed {
  const paddedSequence = String(sequence).padStart(3, '0');

  return {
    category: null,
    dataSourceKey,
    dataSourceVersion,
    isActive: true,
    label: `${plant} 成本中心 ${paddedSequence}`,
    plant,
    sortOrder: sequence,
    value: `CC-${plant}-${paddedSequence}`,
  };
}

/**
 * Values never repeat across plants, so switching the bound plant always makes
 * a previously selected cost center unresolvable — the fixture the STALE to
 * INVALID journey needs. Labels also stay distinct from the other three
 * fixtures so a page rendering both is unambiguous to assert against.
 */
function createOptionalFilterSeeds(
  dataSourceKey: string,
  dataSourceVersion: number,
): readonly ApiFormDataSourceOptionSeed[] {
  return [
    ...createOptionalFilterPlantSeeds(dataSourceKey, dataSourceVersion, 'TW01', 3),
    ...createOptionalFilterPlantSeeds(dataSourceKey, dataSourceVersion, 'TW02', 2),
  ];
}

function createOptionalFilterPlantSeeds(
  dataSourceKey: string,
  dataSourceVersion: number,
  plant: string,
  countPerCategory: number,
): readonly ApiFormDataSourceOptionSeed[] {
  return OPTIONAL_FILTER_CATEGORIES.flatMap((category, categoryIndex) =>
    Array.from({ length: countPerCategory }, (_, index) => {
      const sequence = index + 1;
      const paddedSequence = String(sequence).padStart(3, '0');

      return {
        category: category.key,
        dataSourceKey,
        dataSourceVersion,
        isActive: true,
        label: `${plant} ${category.label} ${paddedSequence}`,
        plant,
        sortOrder: categoryIndex * 100 + sequence,
        value: `CC-${category.key}-${plant}-${paddedSequence}`,
      };
    }),
  );
}


function readPlantBinding(
  bindings: Readonly<Record<string, FormFieldValue>>,
): string | null {
  const plant = bindings.plant;

  return typeof plant === 'string' && plant.trim() ? plant : null;
}

/**
 * Optional parameter: an absent or blank binding means "no category filter",
 * never "refuse to answer". Sources without a `category` parameter never
 * receive the binding, so their queries are unaffected.
 */
function readCategoryBinding(
  bindings: Readonly<Record<string, FormFieldValue>>,
): string | null {
  const category = bindings.category;

  return typeof category === 'string' && category.trim() ? category : null;
}

function readCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }

  const offset = Number(cursor);

  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function assertRequestIsActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('DataSource request aborted');
  }
}

function toFormFieldOption(row: ApiFormDataSourceOptionRow): FormFieldOption {
  return { label: row.label, value: row.value };
}
