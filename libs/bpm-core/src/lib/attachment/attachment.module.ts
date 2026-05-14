import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { AttachmentController } from './attachment.controller';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentMutations } from './attachment.mutations';
import { AttachmentQueries } from './attachment.queries';
import { attachmentStorageProvider } from './attachment-storage.provider';
import { AttachmentStorage } from './attachment-storage.token';
import { AttachmentService } from './attachment.service';

export interface AttachmentModuleOptions {
  readonly storageProvider?: Provider<AttachmentStorage>;
}

const ATTACHMENT_MODULE_IMPORTS = [
  TypeOrmModule.forFeature([
    ApprovalInstanceEntity,
    AttachmentEntity,
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
  providers: [...ATTACHMENT_MODULE_PROVIDERS, attachmentStorageProvider],
  exports: ATTACHMENT_MODULE_EXPORTS,
})
export class AttachmentModule {
  static forRoot(options: AttachmentModuleOptions = {}): DynamicModule {
    return {
      controllers: ATTACHMENT_MODULE_CONTROLLERS,
      exports: ATTACHMENT_MODULE_EXPORTS,
      imports: ATTACHMENT_MODULE_IMPORTS,
      module: AttachmentModule,
      providers: [
        ...ATTACHMENT_MODULE_PROVIDERS,
        options.storageProvider ?? attachmentStorageProvider,
      ],
    };
  }
}
