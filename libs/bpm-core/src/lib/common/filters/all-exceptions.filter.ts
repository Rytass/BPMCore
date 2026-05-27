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
        : HttpStatus.INTERNAL_SERVER_ERROR;
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
