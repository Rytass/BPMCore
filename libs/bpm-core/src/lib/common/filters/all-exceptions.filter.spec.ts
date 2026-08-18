import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedResponse {
  readonly body: () => Record<string, unknown> | null;
  readonly response: unknown;
  readonly statusCode: () => number | null;
}

describe('AllExceptionsFilter', () => {
  it('keeps the status an HttpException declares', () => {
    const captured = createCapturedResponse();

    new AllExceptionsFilter().catch(
      new NotFoundException('nope'),
      createHost(captured),
    );

    expect(captured.statusCode()).toBe(404);
    expect(captured.body()?.message).toBe('nope');
  });

  // Express body parsers reject with a plain `Error` that already carries the
  // status it means. Reporting those as 500 blamed the server for what the
  // request did wrong.
  it('adopts the status of an exposed 4xx rejection', () => {
    const captured = createCapturedResponse();

    new AllExceptionsFilter().catch(
      Object.assign(new Error('request entity too large'), {
        expose: true,
        status: 413,
      }),
      createHost(captured),
    );

    expect(captured.statusCode()).toBe(413);
  });

  // An HTTP client added later attaches the *upstream* response status to its
  // rejection without `expose`. Trusting that would let a remote service decide
  // what this API answers, so an unflagged status is ignored.
  it('ignores a status that does not opt in through `expose`', () => {
    const captured = createCapturedResponse();

    new AllExceptionsFilter().catch(
      Object.assign(new Error('upstream said 404'), { status: 404 }),
      createHost(captured),
    );

    expect(captured.statusCode()).toBe(500);
  });

  it.each([500, 502, 503])(
    'ignores an exposed %i because only 4xx may be adopted',
    (status) => {
      const captured = createCapturedResponse();

      new AllExceptionsFilter().catch(
        Object.assign(new Error('upstream failure'), { expose: true, status }),
        createHost(captured),
      );

      expect(captured.statusCode()).toBe(500);
    },
  );

  it('reads `statusCode` when `status` is absent', () => {
    const captured = createCapturedResponse();

    new AllExceptionsFilter().catch(
      Object.assign(new Error('unsupported media type'), {
        expose: true,
        statusCode: 415,
      }),
      createHost(captured),
    );

    expect(captured.statusCode()).toBe(415);
  });

  it.each([399, 600, 404.5, Number.NaN])(
    'rejects %s as an out-of-range or non-integer status',
    (status) => {
      const captured = createCapturedResponse();

      new AllExceptionsFilter().catch(
        Object.assign(new Error('bogus'), { expose: true, status }),
        createHost(captured),
      );

      expect(captured.statusCode()).toBe(500);
    },
  );

  it('falls back to 500 for a plain error and labels it as such', () => {
    const captured = createCapturedResponse();

    new AllExceptionsFilter().catch(new Error('boom'), createHost(captured));

    expect(captured.statusCode()).toBe(500);
    expect(captured.body()?.error).toBe('Internal Server Error');
  });

  it('labels an adopted client status as a request error', () => {
    const captured = createCapturedResponse();

    new AllExceptionsFilter().catch(
      new BadRequestException('bad'),
      createHost(captured),
    );

    expect(captured.body()?.error).toBe('Request Error');
  });

  // GraphQL executions have no writable HTTP response; the exception has to
  // keep travelling so Apollo can format it.
  it('rethrows when the host has no writable HTTP response', () => {
    const exception = new Error('graphql');

    expect(() =>
      new AllExceptionsFilter().catch(exception, createHost(null)),
    ).toThrow(exception);
  });
});

function createCapturedResponse(): CapturedResponse {
  const state: {
    body: Record<string, unknown> | null;
    statusCode: number | null;
  } = { body: null, statusCode: null };
  const response = {
    json: (body: Record<string, unknown>): unknown => {
      state.body = body;

      return response;
    },
    status: (statusCode: number): unknown => {
      state.statusCode = statusCode;

      return response;
    },
  };

  return {
    body: (): Record<string, unknown> | null => state.body,
    response,
    statusCode: (): number | null => state.statusCode,
  };
}

function createHost(captured: CapturedResponse | null): ArgumentsHost {
  return {
    getType: (): string => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ url: '/probe' }),
      getResponse: () => captured?.response,
    }),
  } as unknown as ArgumentsHost;
}
