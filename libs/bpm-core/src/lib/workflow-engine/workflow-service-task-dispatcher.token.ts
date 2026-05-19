import { InjectionToken } from '@nestjs/common';

export interface BPMWorkflowWebhookDispatchInput {
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload: unknown;
  readonly url: string;
}

export interface BPMWorkflowWebhookDispatchResult {
  readonly error?: string;
  readonly ok: boolean;
  readonly status: number | null;
}

export interface BPMWorkflowServiceTaskDispatcher {
  dispatchWebhook(
    input: BPMWorkflowWebhookDispatchInput,
  ): Promise<BPMWorkflowWebhookDispatchResult>;
}

export const BPM_WORKFLOW_SERVICE_TASK_DISPATCHER: InjectionToken<BPMWorkflowServiceTaskDispatcher> =
  Symbol('BPM_WORKFLOW_SERVICE_TASK_DISPATCHER');

export class DefaultWorkflowServiceTaskDispatcher implements BPMWorkflowServiceTaskDispatcher {
  async dispatchWebhook(
    input: BPMWorkflowWebhookDispatchInput,
  ): Promise<BPMWorkflowWebhookDispatchResult> {
    const response = await fetch(input.url, {
      body: JSON.stringify(input.payload),
      headers: {
        ...input.headers,
        ...(hasHeader(input.headers, 'content-type')
          ? {}
          : { 'content-type': 'application/json' }),
      },
      method: 'POST',
    });

    if (response.ok) {
      return { ok: true, status: response.status };
    }

    return {
      error: await readWebhookResponseError(response),
      ok: false,
      status: response.status,
    };
  }
}

function hasHeader(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): boolean {
  const normalizedName = name.toLocaleLowerCase();

  return Object.keys(headers ?? {}).some(
    (headerName) => headerName.toLocaleLowerCase() === normalizedName,
  );
}

async function readWebhookResponseError(response: Response): Promise<string> {
  const body = await response.text();
  const trimmedBody = body.trim();

  return trimmedBody
    ? `HTTP ${response.status}: ${trimmedBody.slice(0, 500)}`
    : `HTTP ${response.status}`;
}
