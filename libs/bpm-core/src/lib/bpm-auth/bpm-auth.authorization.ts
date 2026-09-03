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
import { withBPMResolverAccess } from './bpm-resolver-access.decorator';

const ADMIN_PERMISSIONS = new Set([
  'bpm:*',
  'bpm:admin',
  'bpm.admin',
  'bpm:admin:*',
]);
const DESIGNER_PERMISSIONS = new Set([
  'bpm:*',
  'bpm:admin',
  'bpm.admin',
  'bpm:admin:*',
  'bpm:design',
  'bpm.design',
  'bpm.form.design',
  'bpm.template.design',
  'bpm:form:design',
  'bpm:template:design',
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

@Injectable()
export class BPMDesignerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const authContext = extractBPMAuthContext(context);

    if (authContext && isBPMDesigner(authContext)) {
      return true;
    }

    throw new ForbiddenException('BPM designer permission is required');
  }
}

export const BPMAdminOnly = (): ClassDecorator & MethodDecorator =>
  withBPMResolverAccess(
    'admin',
    UseGuards(BPMAuthenticatedGuard, BPMAdminGuard),
  );

export const BPMDesignerOnly = (): ClassDecorator & MethodDecorator =>
  withBPMResolverAccess(
    'designer',
    UseGuards(BPMAuthenticatedGuard, BPMDesignerGuard),
  );

export function isBPMAdmin(authContext: BPMAuthContext): boolean {
  return (
    authContext.roles.includes('BPM_ADMIN') ||
    authContext.permissions.some((permission) =>
      ADMIN_PERMISSIONS.has(permission),
    )
  );
}

export function isBPMDesigner(authContext: BPMAuthContext): boolean {
  return (
    isBPMAdmin(authContext) ||
    authContext.roles.includes('BPM_DESIGNER') ||
    authContext.permissions.some((permission) =>
      DESIGNER_PERMISSIONS.has(permission),
    )
  );
}
