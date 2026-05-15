import {
  DynamicModule,
  Global,
  InjectionToken,
  Module,
  Provider,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BPMRootSignatureOptions,
  BPM_SIGNATURE_OPTIONS,
  resolveBPMSignatureOptions,
} from './signature-options';
import { SignatureEntity } from './signature.entity';
import { SignatureQueries } from './signature.queries';
import { SignatureService } from './signature.service';

export interface SignatureModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: readonly InjectionToken[];
  readonly useFactory: (
    ...args: readonly unknown[]
  ) => BPMRootSignatureOptions | Promise<BPMRootSignatureOptions>;
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SignatureEntity])],
  providers: [SignatureQueries, SignatureService],
  exports: [SignatureService],
})
export class SignatureModule {
  static forRoot(options: BPMRootSignatureOptions = {}): DynamicModule {
    return {
      exports: [BPM_SIGNATURE_OPTIONS, SignatureService],
      imports: [TypeOrmModule.forFeature([SignatureEntity])],
      module: SignatureModule,
      providers: [
        SignatureQueries,
        SignatureService,
        createSignatureOptionsProvider(options),
      ],
    };
  }

  static forRootAsync(options: SignatureModuleAsyncOptions): DynamicModule {
    return {
      exports: [BPM_SIGNATURE_OPTIONS, SignatureService],
      imports: [
        ...(options.imports ?? []),
        TypeOrmModule.forFeature([SignatureEntity]),
      ],
      module: SignatureModule,
      providers: [
        SignatureQueries,
        SignatureService,
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_SIGNATURE_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<ReturnType<typeof resolveBPMSignatureOptions>> =>
            resolveBPMSignatureOptions(await options.useFactory(...args)),
        },
      ],
    };
  }
}

function createSignatureOptionsProvider(
  options: BPMRootSignatureOptions = {},
): Provider {
  return {
    provide: BPM_SIGNATURE_OPTIONS,
    useValue: resolveBPMSignatureOptions(options),
  };
}
