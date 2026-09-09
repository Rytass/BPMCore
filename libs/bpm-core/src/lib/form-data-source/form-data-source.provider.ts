import { Provider } from '@nestjs/common';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSourceRegistry,
  EmptyBPMFormDataSourceRegistry,
} from './form-data-source.types';

/**
 * Default form option DataSource catalog used when the host registers none.
 *
 * Prefers a registry handed to `BPMRootModule` as a runtime value
 * (`formDataSourceRegistry`, which a `forRootAsync` factory can build once its
 * upstream clients are configured) and otherwise exposes an empty catalog, so
 * a published form reference simply resolves to no options.
 *
 * `BPM_ROOT_OPTIONS` is injected optionally so `FormDataSourceModule` still
 * resolves when it is used on its own, outside `BPMRootModule`.
 */
export const defaultFormDataSourceRegistryProvider: Provider<BPMFormDataSourceRegistry> =
  {
    inject: [{ optional: true, token: BPM_ROOT_OPTIONS }],
    provide: BPM_FORM_DATA_SOURCE_REGISTRY,
    useFactory: (
      rootOptions: BPMRootRuntimeOptions | undefined,
    ): BPMFormDataSourceRegistry =>
      rootOptions?.formDataSourceRegistry ??
      new EmptyBPMFormDataSourceRegistry(),
  };
