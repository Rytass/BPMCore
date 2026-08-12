import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDataSourceQueries } from './form-data-source.queries';
import { FormDataSourceService } from './form-data-source.service';
import { FormDataSourceValueResolverService } from './form-data-source-value-resolver.service';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPM_FORM_DATA_SOURCE_VALUE_RESOLVER,
  BPMFormDataSourceRegistry,
  EmptyBPMFormDataSourceRegistry,
} from './form-data-source.types';

export interface FormDataSourceModuleOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly registryProvider?: Provider<BPMFormDataSourceRegistry>;
}

@Global()
@Module({})
export class FormDataSourceModule {
  static forRoot(options: FormDataSourceModuleOptions = {}): DynamicModule {
    const registryProvider: Provider<BPMFormDataSourceRegistry> =
      options.registryProvider ?? {
        provide: BPM_FORM_DATA_SOURCE_REGISTRY,
        useClass: EmptyBPMFormDataSourceRegistry,
      };

    return {
      exports: [
        BPM_FORM_DATA_SOURCE_REGISTRY,
        BPM_FORM_DATA_SOURCE_VALUE_RESOLVER,
        FormDataSourceService,
      ],
      global: true,
      imports: [
        ...(options.imports ?? []),
        WorkflowEngineModule,
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
