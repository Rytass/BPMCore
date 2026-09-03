import {
  BPMResolverAccessLevel,
  registerBPMResolverClassAccess,
  registerBPMResolverMethodAccess,
} from './bpm-resolver-metadata';

type BPMResolverDecorator = ClassDecorator & MethodDecorator;

type BPMDecoratorCall = (
  target: object,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
) => void;

/**
 * Wraps one of BPM's authorization decorators so the decorated class or method
 * also lands in the resolver registry.
 *
 * The registry is what makes `BPMRootModuleOptions.resolverMetadataFactory`
 * possible: a decorator runs when the class is defined, long before any module
 * option exists, so the only way a host can reach these handlers is for BPM to
 * remember them and replay the host's factory later.
 */
export function withBPMResolverAccess(
  access: BPMResolverAccessLevel,
  decorate: BPMResolverDecorator,
): BPMResolverDecorator {
  const applyDecorator = decorate as unknown as BPMDecoratorCall;

  const decorator: BPMDecoratorCall = (
    target,
    propertyKey,
    descriptor,
  ): void => {
    if (propertyKey === undefined) {
      registerBPMResolverClassAccess(target, access);
    } else {
      registerBPMResolverMethodAccess(
        (target as { readonly constructor: object }).constructor,
        String(propertyKey),
        access,
      );
    }

    return applyDecorator(target, propertyKey, descriptor);
  };

  return decorator as unknown as BPMResolverDecorator;
}
