import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

interface RequestLike {
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly protocol?: string;
}

interface RequestCarrier {
  readonly req?: RequestLike;
}

const HOST_PATTERN =
  /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/u;

/**
 * Origin (`<protocol>://<host>`) the client reached this API on, used to build
 * signed attachment URLs when the host configured no public base URL.
 *
 * Proxy headers win over the socket's own values, because behind an ingress
 * the socket sees plain HTTP on an internal address. Only the first value of a
 * comma-separated proxy header is read — the one the outermost proxy set — and
 * a value that is not a bare host or not `http` / `https` is ignored, so a
 * crafted header cannot inject a path or a scheme into the URL. A forged
 * `Host` only changes the URL returned to the client that sent it.
 */
export function readAttachmentRequestOrigin(
  request: RequestLike | undefined,
): string | null {
  if (!request) {
    return null;
  }

  const host =
    readFirstHeaderValue(request, 'x-forwarded-host') ??
    readFirstHeaderValue(request, 'host');
  const protocol = (
    readFirstHeaderValue(request, 'x-forwarded-proto') ??
    request.protocol ??
    'http'
  ).toLowerCase();

  if (!host || !HOST_PATTERN.test(host)) {
    return null;
  }

  if (protocol !== 'http' && protocol !== 'https') {
    return null;
  }

  return `${protocol}://${host}`;
}

/** Resolver parameter carrying {@link readAttachmentRequestOrigin}. */
export const BPMAttachmentRequestOrigin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null =>
    readAttachmentRequestOrigin(readRequest(context)),
);

function readRequest(context: ExecutionContext): RequestLike | undefined {
  if (context.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<
      RequestCarrier | undefined
    >()?.req;
  }

  return context.switchToHttp().getRequest<RequestLike | undefined>();
}

function readFirstHeaderValue(
  request: RequestLike,
  name: string,
): string | null {
  const value = request.headers?.[name];
  const firstValue = (Array.isArray(value) ? value[0] : value)
    ?.split(',')[0]
    ?.trim();

  return firstValue || null;
}
