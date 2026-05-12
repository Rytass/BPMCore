import { Args, Query, Resolver } from '@nestjs/graphql';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';

@Resolver()
export class AttachmentQueries {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Query(() => [AttachmentEntity])
  async attachments(
    @Args('instanceId', { type: () => String }) instanceId: string,
    @Args('taskId', { nullable: true, type: () => String })
    taskId?: string | null,
    @Args('formFieldPath', { nullable: true, type: () => String })
    formFieldPath?: string | null,
  ): Promise<readonly AttachmentEntity[]> {
    return this.attachmentService.listAttachments({
      formFieldPath: formFieldPath ?? null,
      instanceId,
      taskId: taskId ?? null,
    });
  }

  @Query(() => String)
  async attachmentDownloadUrl(
    @Args('id', { type: () => String }) id: string,
    @Args('requestedByMemberId', { type: () => String })
    requestedByMemberId: string,
  ): Promise<string> {
    return this.attachmentService.createSignedUrl({
      disposition: 'attachment',
      id,
      requestedByMemberId,
    });
  }

  @Query(() => String)
  async attachmentPreviewUrl(
    @Args('id', { type: () => String }) id: string,
    @Args('requestedByMemberId', { type: () => String })
    requestedByMemberId: string,
  ): Promise<string> {
    return this.attachmentService.createSignedUrl({
      disposition: 'inline',
      id,
      requestedByMemberId,
    });
  }
}
