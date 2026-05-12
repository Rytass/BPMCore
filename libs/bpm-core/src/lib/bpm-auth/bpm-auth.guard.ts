import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  BPM_AUTH_CONTEXT_ACCESSOR,
  BPMAuthContextAccessor,
  readAuthenticatedBPMContext,
} from './bpm-auth-context';

@Injectable()
export class BPMAuthenticatedGuard implements CanActivate {
  constructor(
    @Inject(BPM_AUTH_CONTEXT_ACCESSOR)
    private readonly authContextAccessor: BPMAuthContextAccessor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await readAuthenticatedBPMContext(this.authContextAccessor, context);

    return true;
  }
}
