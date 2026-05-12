import { ExecutionContext, InjectionToken } from '@nestjs/common';
import type { ModuleMetadata } from '@nestjs/common/interfaces';
import { BPMAuthContext } from './bpm-auth-context';

export type BPMAuthContextFactory = (
  context?: ExecutionContext,
) => BPMAuthContext | null | Promise<BPMAuthContext | null>;

export interface BPMAuthModuleOptions {
  readonly contextFactory?: BPMAuthContextFactory;
}

export interface BPMAuthModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: readonly InjectionToken[];
  readonly useFactory: (
    ...args: readonly unknown[]
  ) => BPMAuthModuleOptions | Promise<BPMAuthModuleOptions>;
}
