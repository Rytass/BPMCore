import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated, BPMCurrentMemberId } from '../bpm-auth';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';
import { UploadAttachmentInput } from './dto/upload-attachment.input';

@Resolver()
@BPMAuthenticated()
export class AttachmentMutations {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Mutation(() => AttachmentEntity)
  async uploadAttachment(
    @Args('input') input: UploadAttachmentInput,
    @BPMCurrentMemberId() currentMemberId: string,
  ): Promise<AttachmentEntity> {
    return this.attachmentService.uploadAttachment({
      ...input,
      uploaderMemberId: currentMemberId,
    });
  }
}
