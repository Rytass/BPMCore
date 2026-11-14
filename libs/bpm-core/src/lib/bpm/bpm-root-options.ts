import {
  DynamicModule,
  Global,
  InjectionToken,
  Module,
  ModuleMetadata,
} from '@nestjs/common';
import { BPMRootAttachmentOptions } from '../attachment/attachment-options';
import { AttachmentStorage } from '../attachment/attachment-storage.token';
import { BPMAuthModuleOptions } from '../bpm-auth/bpm-auth.options';
import { BPMBusinessCalendar } from '../calendar/business-calendar.token';
import type { BPMExpressionFunction } from '../expression-function/expression-function.types';
import { BPMFormDataSourceRegistry } from '../form-data-source/form-data-source.types';
import type { BPMInstanceEventDeliveryOptions } from '../instance-event/instance-event.options';
import type { BPMInstanceEventObserver } from '../instance-event/instance-event.token';
import { BPMRootIdentityOptions } from '../identity/identity-options';
import { BPMMemberResolver } from '../identity/member-resolver.interface';
import { BPMRootNotificationOptions } from '../notification/notification-options';
import {
  BPMRootOrganizationOptions,
  resolveBPMOrganizationTimeZone,
} from '../organization/organization-time-zone';
import { BPMRootSignatureOptions } from '../signature/signature-options';
import { BPMInitiatorCustomFieldsResolver } from '../workflow-engine/initiator-custom-fields-resolver.token';
import { BPMInstanceGuard } from '../workflow-engine/instance-guard.token';
import { BPMWorkflowServiceTaskDispatcher } from '../workflow-engine/workflow-service-task-dispatcher.token';
import { BPMRootWorkflowWebhookOptions } from '../workflow-webhook/workflow-webhook-options';
import { BPMWorkflowWebhookRegistry } from '../workflow-webhook/workflow-webhook.types';

/**
 * Every BPM setting that can be decided at **runtime**, i.e. after the host's
 * secrets have been read.
 *
 * This is exactly what a `BPMRootModule.forRootAsync` `useFactory` returns, and
 * it is also embedded in the synchronous `BPMRootModuleOptions`, so a host can
 * move a setting between `forRoot` and `forRootAsync` without reshaping it.
 *
 * Every field is optional. A host that supplies none still boots: BPM falls
 * back to a local attachment store, an id-passthrough member resolver, a
 * Monday–Friday business calendar, an empty form DataSource catalog, and a
 * `fetch`-based webhook dispatcher, with in-app notifications on and email,
 * webhook, and both schedulers off. Features are opted **in** from there.
 *
 * Two settings deliberately do **not** live here, because Nest reads them
 * while building routes and the GraphQL schema — before any async factory has
 * run: `attachmentRoutePrefix` and `identityRegisterResolvers`. They are
 * accepted at the top level of the `forRootAsync` options object instead.
 */
