import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  NotifyWebhookBinding,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookParameter,
} from './workflow-webhook.types';
import { lintWorkflowWebhookTargets } from './workflow-webhook.validator';

const FORM_SCHEMA: FormDefinitionSchema = {
  schemaVersion: 1,
  fields: [
    { fieldKey: 'subject', label: 'Subject', required: true, type: 'text' },
    { fieldKey: 'amount', label: 'Amount', required: true, type: 'money' },
    {
      fieldKey: 'tags',
      label: 'Tags',
      mode: 'multiple',
      options: [{ label: 'A', value: 'a' }],
      required: false,
      type: 'select',
    },
  ],
};

const PARAMETERS: readonly BPMWorkflowWebhookParameter[] = [
  { key: 'amount', label: 'Amount', required: true, type: 'number' },
  { key: 'caseId', label: 'Case id', required: false, type: 'string' },
  { key: 'tags', label: 'Tags', required: false, type: 'stringArray' },
];

function definition(
  bindings: readonly NotifyWebhookBinding[],
): WorkflowDefinition {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: { memberIds: [], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [
              {
                bindings,
                endpoint: { key: 'erp.po', version: 1 },
                id: 'webhook_erp',
              },
            ],
          },
          label: '通知 ERP',
          triggerMode: 'AND',
        },
        id: 'notify_erp',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
    ],
  };
}

function entry(
  overrides: Partial<{
    readonly deprecated: boolean;
    readonly parameters: readonly BPMWorkflowWebhookParameter[];
  }> = {},
): BPMWorkflowWebhookEndpointEntry {
  return {
    endpoint: {
      buildRequest: async () => ({ url: 'https://erp.example.com/hooks/bpm' }),
      descriptor: {
        deprecated: overrides.deprecated,
        key: 'erp.po',
        label: 'ERP purchase order',
        parameters: overrides.parameters ?? PARAMETERS,
        version: 1,
      },
    },
    source: 'REGISTRY',
  };
}

async function lint(
  bindings: readonly NotifyWebhookBinding[],
  options: {
    readonly hasEndpointSources?: boolean;
    readonly resolved?: BPMWorkflowWebhookEndpointEntry | null;
  } = {},
): Promise<readonly string[]> {
  return lintWorkflowWebhookTargets({
    definition: definition(bindings),
    formSchema: FORM_SCHEMA,
    hasEndpointSources: options.hasEndpointSources ?? true,
    resolveEndpoint: async () =>
      options.resolved === undefined ? entry() : options.resolved,
  });
}

const AMOUNT_BINDING: NotifyWebhookBinding = {
  from: { fieldKey: 'amount', kind: 'FIELD' },
  parameter: 'amount',
};

