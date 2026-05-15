import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsBase64,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

@InputType()
export class UploadAttachmentInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  instanceId?: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  formFieldPath?: string | null;

  @Field(() => String, {
    deprecationReason:
      'Ignored. The current authenticated BPM member is always used.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  uploaderMemberId?: string | null;

  @Field()
  @IsString()
  filename!: string;

  @Field()
  @IsString()
  mimeType!: string;

  @Field(() => Int)
  @IsInt()
  @Max(10 * 1024 * 1024)
  @Min(1)
  sizeBytes!: number;

  @Field()
  @IsBase64()
  contentBase64!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  checksumSha256?: string | null;
}
