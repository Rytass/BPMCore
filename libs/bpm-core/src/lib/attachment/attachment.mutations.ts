import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AttachmentEntity } from './attachment.entity';
import { AttachmentService } from './attachment.service';
import { UploadAttachmentInput } from './dto/upload-attachment.input';

@Resolver()
export class AttachmentMutations {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Mutation(() => AttachmentEntity)
  async uploadAttachment(
    @Args('input') input: UploadAttachmentInput,
  ): Promise<AttachmentEntity> {
    return this.attachmentService.uploadAttachment(input);
  }
}
