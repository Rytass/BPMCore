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
import { attachBPMAuthContext } from './bpm-auth-context.extractor';

@Injectable()
export class BPMAuthenticatedGuard implements CanActivate {
  constructor(
    @Inject(BPM_AUTH_CONTEXT_ACCESSOR)
    private readonly authContextAccessor: BPMAuthContextAccessor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authContext = await readAuthenticatedBPMContext(
      this.authContextAccessor,
      context,
    );

    attachBPMAuthContext(context, authContext);

    return true;
  }
}
