import { BPMAuthContext } from '../bpm-auth';
import {
  FormFieldOption,
  FormFieldValue,
  FormOptionFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export type BPMFormDataSourceControl =
  | 'autocomplete'
  | 'checkbox'
  | 'radio'
  | 'select';

export type BPMFormDataSourceParameterType =
  | 'BOOLEAN'
  | 'NUMBER'
  | 'STRING'
  | 'STRING_ARRAY';

export type BPMFormDataSourceRevalidationPolicy =
  | 'ALWAYS'
  | 'WHEN_VALUE_OR_BINDINGS_CHANGE';

export interface BPMFormDataSourceParameter {
  readonly key: string;
  readonly label?: string;
  readonly required: boolean;
  readonly type: BPMFormDataSourceParameterType;
}

export interface BPMFormDataSourceDescriptor {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly maximumResultCount: number;
  readonly minimumSearchLength: number;
  readonly pageSize: number;
  readonly paginationMode: 'CURSOR' | 'NONE';
  readonly parameters: readonly BPMFormDataSourceParameter[];
  readonly revalidationPolicy: BPMFormDataSourceRevalidationPolicy;
  readonly returnsCompleteList: boolean;
  readonly supportedControls: readonly BPMFormDataSourceControl[];
  readonly supportsSearch: boolean;
  readonly version: number;
}

export interface BPMFormDataSourceSearchRequest {
  readonly authContext: BPMAuthContext;
  readonly bindings: Readonly<Record<string, FormFieldValue>>;
  readonly cursor: string | null;
  readonly searchText: string;
  readonly signal: AbortSignal;
}

export interface BPMFormDataSourceSearchResult {
  readonly nextCursor?: string | null;
  readonly options: readonly FormFieldOption[];
}

export interface BPMFormDataSourceResolveRequest {
  readonly authContext: BPMAuthContext;
  readonly bindings: Readonly<Record<string, FormFieldValue>>;
  readonly signal: AbortSignal;
  readonly values: readonly string[];
}

export interface BPMFormDataSource {
  readonly descriptor: BPMFormDataSourceDescriptor;
  resolve(
    request: BPMFormDataSourceResolveRequest,
  ): Promise<readonly FormFieldOption[]>;
  search(
    request: BPMFormDataSourceSearchRequest,
  ): Promise<BPMFormDataSourceSearchResult>;
}

export interface BPMFormDataSourceRegistry {
  get(key: string, version: number): BPMFormDataSource | null;
  list(): readonly BPMFormDataSource[];
}

export const BPM_FORM_DATA_SOURCE_REGISTRY = Symbol(
  'BPM_FORM_DATA_SOURCE_REGISTRY',
);

export class EmptyBPMFormDataSourceRegistry
  implements BPMFormDataSourceRegistry
{
  get(key: string, version: number): BPMFormDataSource | null {
    void key;
    void version;
    return null;
  }

  list(): readonly BPMFormDataSource[] {
    return [];
  }
}

export class StaticBPMFormDataSourceRegistry
  implements BPMFormDataSourceRegistry
{
  private readonly sources: readonly BPMFormDataSource[];

  constructor(sources: readonly BPMFormDataSource[]) {
    this.sources = [...sources];
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

export interface BPMFormDataSourceOptionResult {
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly nextCursor: string | null;
  readonly options: readonly FormFieldOption[];
}

export interface BPMFormDataSourceResolveFieldInput {
  readonly authContext: BPMAuthContext;
  readonly field: FormOptionFieldDefinition;
  readonly formData: Readonly<Record<string, unknown>>;
  readonly values: readonly string[];
}
