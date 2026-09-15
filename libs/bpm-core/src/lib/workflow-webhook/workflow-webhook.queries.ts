import {
  Args,
  Field,
  Int,
  ObjectType,
  Query,
  registerEnumType,
  Resolver,
} from '@nestjs/graphql';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import { BPMDesignerOnly } from '../bpm-auth';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookEndpointSourceKind,
} from './workflow-webhook.types';

export const WorkflowWebhookEndpointSourceEnum: Readonly<
  Record<
    BPMWorkflowWebhookEndpointSourceKind,
    BPMWorkflowWebhookEndpointSourceKind
  >
> = {
  DATABASE: 'DATABASE',
  REGISTRY: 'REGISTRY',
};

registerEnumType(WorkflowWebhookEndpointSourceEnum, {
  name: 'BPMWorkflowWebhookEndpointSource',
});

export const WorkflowWebhookParameterTypeEnum: Readonly<
  Record<NotifyWebhookParameterType, NotifyWebhookParameterType>
> = {
  boolean: 'boolean',
  json: 'json',
  number: 'number',
  string: 'string',
  stringArray: 'stringArray',
};

registerEnumType(WorkflowWebhookParameterTypeEnum, {
  name: 'BPMWorkflowWebhookParameterType',
});

@ObjectType('BPMWorkflowWebhookParameter')
export class WorkflowWebhookParameterObject {
  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  required!: boolean;

  @Field(() => WorkflowWebhookParameterTypeEnum)
  type!: NotifyWebhookParameterType;
}

/**
 * The designer's view of an endpoint. Deliberately carries no URL, header or
 * secret (ADR 18 §3.8): those never reach the browser, whichever source the
 * endpoint came from.
 */
@ObjectType('BPMWorkflowWebhookEndpoint')
export class WorkflowWebhookEndpointObject {
  @Field()
  deprecated!: boolean;

  @Field(() => String, { nullable: true })
  description!: string | null;

  /** Switched off by an administrator; also reported as `deprecated`. */
  @Field()
  disabled!: boolean;

  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field(() => [WorkflowWebhookParameterObject])
  parameters!: readonly WorkflowWebhookParameterObject[];

  @Field(() => WorkflowWebhookEndpointSourceEnum)
  source!: BPMWorkflowWebhookEndpointSourceKind;

  @Field(() => Int)
  version!: number;
}

@Resolver()
@BPMDesignerOnly()
export class WorkflowWebhookQueries {
  constructor(private readonly webhookService: WorkflowWebhookService) {}

  /**
   * `includeDeprecated` exists for the designer's edit path: a draft that
   * already references a deprecated endpoint must still render its name
   * instead of silently losing the target.
   */
  @Query(() => [WorkflowWebhookEndpointObject])
  async workflowWebhookEndpoints(
    @Args('includeDeprecated', { nullable: true, type: () => Boolean })
    includeDeprecated?: boolean | null,
  ): Promise<readonly WorkflowWebhookEndpointObject[]> {
    const entries = await this.webhookService.listEndpoints({
      includeDeprecated: Boolean(includeDeprecated),
    });

    return entries.map((entry) => toEndpointObject(entry));
  }
}

function toEndpointObject(
  entry: BPMWorkflowWebhookEndpointEntry,
): WorkflowWebhookEndpointObject {
  const descriptor = entry.endpoint.descriptor;

  return Object.assign(new WorkflowWebhookEndpointObject(), {
    deprecated: Boolean(descriptor.deprecated),
    description: descriptor.description ?? null,
    disabled: Boolean(descriptor.disabled),
    key: descriptor.key,
    label: descriptor.label,
    parameters: descriptor.parameters.map((parameter) =>
      Object.assign(new WorkflowWebhookParameterObject(), {
        description: parameter.description ?? null,
        key: parameter.key,
        label: parameter.label,
        required: parameter.required,
        type: parameter.type,
      }),
    ),
    source: entry.source,
    version: descriptor.version,
  });
}
