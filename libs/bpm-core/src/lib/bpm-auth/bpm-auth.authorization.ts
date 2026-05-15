import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { BPMAuthContext } from './bpm-auth-context';
import { extractBPMAuthContext } from './bpm-auth-context.extractor';
import { BPMAuthenticatedGuard } from './bpm-auth.guard';

const ADMIN_PERMISSIONS = new Set([
  'bpm:*',
  'bpm:admin',
  'bpm.admin',
  'bpm:admin:*',
]);

@Injectable()
export class BPMAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const authContext = extractBPMAuthContext(context);

    if (authContext && isBPMAdmin(authContext)) {
      return true;
    }

    throw new ForbiddenException('BPM admin permission is required');
  }
}

export const BPMAdminOnly = (): ClassDecorator & MethodDecorator =>
  UseGuards(BPMAuthenticatedGuard, BPMAdminGuard);

export function isBPMAdmin(authContext: BPMAuthContext): boolean {
  return (
    authContext.roles.includes('BPM_ADMIN') ||
    authContext.permissions.some((permission) =>
      ADMIN_PERMISSIONS.has(permission),
    )
  );
}
