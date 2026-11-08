/**
 * @jest-environment node
 */
import type { UIMessage } from 'ai';

const streamTextMock = jest.fn();

jest.mock('ai', () => {
  const actual = jest.requireActual<typeof import('ai')>('ai');

  return {
    ...actual,
    streamText: (options: unknown): unknown => {
      streamTextMock(options);

      return {
        toUIMessageStreamResponse: (): Response => new Response('streamed'),
      };
    },
  };
});

jest.mock('@ai-sdk/openai', () => ({
  openai: (modelId: string): Readonly<{ modelId: string }> => ({ modelId }),
}));

// Imported after the mocks.
import {
  createBPMApiSessionAuthorize,
  createWorkflowChatPOST,
  resolveBPMApiSessionBaseUrl,
} from './workflow-chat-route';

const SESSION_COOKIE = 'bpm_api_session=signed.token';
const MEMBER = {
  email: 'a@example.test',
  expiresAt: '2026-12-31T00:00:00.000Z',
  memberId: 'member-101',
  name: 'A',
  permissions: [],
  roles: [],
};

const userMessage: UIMessage = {
  id: 'm-1',
  parts: [{ text: '畫一個簽核流程', type: 'text' }],
  role: 'user',
};

const chatRequest = (
  url = 'http://localhost:3000/api/chat',
  cookie: string | null = SESSION_COOKIE,
): Request =>
  new Request(url, {
    body: JSON.stringify({ messages: [userMessage] }),
    headers: {
      'Content-Type': 'application/json',
      ...(cookie === null ? {} : { Cookie: cookie }),
    },
    method: 'POST',
  });

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

type FetchMock = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

const createFetch = (
  answer: () => Promise<Response> = (): Promise<Response> =>
    Promise.resolve(jsonResponse(200, MEMBER)),
): FetchMock => jest.fn<Promise<Response>, Parameters<typeof fetch>>(answer);

const ENV_KEYS = [
  'BPM_AI_ASSISTANT_ENABLED',
  'BPM_API_INTERNAL_URL',
  'NODE_ENV',
  'NEXT_PUBLIC_API_AUTH_URL',
  'NEXT_PUBLIC_API_URL',
] as const;

