import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { AttachmentController } from './attachment.controller';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentMutations } from './attachment.mutations';
import { AttachmentQueries } from './attachment.queries';
import { attachmentStorageProvider } from './attachment-storage.provider';
import { AttachmentService } from './attachment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalInstanceEntity,
      AttachmentEntity,
      TaskEntity,
    ]),
  ],
  controllers: [AttachmentController],
  providers: [
    AttachmentMutations,
    AttachmentQueries,
    AttachmentService,
    attachmentStorageProvider,
  ],
  exports: [AttachmentService],
})
export class AttachmentModule {}
