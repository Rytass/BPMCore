/**
 * @jest-environment node
 */

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

// The lib's source, not its built `dist` (which jest would otherwise resolve
// through the package exports and which may predate this change).
jest.mock('@rytass/bpm-core-react/next/workflow-chat-route', () =>
  jest.requireActual<
    typeof import('../../../libs/bpm-core-react/src/next/workflow-chat-route')
  >('../../../libs/bpm-core-react/src/next/workflow-chat-route'),
);

// Imported after the mocks.
import { POST } from './app/api/chat/route';

/**
 * The host's `/api/chat` wiring: the route asks the BPM API whether the
 * caller is signed in (`GET /auth/me` with the request's cookie) before it
 * reads the body or runs the model.
 */

const chatRequest = (cookie: string | null): Request =>
  new Request('http://localhost:3000/api/chat', {
    body: JSON.stringify({
      messages: [{ id: 'm-1', parts: [{ text: 'hi', type: 'text' }], role: 'user' }],
    }),
    headers: {
      'Content-Type': 'application/json',
      ...(cookie === null ? {} : { Cookie: cookie }),
    },
    method: 'POST',
  });

describe('apps/client /api/chat', (): void => {
  const originalEnabled = process.env.BPM_AI_ASSISTANT_ENABLED;
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

  beforeEach((): void => {
    process.env.BPM_AI_ASSISTANT_ENABLED = 'true';
    streamTextMock.mockReset();
    fetchMock.mockReset();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  afterAll((): void => {
    if (originalEnabled === undefined) {
      delete process.env.BPM_AI_ASSISTANT_ENABLED;
    } else {
      process.env.BPM_AI_ASSISTANT_ENABLED = originalEnabled;
    }
  });

  it('answers 401 to a caller the API does not know, without running the model', async (): Promise<void> => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'BPM API session is required' }), {
        status: 401,
      }),
    );

    const response = await POST(chatRequest('bpm_api_session=expired'));

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:17603/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'bpm_api_session=expired' }),
      }),
    );
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a cookie and asks nobody', async (): Promise<void> => {
    const response = await POST(chatRequest(null));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a signed-in member', async (): Promise<void> => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ memberId: 'member-101' }), { status: 200 }),
    );

    const response = await POST(chatRequest('bpm_api_session=valid'));

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });
});
