import 'reflect-metadata';
import { IdentityQueries } from '../identity/identity.queries';
import { OrganizationMutations } from '../organization/organization.mutations';
import { OrganizationQueries } from '../organization/organization.queries';
import {
  applyBPMResolverMetadata,
  BPMResolverHandlerDescriptor,
  listBPMResolverHandlers,
} from './bpm-resolver-metadata';

const HOST_PERMISSION_KEY = 'host:permission';

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