describe('lintWorkflowWebhookTargets', () => {
  it('accepts every binding kind against a matching parameter', async () => {
    expect(
      await lint([
        AMOUNT_BINDING,
        { from: { kind: 'CONTEXT', path: 'instance.id' }, parameter: 'caseId' },
        { from: { fieldKey: 'tags', kind: 'FIELD' }, parameter: 'tags' },
      ]),
    ).toEqual([]);
  });

  it('says nothing about a workflow with no webhooks', async () => {
    expect(
      await lintWorkflowWebhookTargets({
        definition: { edges: [], meta: { schemaVersion: 1 }, nodes: [] },
        formSchema: FORM_SCHEMA,
        hasEndpointSources: false,
        resolveEndpoint: async () => null,
      }),
    ).toEqual([]);
  });

  it('refuses any webhook when no endpoint source is configured', async () => {
    expect(await lint([AMOUNT_BINDING], { hasEndpointSources: false })).toEqual(
      [
        'workflow.nodes.notify_erp.action.webhooks cannot be published: no webhook endpoint source is configured (WORKFLOW_WEBHOOK_REGISTRY_MISSING)',
      ],
    );
  });

  it('refuses an endpoint the catalog does not know', async () => {
    expect(await lint([AMOUNT_BINDING], { resolved: null })).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].endpoint erp.po@1 is not registered (WORKFLOW_WEBHOOK_ENDPOINT_MISSING)',
    ]);
  });

  it('refuses a deprecated endpoint for a new publish', async () => {
    expect(
      await lint([AMOUNT_BINDING], { resolved: entry({ deprecated: true }) }),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].endpoint erp.po@1 is deprecated (WORKFLOW_WEBHOOK_ENDPOINT_DEPRECATED)',
    ]);
  });

  it('requires every required parameter to be bound', async () => {
    expect(await lint([])).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings is missing required parameter "amount" (WORKFLOW_WEBHOOK_PARAMETER_REQUIRED)',
    ]);
  });

  it('rejects a parameter the endpoint never declared', async () => {
    expect(
      await lint([
        AMOUNT_BINDING,
        { from: { kind: 'CONSTANT', value: 'x' }, parameter: 'nope' },
      ]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[1].parameter "nope" is not declared by the endpoint (WORKFLOW_WEBHOOK_PARAMETER_UNKNOWN)',
    ]);
  });

  it('checks that a bound field exists and fits the parameter type', async () => {
    expect(
      await lint([
        { from: { fieldKey: 'ghost', kind: 'FIELD' }, parameter: 'amount' },
      ]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[0].from.fieldKey "ghost" does not match a schema field (WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE)',
    ]);
    expect(
      await lint([
        { from: { fieldKey: 'subject', kind: 'FIELD' }, parameter: 'amount' },
      ]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[0].from.fieldKey "subject" (text) cannot fill parameter "amount" (number) (WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE)',
    ]);
  });

  it('checks a constant against the parameter type', async () => {
    expect(
      await lint([
        { from: { kind: 'CONSTANT', value: 'lots' }, parameter: 'amount' },
      ]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[0].from.value does not fit parameter "amount" (number) (WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE)',
    ]);
    expect(
      await lint([
        { from: { kind: 'CONSTANT', value: 1200 }, parameter: 'amount' },
      ]),
    ).toEqual([]);
  });

  it('only lets a context path fill a string or json parameter', async () => {
    expect(
      await lint([
        {
          from: { kind: 'CONTEXT', path: 'instance.title' },
          parameter: 'amount',
        },
      ]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[0].from.path is a string and cannot fill parameter "amount" (number) (WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE)',
    ]);
  });

  it('rejects a null constant for a required parameter', async () => {
    expect(
      await lint([
        { from: { kind: 'CONSTANT', value: null }, parameter: 'amount' },
      ]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[0].from.value cannot be null for required parameter "amount" (WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE)',
    ]);
    expect(
      await lint([
        AMOUNT_BINDING,
        { from: { kind: 'CONSTANT', value: null }, parameter: 'caseId' },
      ]),
    ).toEqual([]);
  });

  it('leaves malformed webhook JSON to the structural lint instead of throwing', async () => {
    const malformed: readonly unknown[] = [
      [42],
      [null],
      [{ bindings: 'x', endpoint: { key: 'erp.po', version: 1 }, id: 'w' }],
      [
        {
          bindings: [{ parameter: 'amount' }],
          endpoint: { key: 'erp.po', version: 1 },
          id: 'w',
        },
      ],
      [{ bindings: [], id: 'w' }],
    ];

    for (const webhooks of malformed) {
      const malformedDefinition = {
        edges: [],
        meta: { schemaVersion: 1 },
        nodes: [
          {
            data: {
              action: {
                channels: ['IN_APP'],
                recipients: { memberIds: [], type: 'DIRECT' },
                type: 'NOTIFY',
                webhooks,
              },
              label: '通知 ERP',
            },
            id: 'notify_erp',
            position: { x: 0, y: 0 },
            type: 'serviceTask',
          },
        ],
      } as unknown as WorkflowDefinition;

      await expect(
        lintWorkflowWebhookTargets({
          definition: malformedDefinition,
          formSchema: FORM_SCHEMA,
          hasEndpointSources: true,
          resolveEndpoint: async () => entry(),
        }),
      ).resolves.toEqual([]);
    }
  });

  it('still lints the well-formed targets of a node that has a malformed one', async () => {
    const malformedDefinition = {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: [], type: 'DIRECT' },
              type: 'NOTIFY',
              webhooks: [
                {
                  bindings: 'x',
                  endpoint: { key: 'erp.po', version: 1 },
                  id: 'bad',
                },
                {
                  bindings: [
                    {
                      from: { fieldKey: 'subject', kind: 'FIELD' },
                      parameter: 'amount',
                    },
                  ],
                  endpoint: { key: 'erp.po', version: 1 },
                  id: 'good',
                },
              ],
            },
            label: '通知 ERP',
          },
          id: 'notify_erp',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
      ],
    } as unknown as WorkflowDefinition;

    expect(
      await lintWorkflowWebhookTargets({
        definition: malformedDefinition,
        formSchema: FORM_SCHEMA,
        hasEndpointSources: true,
        resolveEndpoint: async () => entry(),
      }),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[1].bindings[0].from.fieldKey "subject" (text) cannot fill parameter "amount" (number) (WORKFLOW_WEBHOOK_BINDING_INCOMPATIBLE)',
    ]);
  });
});
