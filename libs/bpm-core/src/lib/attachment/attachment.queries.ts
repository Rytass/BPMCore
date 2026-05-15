import { Args, Query, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated, BPMCurrentMemberId } from '../bpm-auth';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';

@Resolver()
@BPMAuthenticated()
export class AttachmentQueries {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Query(() => [AttachmentEntity])
  async attachments(
    @Args('instanceId', { type: () => String }) instanceId: string,
    @Args('taskId', { nullable: true, type: () => String })
    taskId?: string | null,
    @Args('formFieldPath', { nullable: true, type: () => String })
    formFieldPath?: string | null,
    @BPMCurrentMemberId() currentMemberId?: string,
  ): Promise<readonly AttachmentEntity[]> {
    return this.attachmentService.listAttachments({
      formFieldPath: formFieldPath ?? null,
      instanceId,
      requestedByMemberId: currentMemberId,
      taskId: taskId ?? null,
    });
  }

  @Query(() => String)
  async attachmentDownloadUrl(
    @Args('id', { type: () => String }) id: string,
    @Args('requestedByMemberId', {
      deprecationReason:
        'Ignored. The current authenticated BPM member is always used.',
      nullable: true,
      type: () => String,
    })
    _requestedByMemberId: string | null,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<string> {
    return this.attachmentService.createSignedUrl({
      disposition: 'attachment',
      id,
      requestedByMemberId: currentMemberId,
    });
  }

  @Query(() => String)
  async attachmentPreviewUrl(
    @Args('id', { type: () => String }) id: string,
    @Args('requestedByMemberId', {
      deprecationReason:
        'Ignored. The current authenticated BPM member is always used.',
      nullable: true,
      type: () => String,
    })
    _requestedByMemberId: string | null,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<string> {
    return this.attachmentService.createSignedUrl({
      disposition: 'inline',
      id,
      requestedByMemberId: currentMemberId,
    });
  }
}
