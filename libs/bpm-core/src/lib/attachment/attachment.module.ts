import {
  DynamicModule,
  Global,
  InjectionToken,
  Module,
  Provider,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskDecisionEntity } from '../workflow-engine/task-decision.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { AttachmentController } from './attachment.controller';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentMutations } from './attachment.mutations';
import { AttachmentQueries } from './attachment.queries';
import { attachmentStorageProvider } from './attachment-storage.provider';
import { AttachmentStorage } from './attachment-storage.token';
import { AttachmentService } from './attachment.service';
import {
  BPM_ATTACHMENT_OPTIONS,
  BPMRootAttachmentOptions,
  resolveBPMAttachmentOptions,
} from './attachment-options';

export interface AttachmentModuleOptions extends BPMRootAttachmentOptions {
  readonly imports?: ModuleMetadata['imports'];
  readonly storageProvider?: Provider<AttachmentStorage>;
}

export interface AttachmentModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: readonly InjectionToken[];
  readonly storageProvider?: Provider<AttachmentStorage>;
  readonly useFactory: (
    ...args: readonly unknown[]
  ) => BPMRootAttachmentOptions | Promise<BPMRootAttachmentOptions>;
}

const ATTACHMENT_MODULE_IMPORTS = [
  TypeOrmModule.forFeature([
    ApprovalInstanceEntity,
    AttachmentEntity,
    TaskCandidateEntity,
    TaskDecisionEntity,
    TaskEntity,
  ]),
];

const ATTACHMENT_MODULE_CONTROLLERS = [AttachmentController];
const ATTACHMENT_MODULE_PROVIDERS = [
  AttachmentMutations,
  AttachmentQueries,
  AttachmentService,
];
const ATTACHMENT_MODULE_EXPORTS = [AttachmentService];

@Global()
@Module({
  imports: ATTACHMENT_MODULE_IMPORTS,
  controllers: ATTACHMENT_MODULE_CONTROLLERS,
  providers: [
    ...ATTACHMENT_MODULE_PROVIDERS,
    attachmentStorageProvider,
    createAttachmentOptionsProvider(),
  ],
  exports: ATTACHMENT_MODULE_EXPORTS,
})
export class AttachmentModule {
  static forRoot(options: AttachmentModuleOptions = {}): DynamicModule {
    return {
      controllers: ATTACHMENT_MODULE_CONTROLLERS,
      exports: ATTACHMENT_MODULE_EXPORTS,
      imports: [...(options.imports ?? []), ...ATTACHMENT_MODULE_IMPORTS],
      module: AttachmentModule,
      providers: [
        ...ATTACHMENT_MODULE_PROVIDERS,
        options.storageProvider ?? attachmentStorageProvider,
        createAttachmentOptionsProvider(options),
      ],
    };
  }

  static forRootAsync(options: AttachmentModuleAsyncOptions): DynamicModule {
    return {
      controllers: ATTACHMENT_MODULE_CONTROLLERS,
      exports: ATTACHMENT_MODULE_EXPORTS,
      imports: [...(options.imports ?? []), ...ATTACHMENT_MODULE_IMPORTS],
      module: AttachmentModule,
      providers: [
        ...ATTACHMENT_MODULE_PROVIDERS,
        options.storageProvider ?? attachmentStorageProvider,
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_ATTACHMENT_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<ReturnType<typeof resolveBPMAttachmentOptions>> =>
            resolveBPMAttachmentOptions(await options.useFactory(...args)),
        },
      ],
    };
  }
}

function createAttachmentOptionsProvider(
  options: BPMRootAttachmentOptions = {},
): Provider {
  return {
    provide: BPM_ATTACHMENT_OPTIONS,
    useValue: resolveBPMAttachmentOptions(options),
  };
}
