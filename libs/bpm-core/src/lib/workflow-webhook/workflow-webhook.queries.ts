import { Args, Field, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import { BPMDesignerOnly } from '../bpm-auth';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookEndpointSourceKind,
} from './workflow-webhook.types';

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

  @Field()
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

  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field(() => [WorkflowWebhookParameterObject])
  parameters!: readonly WorkflowWebhookParameterObject[];

  @Field()
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
