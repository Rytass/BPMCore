import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { WorkflowWebhookEndpointAuditActionEnum } from './workflow-webhook-endpoint.entity';
import {
  WorkflowWebhookParameterObject,
  WorkflowWebhookParameterTypeEnum,
} from './workflow-webhook.queries';

registerEnumType(WorkflowWebhookEndpointAuditActionEnum, {
  name: 'BPMWorkflowWebhookEndpointAuditAction',
});

const PARAMETER_TYPES = Object.values(WorkflowWebhookParameterTypeEnum);

@InputType('BPMWorkflowWebhookEndpointHeaderInput')
export class WorkflowWebhookEndpointHeaderInput {
  @Field()
  @IsString()
  name!: string;

  /** Write-only: stored encrypted and never returned. */
  @Field()
  @IsString()
  value!: string;
}

@InputType('BPMWorkflowWebhookEndpointParameterInput')
export class WorkflowWebhookEndpointParameterInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field()
  @IsString()
  key!: string;

  @Field()
  @IsString()
  label!: string;

  @Field()
  @IsBoolean()
  required!: boolean;

  @Field(() => WorkflowWebhookParameterTypeEnum)
  @IsIn(PARAMETER_TYPES)
  type!: NotifyWebhookParameterType;
}

@InputType('BPMCreateWorkflowWebhookEndpointInput')
export class CreateWorkflowWebhookEndpointInput {
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  deprecated?: boolean | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field(() => [WorkflowWebhookEndpointHeaderInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @Type(() => WorkflowWebhookEndpointHeaderInput)
  @ValidateNested({ each: true })
  headers?: WorkflowWebhookEndpointHeaderInput[] | null;

  @Field()
  @IsString()
  key!: string;

  @Field()
  @IsString()
  label!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  method?: string | null;

  @Field(() => [WorkflowWebhookEndpointParameterInput])
  @IsArray()
  @Type(() => WorkflowWebhookEndpointParameterInput)
  @ValidateNested({ each: true })
  parameters!: WorkflowWebhookEndpointParameterInput[];

  /** Write-only: stored encrypted and never returned. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  signingSecret?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  timeoutMs?: number | null;

  @Field()
  @IsString()
  url!: string;

  @Field(() => Int)
  @IsInt()
  version!: number;
}

@InputType('BPMUpdateWorkflowWebhookEndpointInput')
export class UpdateWorkflowWebhookEndpointInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  deprecated?: boolean | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  /** Replaces every header when given; omit to keep the stored ones. */
  @Field(() => [WorkflowWebhookEndpointHeaderInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @Type(() => WorkflowWebhookEndpointHeaderInput)
  @ValidateNested({ each: true })
  headers?: WorkflowWebhookEndpointHeaderInput[] | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  label?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  method?: string | null;

  /** Must keep the stored contract (keys, types, required). */
  @Field(() => [WorkflowWebhookEndpointParameterInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @Type(() => WorkflowWebhookEndpointParameterInput)
  @ValidateNested({ each: true })
  parameters?: WorkflowWebhookEndpointParameterInput[] | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  timeoutMs?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  url?: string | null;
}

/**
 * The administrator's view of a database endpoint. Header values and the
 * signing secret are masked: only header names and whether a secret is set.
 */
@ObjectType('BPMWorkflowWebhookManagedEndpoint')
export class WorkflowWebhookManagedEndpointObject {
  @Field()
  active!: boolean;

  @Field()
  createdAt!: Date;

  @Field(() => String, { nullable: true })
  createdByMemberId!: string | null;

  @Field()
  deprecated!: boolean;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field()
  hasSigningSecret!: boolean;

  @Field(() => [String])
  headerNames!: readonly string[];

  @Field(() => ID)
  id!: string;

  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  method!: string;

  @Field(() => [WorkflowWebhookParameterObject])
  parameters!: readonly WorkflowWebhookParameterObject[];

  @Field(() => Date, { nullable: true })
  secretRotatedAt!: Date | null;

  @Field(() => Int, { nullable: true })
  timeoutMs!: number | null;

  @Field()
  updatedAt!: Date;

  @Field(() => String, { nullable: true })
  updatedByMemberId!: string | null;

  @Field()
  url!: string;

  @Field(() => Int)
  version!: number;
}

@ObjectType('BPMWorkflowWebhookEndpointAudit')
export class WorkflowWebhookEndpointAuditObject {
  @Field(() => WorkflowWebhookEndpointAuditActionEnum)
  action!: WorkflowWebhookEndpointAuditActionEnum;

  @Field(() => String, { nullable: true })
  actorMemberId!: string | null;

  @Field(() => [String])
  changedFields!: readonly string[];

  @Field()
  createdAt!: Date;

  @Field(() => ID)
  endpointId!: string;

  @Field(() => ID)
  id!: string;
}

@ObjectType('BPMWorkflowWebhookEndpointTestResult')
export class WorkflowWebhookEndpointTestResultObject {
  @Field(() => String, { nullable: true })
  errorCode!: string | null;

  @Field(() => String, { nullable: true })
  errorDetail!: string | null;

  @Field()
  ok!: boolean;

  @Field(() => Int, { nullable: true })
  status!: number | null;
}

/** Whether this server manages endpoints in the database, and its allowlist. */
@ObjectType('BPMWorkflowWebhookEndpointManagement')
export class WorkflowWebhookEndpointManagementObject {
  @Field(() => [String])
  allowedUrlPatterns!: readonly string[];

  @Field()
  enabled!: boolean;
}