export interface BPMRootRuntimeOptions
  extends
    BPMRootAttachmentOptions,
    BPMRootIdentityOptions,
    BPMRootNotificationOptions,
    BPMRootOrganizationOptions,
    BPMRootSignatureOptions,
    BPMRootWorkflowWebhookOptions {
  /**
   * Storage adapter for BPM attachments, as a ready instance.
   *
   * Any `@rytass/storages` compatible adapter (MinIO, S3, GCS) fits. Prefer
   * this over `attachmentStorageProvider` when the adapter needs a secret:
   * the instance is built inside the async factory, where the secret is
   * already in hand. When omitted, BPM writes to `.storage/attachments`
   * through `@rytass/storages-adapter-local`.
   */
  readonly attachmentStorage?: AttachmentStorage;

  /**
   * Factory that resolves the current BPM auth context from NestJS execution
   * context.
   *
   * BPM guards, GraphQL decorators, and domain services use this callback to
   * identify the current member and organization context. It is only needed
   * when the host does **not** already put a `bpmAuthContext` on the
   * GraphQL/HTTP context — BPM reads that first and falls back to this.
   */
  readonly authContextFactory?: BPMAuthModuleOptions['contextFactory'];

  /**
   * Business calendar for workflow nodes whose SLA opts into `BUSINESS_DAY`,
   * as a ready instance.
   *
   * BPMCore ships no national holiday data; when omitted, BPM falls back to a
   * Monday–Friday calendar in `notificationSlaBusinessCalendarTimeZone`.
   *
   * Supplying the calendar here rather than through
   * `businessCalendarProvider` also sidesteps that option's DI-cycle footgun:
   * the instance is constructed by the host's own factory, so its dependency
   * chain never runs through BPM's module context.
   */
  readonly businessCalendar?: BPMBusinessCalendar;

  /**
   * Host functions that expressions may call (ADR 22 §3.5), next to the nine
   * built-ins that are always available. Each name ends in its version
   * (`erp_costBand_v1`); handlers must be synchronous and pure, and only see
   * deep-frozen copies of their arguments. Validated while BPM boots: a bad
   * name, an async handler or an unsupported type fails the boot.
   *
   * Keep every function a published version still calls: once one is gone,
   * cases on that version fail closed with `EXPRESSION_FUNCTION_FAILED`.
   * When omitted, only the built-ins are available.
   */
  readonly expressionFunctions?: readonly BPMExpressionFunction[];

  /**
   * Reads a form field the case has no value for as `null` (a table as `[]`)
   * instead of failing the expression with a missing key (ADR 27 §3). Only
   * top-level fields of the case's form schema are filled; table columns are
   * not, and nothing is written back to `form_data`. Applies to every
   * workflow expression on a case (entry conditions, gateways, approver
   * expressions, WEBHOOK payloads, `SET_FORM_FIELD`), to delegation
   * `scopeConditionCel`, and to dry runs given the form schema.
   *
   * Defaults to `false`. Turning it on changes what existing expressions mean
   * for an unfilled field `x`:
   *
   * | expression       | off                 | on                       |
   * | ---------------- | ------------------- | ------------------------ |
   * | `has(form.x)`    | `false`             | `true`                   |
   * | `form.x == null` | missing-key error   | `true`                   |
   * | `form.x > 5`     | missing-key error   | type error (still fails) |
   *
   * A template that tests "not filled" with `has(form.x)` must switch to
   * `form.x == null` before the host turns this on.
   */
  readonly expressionMissingFormFieldsAsNull?: boolean;

  /**
   * Versioned form option DataSource catalog, as a ready instance. When
   * omitted, BPM exposes an empty catalog.
   */
  readonly formDataSourceRegistry?: BPMFormDataSourceRegistry;

  /**
   * Fills `customFields` of the initiator snapshot the engine builds when a
   * case is submitted without one (every submission from the GraphQL
   * `submitApprovalInstance` mutation), as a ready instance. The values are
   * then readable as `initiator.customFields.*` by the initiator policy at
   * submit, by conditions and by expression approvers. A snapshot passed in by
   * a host calling the service is never touched.
   *
   * The launchable template list calls it too, once per request, and judges
   * the initiator policies against its answer; when it fails there, the list
   * is judged against `{}` instead of failing (a submission does fail). So its
   * answer must depend on the initiator only.
   *
   * `initiatorCustomFieldsResolverProvider` takes precedence when both are
   * given. When omitted, `customFields` is `{}`.
   */
  readonly initiatorCustomFieldsResolver?: BPMInitiatorCustomFieldsResolver;

  /**
   * Pre-decision guard that can refuse a submit, resubmit or decide before the
   * engine commits it, as a ready instance. Refusals come back as a 400 with
   * `formDataErrors` (reason `HOST_RULE`); a timeout or a failing guard comes
   * back as a 503. The guard runs inside the engine transaction, so a refusal
   * rolls the whole change back.
   *
   * `instanceGuardProvider` takes precedence when both are given. When omitted,
   * no guard runs.
   */
  readonly instanceGuard?: BPMInstanceGuard;

  /**
   * Time the guard gets to answer, in milliseconds. Default 5000. A guard that
   * does not answer in time fails closed (503 `BPM_INSTANCE_GUARD_TIMEOUT`).
   * Only read when a guard is bound.
   */
  readonly instanceGuardTimeoutMs?: number;

  /**
   * Receives instance lifecycle events (ADR 27 §1), as a ready instance. BPM
   * writes one outbox row per event in the same transaction as the state change
   * and calls the observer after commit, at least once per event. Hosts dedupe
   * on `event.id`.
   *
   * `instanceEventObserverProvider` takes precedence when both are given. When
   * omitted, no outbox rows are written.
   */
  readonly instanceEventObserver?: BPMInstanceEventObserver;

  /**
   * Outbox tuning for instance lifecycle events (ADR 27 §1.4). Unset or
   * non-positive fields take the webhook-matching defaults.
   */
  readonly instanceEventDelivery?: Partial<BPMInstanceEventDeliveryOptions>;

  /**
   * Host identity source, as a ready instance.
   *
   * When omitted, BPM resolves every member to its own id
   * (`DefaultBPMMemberResolver`): screens keep working, but display names are
   * raw ids and member emails are empty.
   */
  readonly memberResolver?: BPMMemberResolver;

  /**
   * Dispatcher for executable workflow service tasks, as a ready instance.
   * Replace the default `fetch` dispatcher to add auth headers, request
   * signing, retry queues, or an outbound integration bus.
   */
  readonly workflowServiceTaskDispatcher?: BPMWorkflowServiceTaskDispatcher;

  /**
   * Catalog of NOTIFY webhook endpoints registered by host code, as a ready
   * instance (ADR 18 §3.1). When omitted, BPM exposes an empty catalog and a
   * template that references any endpoint cannot be published.
   */
  readonly workflowWebhookRegistry?: BPMWorkflowWebhookRegistry;
}

