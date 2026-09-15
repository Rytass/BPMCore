import { resolveBPMWorkflowWebhookOptions } from './workflow-webhook-options';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPMWorkflowWebhookEndpoint,
  BPMWorkflowWebhookEndpointDescriptor,
  BPMWorkflowWebhookRegistry,
  StaticBPMWorkflowWebhookRegistry,
} from './workflow-webhook.types';

function endpoint(
  descriptor: Partial<BPMWorkflowWebhookEndpointDescriptor> & {
    readonly key: string;
  },
): BPMWorkflowWebhookEndpoint {
  return {
    buildRequest: async () => ({ url: 'https://erp.example.com/hooks/bpm' }),
    descriptor: {
      label: descriptor.key,
      parameters: [],
      version: 1,
      ...descriptor,
    },
  };
}

function service(
  registry: BPMWorkflowWebhookRegistry | undefined,
  options = resolveBPMWorkflowWebhookOptions(),
): WorkflowWebhookService {
  return new WorkflowWebhookService(registry, options);
}

describe('WorkflowWebhookService', () => {
  it('reports no source when the host registered no registry', () => {
    expect(service(undefined).hasEndpointSources()).toBe(false);
  });

  it('exposes the registry as a source once one is provided', async () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([endpoint({ key: 'erp.po' })]),
    );

    expect(instance.hasEndpointSources()).toBe(true);
    expect(
      (await instance.listEndpoints()).map((entry) => [
        entry.endpoint.descriptor.key,
        entry.source,
      ]),
    ).toEqual([['erp.po', 'REGISTRY']]);
  });

  it('hides deprecated endpoints unless asked for them', async () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({ key: 'erp.po' }),
        endpoint({ deprecated: true, key: 'erp.legacy' }),
      ]),
    );

    expect(
      (await instance.listEndpoints()).map((e) => e.endpoint.descriptor.key),
    ).toEqual(['erp.po']);
    expect(
      (await instance.listEndpoints({ includeDeprecated: true })).map(
        (e) => e.endpoint.descriptor.key,
      ),
    ).toEqual(['erp.po', 'erp.legacy']);
  });

  it('looks an endpoint up by key and exact version', async () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({ key: 'erp.po', version: 1 }),
        endpoint({ key: 'erp.po', version: 2 }),
      ]),
    );

    expect(
      (await instance.getEndpoint('erp.po', 2))?.endpoint.descriptor.version,
    ).toBe(2);
    expect(await instance.getEndpoint('erp.po', 3)).toBeNull();
    expect(await instance.getEndpoint('erp.other', 1)).toBeNull();
  });

  it('still resolves a deprecated endpoint, so published templates keep working', async () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({ deprecated: true, key: 'erp.legacy' }),
      ]),
    );

    expect(await instance.getEndpoint('erp.legacy', 1)).not.toBeNull();
  });

  it('ignores the registry when REGISTRY is not an enabled source', async () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([endpoint({ key: 'erp.po' })]),
      { ...resolveBPMWorkflowWebhookOptions(), targetSources: [] },
    );

    expect(instance.hasEndpointSources()).toBe(false);
    expect(await instance.listEndpoints()).toEqual([]);
  });

  it('refuses to boot on a registry that contradicts itself', () => {
    const duplicate = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({ key: 'erp.po' }),
        endpoint({ key: 'erp.po' }),
      ]),
    );

    expect(() => duplicate.onModuleInit()).toThrow(
      /erp\.po@1 is registered more than once/u,
    );

    const badParameters = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({
          key: 'erp.po',
          parameters: [
            { key: 'amount', label: 'Amount', required: true, type: 'number' },
            {
              key: 'amount',
              label: 'Amount again',
              required: false,
              type: 'string',
            },
          ],
        }),
      ]),
    );

    expect(() => badParameters.onModuleInit()).toThrow(
      /duplicate parameter keys/u,
    );

    const badVersion = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({ key: 'erp.po', version: 0 }),
      ]),
    );

    expect(() => badVersion.onModuleInit()).toThrow(
      /integer version between 1 and/u,
    );
  });

  it('accepts a well-formed registry', () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({
          key: 'erp.po',
          parameters: [
            { key: 'amount', label: 'Amount', required: true, type: 'number' },
          ],
        }),
      ]),
    );

    expect(() => instance.onModuleInit()).not.toThrow();
  });

  it('rejects a version the GraphQL Int cannot carry', () => {
    const instance = service(
      new StaticBPMWorkflowWebhookRegistry([
        endpoint({ key: 'erp.po', version: 2_147_483_648 }),
      ]),
    );

    expect(() => instance.onModuleInit()).toThrow(
      /integer version between 1 and 2147483647/u,
    );
  });

  it('rejects malformed parameter declarations with a readable message', () => {
    const cases: readonly [unknown, RegExp][] = [
      [null, /must declare parameters as an array/u],
      [
        [{ key: 'amount', label: 'Amount', required: true, type: 'date' }],
        /unsupported type "date"/u,
      ],
      [
        [{ key: ' amount', label: 'Amount', required: true, type: 'number' }],
        /must not have surrounding whitespace/u,
      ],
      [
        [
          { key: 'amount', label: 'A', required: true, type: 'number' },
          { key: 'amount ', label: 'B', required: true, type: 'number' },
        ],
        /duplicate parameter keys/u,
      ],
    ];

    cases.forEach(([parameters, message]) => {
      const instance = service(
        new StaticBPMWorkflowWebhookRegistry([
          endpoint({
            key: 'erp.po',
            parameters:
              parameters as BPMWorkflowWebhookEndpointDescriptor['parameters'],
          }),
        ]),
      );

      expect(() => instance.onModuleInit()).toThrow(message);
    });
  });

  it('explains a descriptor that is missing or mistyped instead of throwing a TypeError', () => {
    const registry = {
      get: () => null,
      list: () =>
        [
          {
            buildRequest: async () => ({ url: 'https://x.test' }),
            descriptor: null,
          },
          {
            buildRequest: async () => ({ url: 'https://x.test' }),
            descriptor: { key: 42, label: 'L', parameters: [], version: 1 },
          },
        ] as unknown as readonly BPMWorkflowWebhookEndpoint[],
    };

    expect(() => service(registry).onModuleInit()).toThrow(
      'Invalid BPM webhook endpoint registry: endpoint #0 has no descriptor; endpoint #1 must have a string key and label',
    );
  });
});
