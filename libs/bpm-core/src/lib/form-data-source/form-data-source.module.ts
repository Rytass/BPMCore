import {
  DynamicModule,
  Global,
  Module,
  ModuleMetadata,
  Provider,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionModule } from '../condition/condition.module';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { defaultFormDataSourceRegistryProvider } from './form-data-source.provider';
import { FormDataSourceQueries } from './form-data-source.queries';
import { FormDataSourceService } from './form-data-source.service';
import { FormDataSourceValueResolverService } from './form-data-source-value-resolver.service';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPM_FORM_DATA_SOURCE_VALUE_RESOLVER,
  BPMFormDataSourceRegistry,
} from './form-data-source.types';

export interface FormDataSourceModuleOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly registryProvider?: Provider<BPMFormDataSourceRegistry>;
  /**
   * The engine module the runtime template checks run through. `BPMRootModule`
   * passes the very `WorkflowEngineModule.forRoot(...)` it imports itself, so
   * Nest builds one engine that sees the host's initiator `customFields`
   * resolver and service-task dispatcher. Importing the plain class instead
   * builds a second engine without them.
   */
  readonly workflowEngineModule?: DynamicModule;
}

@Global()
@Module({})
export class FormDataSourceModule {
  static forRoot(options: FormDataSourceModuleOptions = {}): DynamicModule {
    const registryProvider: Provider<BPMFormDataSourceRegistry> =
      options.registryProvider ?? defaultFormDataSourceRegistryProvider;

    return {
      exports: [
        BPM_FORM_DATA_SOURCE_REGISTRY,
        BPM_FORM_DATA_SOURCE_VALUE_RESOLVER,
        FormDataSourceService,
      ],
      global: true,
      imports: [
        ...(options.imports ?? []),
        options.workflowEngineModule ?? WorkflowEngineModule,
        // `EXPRESSION` bindings are linted and evaluated by the shared
        // `ConditionService`, with the host's function registry.
        ConditionModule,
        TypeOrmModule.forFeature([
          ApprovalTemplateVersionEntity,
          FormDefinitionVersionEntity,
        ]),
      ],
      module: FormDataSourceModule,
      providers: [
        registryProvider,
        FormDataSourceQueries,
        FormDataSourceService,
        FormDataSourceValueResolverService,
        {
          provide: BPM_FORM_DATA_SOURCE_VALUE_RESOLVER,
          useExisting: FormDataSourceValueResolverService,
        },
      ],
    };
  }
}