/**
 * @deprecated Use {@link BPMRootRuntimeOptions}. Kept as a
 * backwards-compatible alias for hosts that named the `forRootAsync` factory
 * return type explicitly.
 */
export type BPMRootModuleAsyncFactoryOptions = BPMRootRuntimeOptions;

/**
 * Injection token carrying the **resolved** {@link BPMRootRuntimeOptions}.
 *
 * BPM resolves the host's `useFactory` exactly once and publishes the result
 * under this token, so every BPM sub-module reads one coherent object. Before
 * this token existed each sub-module called the host factory itself — five
 * times per boot — which made a factory that constructs instances (a member
 * resolver, a storage adapter) quietly produce a different instance per
 * consumer.
 *
 * Host code may inject it too, but it is primarily BPM's own plumbing.
 */
export const BPM_ROOT_OPTIONS: InjectionToken<BPMRootRuntimeOptions> =
  Symbol('BPM_ROOT_OPTIONS');

export interface BPMRootOptionsModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Providers injected into `useFactory`, typically a Vault or config service.
   */
  readonly inject?: readonly InjectionToken[];

  /**
   * Async factory returning the flattened BPM runtime options. Optional — a
   * host that only needs defaults can omit it entirely.
   */
  readonly useFactory?: (
    ...args: readonly unknown[]
  ) => BPMRootRuntimeOptions | Promise<BPMRootRuntimeOptions>;
}

/**
 * Publishes the resolved BPM runtime options under {@link BPM_ROOT_OPTIONS}.
 *
 * Global so that every BPM sub-module — and any host provider that wants to
 * read what BPM ended up with — can inject the token without threading an
 * import through each feature module.
 */
@Global()
@Module({})
export class BPMRootOptionsModule {
  static forRoot(options: BPMRootRuntimeOptions = {}): DynamicModule {
    resolveBPMOrganizationTimeZone(options.organizationTimeZone);

    return {
      exports: [BPM_ROOT_OPTIONS],
      module: BPMRootOptionsModule,
      providers: [
        {
          provide: BPM_ROOT_OPTIONS,
          useValue: options,
        },
      ],
    };
  }

  static forRootAsync(
    options: BPMRootOptionsModuleAsyncOptions = {},
  ): DynamicModule {
    const useFactory = options.useFactory;

    return {
      exports: [BPM_ROOT_OPTIONS],
      imports: options.imports ? [...options.imports] : [],
      module: BPMRootOptionsModule,
      providers: [
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_ROOT_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<BPMRootRuntimeOptions> => {
            const resolved = useFactory ? await useFactory(...args) : {};

            resolveBPMOrganizationTimeZone(resolved.organizationTimeZone);

            return resolved;
          },
        },
      ],
    };
  }
}
