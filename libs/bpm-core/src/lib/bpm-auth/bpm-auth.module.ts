import { DynamicModule, Module } from '@nestjs/common';
import {
  BPM_AUTH_CONTEXT_ACCESSOR,
  BPM_AUTH_MODULE_OPTIONS,
} from './bpm-auth-context';
import {
  BPMAuthModuleAsyncOptions,
  BPMAuthModuleOptions,
} from './bpm-auth.options';
import { BPMAuthenticatedGuard } from './bpm-auth.guard';
import { BPMAdminGuard } from './bpm-auth.authorization';
import { ConfigurableBPMAuthContextAccessor } from './configurable-bpm-auth-context.accessor';

@Module({})
export class BPMAuthModule {
  static forRoot(options: BPMAuthModuleOptions = {}): DynamicModule {
    return {
      exports: [
        BPM_AUTH_CONTEXT_ACCESSOR,
        BPMAdminGuard,
        BPMAuthenticatedGuard,
      ],
      global: true,
      module: BPMAuthModule,
      providers: [
        {
          provide: BPM_AUTH_MODULE_OPTIONS,
          useValue: options,
        },
        {
          provide: BPM_AUTH_CONTEXT_ACCESSOR,
          useClass: ConfigurableBPMAuthContextAccessor,
        },
        BPMAdminGuard,
        BPMAuthenticatedGuard,
      ],
    };
  }

  static forRootAsync(options: BPMAuthModuleAsyncOptions): DynamicModule {
    return {
      exports: [
        BPM_AUTH_CONTEXT_ACCESSOR,
        BPMAdminGuard,
        BPMAuthenticatedGuard,
      ],
      global: true,
      imports: options.imports,
      module: BPMAuthModule,
      providers: [
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_AUTH_MODULE_OPTIONS,
          useFactory: options.useFactory,
        },
        {
          provide: BPM_AUTH_CONTEXT_ACCESSOR,
          useClass: ConfigurableBPMAuthContextAccessor,
        },
        BPMAdminGuard,
        BPMAuthenticatedGuard,
      ],
    };
  }
}
