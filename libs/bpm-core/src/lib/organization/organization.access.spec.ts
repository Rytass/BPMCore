import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, Type } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  BPMAdminGuard,
  BPMAuthContext,
  BPMDesignerGuard,
  BPMResolverAccessLevel,
  listBPMResolverHandlers,
} from '../bpm-auth';
import { FormQueries } from '../form/form.queries';
import { FormDataSourceQueries } from '../form-data-source/form-data-source.queries';
import { IdentityQueries } from '../identity/identity.queries';
import { ComposeTemplateMutations } from '../template/compose-template.mutations';
import { TemplateMutations } from '../template/template.mutations';
import { TemplateQueries } from '../template/template.queries';
import { WorkflowEngineMutations } from '../workflow-engine/workflow-engine.mutations';
import { WorkflowWebhookDeliveryResolver } from '../workflow-webhook/workflow-webhook-delivery.resolver';
import { WorkflowWebhookEndpointAdminResolver } from '../workflow-webhook/workflow-webhook-endpoint-admin.resolver';
import { WorkflowWebhookQueries } from '../workflow-webhook/workflow-webhook.queries';
import { OrganizationDirectoryQueries } from './organization-directory.queries';
import { OrganizationMutations } from './organization.mutations';
import { OrganizationQueries } from './organization.queries';

type Principal = 'admin' | 'designer' | 'user';

const PRINCIPALS: Readonly<Record<Principal, BPMAuthContext>> = {
  admin: {
    memberId: 'member-admin',
    metadata: {},
    permissions: [],
    roles: ['BPM_ADMIN'],
  },
  designer: {
    memberId: 'member-designer',
    metadata: {},
    permissions: [],
    roles: ['BPM_DESIGNER'],
  },
  user: {
    memberId: 'member-user',
    metadata: {},
    permissions: [],
    roles: [],
  },
};

/** Who may call a handler of each access level. */
const ALLOWED: Readonly<Record<BPMResolverAccessLevel, readonly Principal[]>> =
  {
    admin: ['admin'],
    authenticated: ['admin', 'designer', 'user'],
    designer: ['admin', 'designer'],
  };

/**
 * What Nest would actually run for one handler: the class-level guards then
 * the method-level guards. Reading `__guards__` (rather than only the access
 * level BPM registers for host metadata) is what proves a guard is attached —
 * a method-level `@BPMDesignerOnly()` on an admin-only class would still list
 * `designer` while the class guard keeps rejecting designers.
 */
function readGuards(
  resolverClass: Type<unknown>,
  methodName: string,
): readonly Type<unknown>[] {
  const handler = (resolverClass.prototype as Record<string, unknown>)[
    methodName
  ] as object;

  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, resolverClass) as
      readonly Type<unknown>[] | undefined) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as
      readonly Type<unknown>[] | undefined) ?? []),
  ];
}

function createContext(authContext: BPMAuthContext): ExecutionContext {
  const graphqlContext = { bpmAuthContext: authContext };
  const args = [undefined, {}, graphqlContext, undefined];
  const readUndefined = <T = unknown>(): T => undefined as T;

  return {
    getArgByIndex: <T = unknown>(index: number): T => args[index] as T,
    getArgs: <T extends readonly unknown[] = readonly unknown[]>(): T =>
      args as unknown as T,
    getClass: <T = unknown>(): Type<T> => Object as unknown as Type<T>,
    getHandler: (): ReturnType<ExecutionContext['getHandler']> => Object,
    getType: <TContext extends string = string>(): TContext =>
      'graphql' as TContext,
    switchToHttp: (): ReturnType<ExecutionContext['switchToHttp']> => ({
      getNext: readUndefined,
      getRequest: readUndefined,
      getResponse: readUndefined,
    }),
    switchToRpc: (): ReturnType<ExecutionContext['switchToRpc']> => ({
      getContext: readUndefined,
      getData: readUndefined,
    }),
    switchToWs: (): ReturnType<ExecutionContext['switchToWs']> => ({
      getClient: readUndefined,
      getData: readUndefined,
      getPattern: (): string => '',
    }),
  };
}

