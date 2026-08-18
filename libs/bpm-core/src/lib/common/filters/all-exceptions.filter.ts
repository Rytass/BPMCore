import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface HttpRequestLike {
  readonly url?: string;
}

interface HttpResponseLike {
  readonly json?: (body: ErrorResponseBody) => unknown;
  readonly status?: (statusCode: number) => HttpResponseLike;
}

interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
  readonly path: string;
  readonly statusCode: number;
  readonly timestamp: string;
}

/**
 * Global Nest exception filter that normalizes both HTTP and GraphQL error
 * responses into a consistent JSON body with `statusCode`, `error`,
 * `message`, `path`, and `timestamp`.
 *
 * Wire it from your bootstrap:
 *
 * ```ts
 * import { AllExceptionsFilter } from '@rytass/bpm-core-nestjs-module';
 *
 * app.useGlobalFilters(new AllExceptionsFilter());
 * ```
 *
 * Hosts that already have a custom global filter can keep their own; this
 * filter is provided as a convenience and is not required by BPM.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response | undefined>();
    const request = context.getRequest<HttpRequestLike | undefined>();

    if (!this.isWritableHttpResponse(response)) {
      throw exception;
    }

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : // Body parsers and other Express middleware reject with a plain
          // `Error` that still carries the status they mean — `413` for an
          // oversized payload, say. Reporting those as `500` would blame the
          // server for what the request did wrong.
          (this.readHttpStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const message = this.resolveMessage(exception);
    const body: ErrorResponseBody = {
      error:
        statusCode === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal Server Error'
          : 'Request Error',
      message,
      path: request?.url ?? host.getType<string>(),
      statusCode,
      timestamp: new Date().toISOString(),
    };

    if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        message,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json(body);
  }

  private isWritableHttpResponse(
    response: Response | undefined,
  ): response is Response {
    const candidate = response as HttpResponseLike | undefined;

    return (
      typeof candidate?.status === 'function' &&
      typeof candidate.json === 'function'
    );
  }

  /**
   * Reads a usable HTTP status off a non-`HttpException` rejection.
   *
   * Restricted to 4xx errors that opt in through `http-errors`' `expose: true`
   * — the convention Express body parsers follow — so only an error that
   * already declares itself safe to report can set the status. An HTTP client
   * added later (axios and friends) attaches the *upstream* response's status
   * to its rejection without that flag; trusting those would let a remote
   * service dictate what this API answers.
   */
  private readHttpStatus(exception: unknown): number | null {
    if (typeof exception !== 'object' || exception === null) {
      return null;
    }

    const candidate = exception as {
      readonly expose?: unknown;
      readonly status?: unknown;
      readonly statusCode?: unknown;
    };

    if (candidate.expose !== true) {
      return null;
    }

    const status =
      typeof candidate.status === 'number'
        ? candidate.status
        : typeof candidate.statusCode === 'number'
          ? candidate.statusCode
          : null;

    return status !== null &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 499
      ? status
      : null;
  }

  private resolveMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      if (this.hasMessageArray(response)) {
        return response.message.join(', ');
      }

      if (this.hasMessage(response)) {
        return response.message;
      }
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'Unexpected error';
  }

  private hasMessage(value: unknown): value is { readonly message: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'message' in value &&
      typeof value.message === 'string'
    );
  }

  private hasMessageArray(
    value: unknown,
  ): value is { readonly message: readonly string[] } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'message' in value &&
      Array.isArray(value.message) &&
      value.message.every((item) => typeof item === 'string')
    );
  }
}
