import 'reflect-metadata';
import { Query, Resolver } from '@nestjs/graphql';
// The package root, so the registry holds every BPM resolver rather than the
// three this file names — which is what makes the count assertion meaningful.
import '../../index';
import { BPMAdminOnly } from './bpm-auth.authorization';
import { IdentityQueries } from '../identity/identity.queries';
import { OrganizationMutations } from '../organization/organization.mutations';
import { OrganizationQueries } from '../organization/organization.queries';
import {
  applyBPMResolverMetadata,
  BPMResolverHandlerDescriptor,
  listBPMResolverHandlers,
} from './bpm-resolver-metadata';

const HOST_PERMISSION_KEY = 'host:permission';

/**
 * Stands in for a resolver that grew a private helper. The listing must offer
 * `listThings` and never `buildThingFilter`: a host turns this listing into
 * permission rules, and a helper appearing there is a rule for a GraphQL field
 * that does not exist.
 */
@Resolver()
@BPMAdminOnly()
class ProbeResolver {
  @Query(() => String)
  listThings(): string {
    return this.buildThingFilter();
  }

  buildThingFilter(): string {
    return '';
  }
}

describe('BPM resolver metadata', () => {
  it('lists every guarded BPM handler with the authority BPM requires', (): void => {
    const handlers = listBPMResolverHandlers();
    const find = (
      resolverName: string,
      methodName: string,
    ): BPMResolverHandlerDescriptor | undefined =>
      handlers.find(
        (handler): boolean =>
          handler.resolverName === resolverName &&
          handler.methodName === methodName,
      );

    expect(find('OrganizationQueries', 'orgUnits')?.access).toBe('admin');
    expect(find('OrganizationMutations', 'deletePosition')?.access).toBe(
      'admin',
    );
    // Class-level `@BPMAuthenticated()` with a method-level `@BPMAdminOnly()`
    // override: the narrower method decorator has to win.
    expect(find('IdentityQueries', 'member')?.access).toBe('authenticated');
    expect(find('IdentityQueries', 'cachedMembers')?.access).toBe('admin');

    // A filter that stopped matching would leave this near zero, and a host
    // would silently get a permission map covering nothing.
    expect(handlers.length).toBeGreaterThan(100);

    expect(find('ProbeResolver', 'listThings')?.access).toBe('admin');
    expect(find('ProbeResolver', 'buildThingFilter')).toBeUndefined();
  });

  it('stamps host metadata onto the prototype method a guard receives', (): void => {
    applyBPMResolverMetadata(({ access }) => ({
      [HOST_PERMISSION_KEY]: access === 'admin' ? ['bpm:admin'] : ['bpm:use'],
    }));

    // `context.getHandler()` hands a guard exactly this function, so this is
    // where a host's `Reflector.get` looks.
    expect(
      Reflect.getMetadata(
        HOST_PERMISSION_KEY,
        OrganizationQueries.prototype.orgUnits,
      ),
    ).toEqual(['bpm:admin']);
    expect(
      Reflect.getMetadata(
        HOST_PERMISSION_KEY,
        OrganizationMutations.prototype.createOrgUnit,
      ),
    ).toEqual(['bpm:admin']);
    expect(
      Reflect.getMetadata(HOST_PERMISSION_KEY, IdentityQueries.prototype.member),
    ).toEqual(['bpm:use']);
  });

  it('leaves a handler alone when the factory returns nothing for it', (): void => {
    const untouchedKey = 'host:skipped';

    applyBPMResolverMetadata(({ methodName }) =>
      methodName === 'orgUnits' ? { [untouchedKey]: 'stamped' } : null,
    );

    expect(
      Reflect.getMetadata(untouchedKey, OrganizationQueries.prototype.orgUnits),
    ).toBe('stamped');
    expect(
      Reflect.getMetadata(
        untouchedKey,
        OrganizationQueries.prototype.positions,
      ),
    ).toBeUndefined();
  });
});