/**
 * Runs the role guards attached to a handler against a principal. The sign-in
 * guard (`BPMAuthenticatedGuard`) is left out on purpose: it only asserts that
 * an auth context exists, and every principal here has one.
 */
function canCall(
  resolverClass: Type<unknown>,
  methodName: string,
  principal: Principal,
): boolean {
  const context = createContext(PRINCIPALS[principal]);

  return readGuards(resolverClass, methodName)
    .filter((guard) => guard === BPMAdminGuard || guard === BPMDesignerGuard)
    .every((guard): boolean => {
      try {
        return new (
          guard as Type<BPMAdminGuard | BPMDesignerGuard>
        )().canActivate(context);
      } catch (error: unknown) {
        if (error instanceof ForbiddenException) {
          return false;
        }

        throw error;
      }
    });
}

function readRegisteredAccess(
  resolverName: string,
  methodName: string,
): BPMResolverAccessLevel | undefined {
  return listBPMResolverHandlers().find(
    (handler) =>
      handler.resolverName === resolverName &&
      handler.methodName === methodName,
  )?.access;
}

function methodsOf(resolverName: string): readonly string[] {
  return listBPMResolverHandlers()
    .filter((handler) => handler.resolverName === resolverName)
    .map((handler) => handler.methodName);
}

interface Operation {
  readonly access: BPMResolverAccessLevel;
  readonly method: string;
  readonly name: string;
  readonly resolver: Type<unknown>;
}

const op = (
  resolver: Type<unknown>,
  method: string,
  access: BPMResolverAccessLevel,
): Operation => ({
  access,
  method,
  name: `${resolver.name}.${method}`,
  resolver,
});

/**
 * The GraphQL operations the template designer and the compose wizard send
 * while loading and while saving, publishing and dry-running, including those
 * of the form builder the compose wizard embeds. The organization rows are the
 * ones that used to be admin-only and locked a designer who is not an
 * administrator out of both pages; the designer reads them through
 * `readOrganizationDirectory`, which sends nothing else from the organization.
 * Form-definition writes (`FormMutations`) are not here: no page of this
 * library calls them.
 */
const DESIGNER_PAGE_OPERATIONS: readonly Operation[] = [
  // `readOrganizationDirectory` (OrganizationDirectory), sent by the designer.
  op(OrganizationDirectoryQueries, 'orgUnits', 'designer'),
  op(OrganizationDirectoryQueries, 'positions', 'designer'),
  op(OrganizationDirectoryQueries, 'memberships', 'designer'),
  // Template and form reads.
  op(TemplateQueries, 'approvalTemplate', 'authenticated'),
  op(TemplateQueries, 'approvalTemplateVersions', 'authenticated'),
  op(TemplateQueries, 'approvalTemplateCategories', 'authenticated'),
  op(TemplateQueries, 'approvalTemplateCategoryCount', 'authenticated'),
  op(FormQueries, 'formDefinitions', 'authenticated'),
  op(FormQueries, 'formDefinition', 'authenticated'),
  op(FormQueries, 'formDefinitionVersions', 'authenticated'),
  op(FormQueries, 'lintFormSchema', 'authenticated'),
  // Member pickers.
  op(IdentityQueries, 'members', 'authenticated'),
  op(IdentityQueries, 'searchMembers', 'authenticated'),
  // Designer-only reads.
  op(WorkflowWebhookQueries, 'workflowWebhookEndpoints', 'designer'),
  op(FormDataSourceQueries, 'formDataSources', 'designer'),
  op(FormDataSourceQueries, 'previewFormFieldOptions', 'designer'),
  op(FormDataSourceQueries, 'previewResolveFormFieldOptions', 'designer'),
  op(FormDataSourceQueries, 'formFieldOptions', 'authenticated'),
  op(FormDataSourceQueries, 'resolveFormFieldOptions', 'authenticated'),
  // Dry run.
  op(WorkflowEngineMutations, 'dryRunApprovalWorkflow', 'authenticated'),
  // Writes a designer makes.
  op(TemplateMutations, 'updateApprovalTemplateDraft', 'designer'),
  op(TemplateMutations, 'forkApprovalTemplate', 'designer'),
  op(TemplateMutations, 'publishApprovalTemplateVersion', 'designer'),
  op(ComposeTemplateMutations, 'composeApprovalTemplateWithForm', 'designer'),
];

