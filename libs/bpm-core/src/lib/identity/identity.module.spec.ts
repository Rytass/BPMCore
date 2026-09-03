import { Provider } from '@nestjs/common';
import { IdentityModule } from './identity.module';
import { IdentityQueries } from './identity.queries';
import { IdentityService } from './identity.service';
import { BPM_MEMBER_RESOLVER } from './member-resolver.interface';

const memberResolverProvider: Provider = {
  provide: BPM_MEMBER_RESOLVER,
  useValue: {},
};

describe('IdentityModule', () => {
  it('registers the identity GraphQL queries by default', (): void => {
    const dynamicModule = IdentityModule.forRoot({ memberResolverProvider });

    expect(dynamicModule.providers).toContain(IdentityQueries);
  });

  it('omits the identity GraphQL queries when the host turns them off', (): void => {
    // A host that already publishes `member` / `members` cannot mount BPM at
    // all while these are registered — `@nestjs/graphql` refuses to build a
    // schema with two fields of the same name.
    const dynamicModule = IdentityModule.forRoot({
      identityRegisterResolvers: false,
      memberResolverProvider,
    });

    expect(dynamicModule.providers).not.toContain(IdentityQueries);
    // The service stays: the rest of BPM resolves members through it.
    expect(dynamicModule.providers).toContain(IdentityService);
    expect(dynamicModule.exports).toContain(IdentityService);
  });

  it('honours the toggle through forRootAsync as well', (): void => {
    const dynamicModule = IdentityModule.forRootAsync({
      identityRegisterResolvers: false,
      memberResolverProvider,
      useFactory: () => ({}),
    });

    expect(dynamicModule.providers).not.toContain(IdentityQueries);
    expect(dynamicModule.providers).toContain(IdentityService);
  });
});
