/**
 * Extension point that lets a host stamp its own route metadata onto every BPM
 * GraphQL handler.
 *
 * BPM guards its own resolvers with `@BPMAuthenticated()`, `@BPMAdminOnly()`
 * and `@BPMDesignerOnly()`. A host that also installs a *global* guard of its
 * own — `@rytass/member-base-nestjs-module` registers a `CasbinGuard` that
 * rejects any route carrying no `@CheckPermission` metadata — rejects all of
 * them before BPM's guards ever run, and the two packages cannot be mounted
 * together at all.
 *
 * BPM cannot import the host's decorator, and a decorator cannot read module
 * options because it runs when the class is defined. So the resolver classes
 * register themselves here as they are decorated, and the host supplies a
 * factory that BPM replays over them at module wiring time — before Nest reads
 * any of this metadata, which it only does per request.
 */

import { RESOLVER_TYPE_METADATA } from '@nestjs/graphql';

const ACCESS_BY_RESOLVER = new Map<object, BPMResolverAccessRegistration>();

/**
 * How much authority BPM itself demands of a caller for one handler. A host
 * maps this onto its own permission vocabulary.
 */
export type BPMResolverAccessLevel = 'admin' | 'authenticated' | 'designer';

export interface BPMResolverHandlerDescriptor {
  /** Authority BPM's own guards require for this handler. */
  readonly access: BPMResolverAccessLevel;

  /**
   * Method name on the resolver class. Across BPM this is also the GraphQL
   * field name — `orgUnits`, `createOrgUnit`, `member`.
   */
  readonly methodName: string;

  /** Resolver class name, for example `OrganizationQueries`. */
  readonly resolverName: string;
}

/**
 * Returns the metadata to attach to one BPM handler, keyed exactly as the
 * host's guard reads it. Return `null` or `undefined` to leave a handler
 * alone.
 *
 * @example
 * ```ts
 * const resolverMetadataFactory: BPMResolverMetadataFactory = ({ access }) => ({
 *   // the key `@CheckPermission` writes, and the value its guard expects
 *   PERMISSION_METADATA_KEY: access === 'authenticated' ? ['bpm:use'] : ['bpm:admin'],
 * });
 * ```
 */
export type BPMResolverMetadataFactory = (
  handler: BPMResolverHandlerDescriptor,
) => Readonly<Record<string | symbol, unknown>> | null | undefined;

interface BPMResolverAccessRegistration {
  readonly accessByMethod: Map<string, BPMResolverAccessLevel>;
  classAccess: BPMResolverAccessLevel | null;
}

/**
 * Records that a whole resolver class sits behind `access`. Called by BPM's
 * own authorization decorators; hosts do not call this.
 */
export function registerBPMResolverClassAccess(
  resolverClass: object,
  access: BPMResolverAccessLevel,
): void {
  readRegistration(resolverClass).classAccess = access;
}

/**
 * Records that a single handler sits behind `access`, overriding whatever the
 * class-level decorator asked for. Called by BPM's own authorization
 * decorators; hosts do not call this.
 */
export function registerBPMResolverMethodAccess(
  resolverClass: object,
  methodName: string,
  access: BPMResolverAccessLevel,
): void {
  readRegistration(resolverClass).accessByMethod.set(methodName, access);
}

/**
 * Replays `factory` over every registered BPM handler and writes the metadata
 * it returns onto the prototype method, which is what Nest hands a guard as
 * `context.getHandler()`.
 *
 * `BPMRootModule` calls this for `resolverMetadataFactory`. Calling it twice
 * with the same factory simply writes the same values again.
 */
export function applyBPMResolverMetadata(
  factory: BPMResolverMetadataFactory,
): void {
  for (const [resolverClass, registration] of ACCESS_BY_RESOLVER) {
    const prototype = readPrototype(resolverClass);

    if (!prototype) {
      continue;
    }

    for (const methodName of listHandlerMethodNames(prototype)) {
      const access =
        registration.accessByMethod.get(methodName) ??
        registration.classAccess;

      if (access === null || access === undefined) {
        continue;
      }

      const metadata = factory({
        access,
        methodName,
        resolverName: readResolverName(resolverClass),
      });

      if (!metadata) {
        continue;
      }

      const handler = prototype[methodName];

      // `Reflect.ownKeys`, not `Object.entries`: several Nest ecosystem guards
      // key their metadata by symbol, and dropping those silently would look
      // to a host exactly like the factory never ran.
      for (const key of Reflect.ownKeys(metadata)) {
        Reflect.defineMetadata(
          key,
          (metadata as Record<string | symbol, unknown>)[key],
          handler as object,
        );
      }
    }
  }
}

/**
 * Every BPM handler the metadata factory would be offered, in registration
 * order. Exposed so a host can print the list while mapping BPM operations
 * onto its own permissions.
 */
export function listBPMResolverHandlers(): readonly BPMResolverHandlerDescriptor[] {
  const handlers: BPMResolverHandlerDescriptor[] = [];

  for (const [resolverClass, registration] of ACCESS_BY_RESOLVER) {
    const prototype = readPrototype(resolverClass);

    if (!prototype) {
      continue;
    }

    for (const methodName of listHandlerMethodNames(prototype)) {
      const access =
        registration.accessByMethod.get(methodName) ??
        registration.classAccess;

      if (access === null || access === undefined) {
        continue;
      }

      handlers.push({
        access,
        methodName,
        resolverName: readResolverName(resolverClass),
      });
    }
  }

  return handlers;
}

function readRegistration(
  resolverClass: object,
): BPMResolverAccessRegistration {
  const existing = ACCESS_BY_RESOLVER.get(resolverClass);

  if (existing) {
    return existing;
  }

  const registration: BPMResolverAccessRegistration = {
    accessByMethod: new Map(),
    classAccess: null,
  };

  ACCESS_BY_RESOLVER.set(resolverClass, registration);

  return registration;
}

function readPrototype(
  resolverClass: object,
): Record<string, unknown> | null {
  const prototype = (resolverClass as { readonly prototype?: unknown })
    .prototype;

  return typeof prototype === 'object' && prototype !== null
    ? (prototype as Record<string, unknown>)
    : null;
}

function readResolverName(resolverClass: object): string {
  const name = (resolverClass as { readonly name?: unknown }).name;

  return typeof name === 'string' ? name : '';
}

/**
 * The GraphQL handlers on a resolver prototype and everything it inherits.
 *
 * Two things this must not do. It must not list a plain helper method: a host
 * builds its permission map from `listBPMResolverHandlers()`, and a private
 * helper would show up there as a GraphQL field that does not exist. And it
 * must not stop at the class's own prototype: a handler inherited from a base
 * resolver would then get no metadata at all, which a host sees only as an
 * unexplained 403.
 *
 * `@Query` / `@Mutation` / `@ResolveField` each stamp
 * `RESOLVER_TYPE_METADATA` on the method, so that is the test.
 */
function listHandlerMethodNames(
  prototype: Record<string, unknown>,
): readonly string[] {
  const methodNames = new Set<string>();

  for (
    let current: object | null = prototype;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const methodName of Object.getOwnPropertyNames(current)) {
      if (methodName === 'constructor') {
        continue;
      }

      const member = (current as Record<string, unknown>)[methodName];

      if (
        typeof member === 'function' &&
        Reflect.getMetadata(RESOLVER_TYPE_METADATA, member) !== undefined
      ) {
        methodNames.add(methodName);
      }
    }
  }

  return [...methodNames];
}
