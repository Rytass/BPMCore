import {
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BPM_AUTH_MODULE_OPTIONS,
  BPMAuthContext,
  BPMAuthContextAccessor,
} from './bpm-auth-context';
import { extractBPMAuthContext } from './bpm-auth-context.extractor';
import { BPMAuthModuleOptions } from './bpm-auth.options';

@Injectable()
export class ConfigurableBPMAuthContextAccessor implements BPMAuthContextAccessor {
  constructor(
    @Inject(BPM_AUTH_MODULE_OPTIONS)
    private readonly options: BPMAuthModuleOptions,
  ) {}

  async assertAuthenticated(
    context?: ExecutionContext,
  ): Promise<BPMAuthContext> {
    const authContext = await this.getCurrentContext(context);

    if (!authContext?.memberId.trim()) {
      throw new UnauthorizedException('BPM authentication is required');
    }

    return authContext;
  }

  async getCurrentContext(
    context?: ExecutionContext,
  ): Promise<BPMAuthContext | null> {
    const extractedContext = extractBPMAuthContext(context);

    if (extractedContext) {
      return extractedContext;
    }

    if (this.options.contextFactory) {
      return this.options.contextFactory(context);
    }

    return null;
  }

  async getCurrentMemberId(context?: ExecutionContext): Promise<string> {
    const authContext = await this.assertAuthenticated(context);

    return authContext.memberId;
  }
}