describe('organization read access for template designers', () => {
  it.each(DESIGNER_PAGE_OPERATIONS)(
    '$name is registered as $access',
    ({ access, method, resolver }): void => {
      expect(readRegisteredAccess(resolver.name, method)).toBe(access);
    },
  );

  describe.each(DESIGNER_PAGE_OPERATIONS)(
    '$name ($access)',
    ({ access, method, resolver }) => {
      it.each(['admin', 'designer', 'user'] as const)(
        'for a %s principal',
        (principal): void => {
          expect(canCall(resolver, method, principal)).toBe(
            ALLOWED[access].includes(principal),
          );
        },
      );
    },
  );

  it('opens exactly the three directory reads to designers', (): void => {
    expect([...methodsOf('OrganizationDirectoryQueries')].sort()).toEqual([
      'memberships',
      'orgUnits',
      'positions',
    ]);
  });

  it('keeps every other organization read administrator-only', (): void => {
    const reads = methodsOf('OrganizationQueries');

    // Manager rules, the counts, the summary, a single unit, retirement
    // impact and resolved managers. A listing that matched nothing would make
    // the loop below vacuous.
    expect(reads).toEqual(
      expect.arrayContaining([
        'managerResolutions',
        'managerResolutionCount',
        'membershipCount',
        'organizationSummary',
        'orgUnit',
        'resolvedManager',
      ]),
    );

    for (const method of reads) {
      expect([
        method,
        readRegisteredAccess('OrganizationQueries', method),
      ]).toEqual([method, 'admin']);
      expect([
        method,
        canCall(OrganizationQueries, method, 'designer'),
      ]).toEqual([method, false]);
      expect([method, canCall(OrganizationQueries, method, 'admin')]).toEqual([
        method,
        true,
      ]);
    }
  });

  it('keeps every organization write administrator-only', (): void => {
    const writes = methodsOf('OrganizationMutations');

    // A listing that matched nothing would make the loop below vacuous.
    expect(writes.length).toBeGreaterThanOrEqual(12);

    for (const method of writes) {
      expect([
        method,
        readRegisteredAccess('OrganizationMutations', method),
      ]).toEqual([method, 'admin']);
      expect([
        method,
        canCall(OrganizationMutations, method, 'designer'),
      ]).toEqual([method, false]);
      expect([method, canCall(OrganizationMutations, method, 'user')]).toEqual([
        method,
        false,
      ]);
      expect([method, canCall(OrganizationMutations, method, 'admin')]).toEqual(
        [method, true],
      );
    }
  });

  it('keeps webhook endpoint and delivery management administrator-only', (): void => {
    const resolvers: readonly Type<unknown>[] = [
      WorkflowWebhookEndpointAdminResolver,
      WorkflowWebhookDeliveryResolver,
    ];

    for (const resolver of resolvers) {
      const methods = methodsOf(resolver.name);

      expect(methods.length).toBeGreaterThan(0);

      for (const method of methods) {
        expect([
          resolver.name,
          method,
          canCall(resolver, method, 'designer'),
        ]).toEqual([resolver.name, method, false]);
        expect([
          resolver.name,
          method,
          canCall(resolver, method, 'admin'),
        ]).toEqual([resolver.name, method, true]);
      }
    }
  });

  it('keeps task reassignment administrator-only', (): void => {
    expect(canCall(WorkflowEngineMutations, 'reassignTask', 'designer')).toBe(
      false,
    );
    expect(
      canCall(WorkflowEngineMutations, 'reassignMemberTasks', 'designer'),
    ).toBe(false);
  });
});
