import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type Tool,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { WORKFLOW_TOOLSET } from '@rytass/bpm-core-shared';
import { WORKFLOW_CHAT_SYSTEM_PROMPT } from '../views/templates/designer/workflow-chat-prompt';

/**
 * Next.js route handler for the workflow designer LLM assistant.
 *
 * The model is advertised the workflow {@link WORKFLOW_TOOLSET} but the tools
 * carry **no `execute`** — so every tool call is forwarded to the browser,
 * where `useChat`'s `onToolCall` runs it against the React designer controller
 * (see `use-workflow-chat.ts`). This route only holds the API key, runs the
 * model, and streams the tool-call plan back. It never touches the canvas.
 *
 * Host usage (apps/client/src/app/api/chat/route.ts):
 *   export const runtime = 'nodejs';
 *   export const POST = createWorkflowChatPOST();
 *
 * The route answers 404 unless the assistant is enabled
 * (`BPM_AI_ASSISTANT_ENABLED=true`, read per request, or `options.enabled`),
 * runs the host's optional `authorize` hook (401 when it says no), bounds the
 * request (bytes and messages) and the model output (tokens), and drops any
 * `system` message the client sent (Phase 23 P4).
 */

/** Default OpenAI model id (overridable via BPM_LLM_MODEL). */
const DEFAULT_MODEL = 'gpt-5.4-mini';

/**
 * Resolve the model via the OpenAI provider directly (reads `OPENAI_API_KEY`).
 * Accepts a bare id (`gpt-5.4-mini`) or a `openai/`-prefixed id; the prefix is
 * stripped. This deployment talks to OpenAI directly — no AI Gateway.
 */
function resolveModel(setting: string): LanguageModel {
  return openai(setting.replace(/^openai\//u, ''));
}

/**
 * Strict guardrail: the assistant may ONLY design this approval flow, using the
 * provided tools. Lives server-side so it cannot be overridden by
 * client-supplied messages (the route drops every `system` message a client
 * sends). Shared with the offline Chrome model through `workflow-chat-prompt`.
 */
export { WORKFLOW_CHAT_SYSTEM_PROMPT };

/** Build AI SDK tools from WORKFLOW_TOOLSET — no `execute`, so the browser runs them. */
export function buildWorkflowAiSdkTools(): ToolSet {
  const entries: readonly (readonly [string, Tool])[] = WORKFLOW_TOOLSET.map(
    (workflowTool) =>
      [
        workflowTool.name,
        tool({
          description: workflowTool.description,
          inputSchema: jsonSchema(
            workflowTool.inputSchema as Parameters<typeof jsonSchema>[0],
          ),
        }),
      ] as const,
  );

  return Object.fromEntries(entries) as ToolSet;
}

/** Upper bound on the request body, in bytes. Tool results carry snapshots. */
export const DEFAULT_WORKFLOW_CHAT_MAX_REQUEST_BYTES = 1_048_576;
/** Upper bound on the messages in one request. */
export const DEFAULT_WORKFLOW_CHAT_MAX_MESSAGES = 200;
/** Upper bound on the tokens the model may write per response. */
export const DEFAULT_WORKFLOW_CHAT_MAX_OUTPUT_TOKENS = 4_096;

export interface WorkflowChatRouteOptions {
  /**
   * Whether the route serves at all. Absent: `BPM_AI_ASSISTANT_ENABLED` is
   * read on every request and must be `'true'`. A disabled route answers 404.
   */
  readonly enabled?: boolean | (() => boolean);
  /**
   * The host's check that the caller may use the assistant (a session, a
   * designer permission). Called before the body is read; `false` (or a
   * throw) answers 401. Absent: no check, so put the route behind the host's
   * own authentication.
   */
  readonly authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Request body ceiling in bytes (413 above it). */
  readonly maxRequestBytes?: number;
  /** Message count ceiling (413 above it). */
  readonly maxMessages?: number;
  /** Output token ceiling passed to the model. */
  readonly maxOutputTokens?: number;
  /** Override the OpenAI model id (else BPM_LLM_MODEL env, else the default). */
  readonly model?: string;
  /** Override the system prompt (else the strict design-only guardrail). */
  readonly system?: string;
}

const plainResponse = (status: number, text: string): Response =>
  new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status,
  });

function isEnabled(enabled: WorkflowChatRouteOptions['enabled']): boolean {
  if (typeof enabled === 'function') {
    return enabled();
  }

  return enabled ?? process.env.BPM_AI_ASSISTANT_ENABLED === 'true';
}