describe('createBPMApiSessionAuthorize (Phase 23 /api/chat authorize)', (): void => {
  const original = Object.fromEntries(
    ENV_KEYS.map((key): readonly [string, string | undefined] => [
      key,
      process.env[key],
    ]),
  );

  beforeEach((): void => {
    streamTextMock.mockReset();
    ENV_KEYS.forEach((key): void => {
      delete process.env[key];
    });
  });

  afterAll((): void => {
    ENV_KEYS.forEach((key): void => {
      const value = original[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('asks the local API session endpoint with only the cookie, and lets a signed-in member in', async (): Promise<void> => {
    const fetchMock = createFetch();
    const request = chatRequest();

    request.headers.set('Authorization', 'Bearer should-not-be-forwarded');

    await expect(
      createBPMApiSessionAuthorize({ fetch: fetchMock })(request),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('http://localhost:17603/auth/me');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      Cookie: SESSION_COOKIE,
    });
  });

  it('refuses without asking when the request carries no cookie', async (): Promise<void> => {
    const fetchMock = createFetch();

    await expect(
      createBPMApiSessionAuthorize({ fetch: fetchMock })(
        chatRequest(undefined, null),
      ),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a 401', (): Promise<Response> => Promise.resolve(jsonResponse(401, { message: 'no' }))],
    ['a redirect', (): Promise<Response> => Promise.resolve(new Response(null, { status: 302 }))],
    ['a 200 that names no member', (): Promise<Response> => Promise.resolve(jsonResponse(200, { ok: true }))],
    ['a 200 that is not JSON', (): Promise<Response> => Promise.resolve(new Response('<html></html>', { status: 200 }))],
    ['a network error', (): Promise<Response> => Promise.reject(new Error('ECONNREFUSED'))],
  ])('refuses on %s', async (_name, answer): Promise<void> => {
    await expect(
      createBPMApiSessionAuthorize({ fetch: createFetch(answer) })(
        chatRequest(),
      ),
    ).resolves.toBe(false);
  });

  it('refuses when the API does not answer in time', async (): Promise<void> => {
    const fetchMock = createFetch();

    fetchMock.mockImplementation(
      (_url, init): Promise<Response> =>
        new Promise((_resolve, reject): void => {
          init?.signal?.addEventListener('abort', (): void => {
            reject(new Error('aborted'));
          });
        }),
    );

    await expect(
      createBPMApiSessionAuthorize({ fetch: fetchMock, timeoutMs: 10 })(
        chatRequest(),
      ),
    ).resolves.toBe(false);
  });

  describe('resolveBPMApiSessionBaseUrl', (): void => {
    const setNodeEnv = (value: string): void => {
      (process.env as Record<string, string | undefined>).NODE_ENV = value;
    };

    it('falls back to the local API port outside production', (): void => {
      setNodeEnv('development');
      expect(resolveBPMApiSessionBaseUrl()).toBe('http://localhost:17603');
    });

    it('resolves nothing in production without configuration', (): void => {
      setNodeEnv('production');
      expect(resolveBPMApiSessionBaseUrl()).toBeNull();
    });

    it('follows configuration: explicit base, internal URL, auth URL, then the GraphQL origin', (): void => {
      setNodeEnv('production');
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test/graphql';
      expect(resolveBPMApiSessionBaseUrl()).toBe('https://api.example.test');

      process.env.NEXT_PUBLIC_API_AUTH_URL = 'https://auth.example.test/';
      expect(resolveBPMApiSessionBaseUrl()).toBe('https://auth.example.test');

      process.env.BPM_API_INTERNAL_URL = 'http://bpm-api.internal:17603';
      expect(resolveBPMApiSessionBaseUrl()).toBe('http://bpm-api.internal:17603');

      expect(resolveBPMApiSessionBaseUrl('http://explicit.internal')).toBe(
        'http://explicit.internal',
      );
    });

    it('ignores relative and non-http settings', (): void => {
      setNodeEnv('production');
      process.env.NEXT_PUBLIC_API_URL = '/graphql';
      process.env.NEXT_PUBLIC_API_AUTH_URL = 'file:///etc/passwd';
      expect(resolveBPMApiSessionBaseUrl('/api')).toBeNull();
    });
  });

  describe('never derives the API from the request', (): void => {
    it.each([
      ['a spoofed Host header', { Host: 'attacker.example.test' }],
      ['a forwarded host', { 'X-Forwarded-Host': 'attacker.example.test' }],
    ])('ignores %s', async (_name, headers): Promise<void> => {
      const fetchMock = createFetch();
      const request = chatRequest('https://attacker.example.test/api/chat');

      Object.entries(headers).forEach(([key, value]): void => {
        request.headers.set(key, value);
      });
      process.env.NEXT_PUBLIC_API_AUTH_URL = 'https://bpm.example.test';

      await expect(
        createBPMApiSessionAuthorize({ fetch: fetchMock })(request),
      ).resolves.toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe('https://bpm.example.test/auth/me');
    });

    it('refuses without asking in production when nothing is configured', async (): Promise<void> => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const fetchMock = createFetch();

      await expect(
        createBPMApiSessionAuthorize({ fetch: fetchMock })(
          chatRequest('https://bpm.example.test/api/chat'),
        ),
      ).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('wired into createWorkflowChatPOST', (): void => {
    beforeEach((): void => {
      process.env.BPM_AI_ASSISTANT_ENABLED = 'true';
    });

    it('answers 401 without a session and never runs the model', async (): Promise<void> => {
      const POST = createWorkflowChatPOST({
        authorize: createBPMApiSessionAuthorize({
          fetch: createFetch(() =>
            Promise.resolve(jsonResponse(401, { message: 'no' })),
          ),
        }),
      });

      const signedOut = await POST(chatRequest());
      const noCookie = await POST(chatRequest(undefined, null));

      expect(signedOut.status).toBe(401);
      expect(noCookie.status).toBe(401);
      expect(streamTextMock).not.toHaveBeenCalled();
    });

    it('streams for a signed-in member', async (): Promise<void> => {
      const POST = createWorkflowChatPOST({
        authorize: createBPMApiSessionAuthorize({ fetch: createFetch() }),
      });

      const response = await POST(chatRequest());

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('streamed');
      expect(streamTextMock).toHaveBeenCalledTimes(1);
    });

    it('still answers 404 before asking anyone when the assistant is disabled', async (): Promise<void> => {
      process.env.BPM_AI_ASSISTANT_ENABLED = 'false';
      const fetchMock = createFetch();
      const POST = createWorkflowChatPOST({
        authorize: createBPMApiSessionAuthorize({ fetch: fetchMock }),
      });

      expect((await POST(chatRequest())).status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
