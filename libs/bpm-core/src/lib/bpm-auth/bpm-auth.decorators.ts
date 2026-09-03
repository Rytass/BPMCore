import {
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { BPMAuthenticatedGuard } from './bpm-auth.guard';
import { extractBPMAuthContext } from './bpm-auth-context.extractor';
import { withBPMResolverAccess } from './bpm-resolver-access.decorator';

export const BPMAuthenticated = (): ClassDecorator & MethodDecorator =>
  withBPMResolverAccess('authenticated', UseGuards(BPMAuthenticatedGuard));

export const BPMCurrentAuthContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => extractBPMAuthContext(context),
);

export const BPMCurrentMemberId = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    extractBPMAuthContext(context)?.memberId ?? null,
);