async function isAuthorized(
  request: Request,
  authorize: WorkflowChatRouteOptions['authorize'],
): Promise<boolean> {
  if (!authorize) {
    return true;
  }

  try {
    return (await authorize(request)) === true;
  } catch {
    return false;
  }
}

function isUIMessage(value: unknown): value is UIMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly role?: unknown }).role === 'string' &&
    Array.isArray((value as { readonly parts?: unknown }).parts)
  );
}

type ReadMessagesResult =
  | { readonly messages: readonly UIMessage[]; readonly ok: true }
  | { readonly ok: false; readonly response: Response };

/**
 * The request body as text, or `null` once it grows past `maxBytes`; reading
 * stops (and the stream is cancelled) at that point.
 */
async function readBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (request.body === null) {
    return '';
  }

  const reader = request.body.getReader();
  // Local to this read and appended in place: copying the list per chunk
  // would make a body of many tiny chunks quadratic.
  const chunks: Uint8Array[] = [];

  const readWithin = async (total: number): Promise<number | null> => {
    const { done, value } = await reader.read();

    if (done) {
      return total;
    }

    const nextTotal = total + value.byteLength;

    if (nextTotal > maxBytes) {
      await reader.cancel().catch((): void => undefined);

      return null;
    }

    chunks.push(value);

    return readWithin(nextTotal);
  };

  const total = await readWithin(0);

  if (total === null) {
    return null;
  }

  const bytes = new Uint8Array(total);

  chunks.reduce((offset, chunk): number => {
    bytes.set(chunk, offset);

    return offset + chunk.byteLength;
  }, 0);

  return new TextDecoder().decode(bytes);
}

/**
 * The client's messages, bounded and without any `system` message: the
 * system prompt is the route's alone. The body is read as text first so its
 * size is checked before anything is parsed.
 */
export async function readWorkflowChatMessages(
  request: Request,
  limits: Readonly<{ maxMessages: number; maxRequestBytes: number }>,
): Promise<ReadMessagesResult> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');

  if (declaredLength > limits.maxRequestBytes) {
    return { ok: false, response: plainResponse(413, 'Request too large') };
  }

  // A chunked request declares no length: read it with the limit applied as
  // it arrives, so an oversized body is cut off instead of buffered whole.
  const text = await readBodyWithinLimit(request, limits.maxRequestBytes);

  if (text === null) {
    return { ok: false, response: plainResponse(413, 'Request too large') };
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, response: plainResponse(400, 'Invalid request') };
  }

  const messages: unknown =
    typeof body === 'object' && body !== null
      ? (body as { readonly messages?: unknown }).messages
      : undefined;

  if (!Array.isArray(messages) || !messages.every(isUIMessage)) {
    return { ok: false, response: plainResponse(400, 'Invalid request') };
  }

  if (messages.length > limits.maxMessages) {
    return { ok: false, response: plainResponse(413, 'Too many messages') };
  }

  return {
    messages: messages.filter((message) => message.role !== 'system'),
    ok: true,
  };
}

/** Create the `POST` handler for the workflow chat route. */
export function createWorkflowChatPOST(
  options: WorkflowChatRouteOptions = {},
): (request: Request) => Promise<Response> {
  const tools = buildWorkflowAiSdkTools();

  return async function POST(request: Request): Promise<Response> {
    if (!isEnabled(options.enabled)) {
      return plainResponse(404, 'Not Found');
    }

    if (!(await isAuthorized(request, options.authorize))) {
      return plainResponse(401, 'Unauthorized');
    }

    const read = await readWorkflowChatMessages(request, {
      maxMessages: options.maxMessages ?? DEFAULT_WORKFLOW_CHAT_MAX_MESSAGES,
      maxRequestBytes:
        options.maxRequestBytes ?? DEFAULT_WORKFLOW_CHAT_MAX_REQUEST_BYTES,
    });

    if (!read.ok) {
      return read.response;
    }

    const result = streamText({
      maxOutputTokens:
        options.maxOutputTokens ?? DEFAULT_WORKFLOW_CHAT_MAX_OUTPUT_TOKENS,
      messages: await convertToModelMessages([...read.messages]),
      model: resolveModel(
        options.model ?? process.env.BPM_LLM_MODEL ?? DEFAULT_MODEL,
      ),
      system: options.system ?? WORKFLOW_CHAT_SYSTEM_PROMPT,
      tools,
    });

    return result.toUIMessageStreamResponse();
  };
}
