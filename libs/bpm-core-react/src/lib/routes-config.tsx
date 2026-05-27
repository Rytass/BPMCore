'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Framework-agnostic path mapping every BPM view uses for internal
 * cross-navigation. When a host embeds BPM under a non-root prefix
 * (e.g. `/workspace/bpm/*`) it provides its own implementation through
 * `<BPMRoutesProvider value={...}>`; otherwise the default factory
 * preserves the historical `/instances/:id`, `/templates`, etc. paths.
 *
 * Function-shape (instead of string templates) means:
 * - Optional and multi-param routes can branch on argument presence
 *   (`caseNew(templateId?)`).
 * - Query-string composition stays inside the host's resolver, not the
 *   view.
 * - TypeScript flags missing arguments at compile time.
 *
 * Mirror sibling: {@link RouterAdapter} owns *navigation primitives*
 * (`push`, `replace`, `pathname`); `BPMRoutes` owns *path strings*. The
 * two compose: views call `router.push(routes.caseDetail(id))`.
 */
export interface BPMRoutes {
  /** Workflow dashboard landing. Used by sidebar + dashboard tiles. */
  dashboard(): string;
  /** Inbox (待簽) — pending tasks assigned to the current member. */
  inbox(): string;
  /** Sent (我發起的) — instances the current member initiated. */
  sent(): string;
  /** CC (抄送給我) — instances the current member is copied on. */
  cc(): string;
  /** Cross-view search. */
  search(): string;
  /** Personal delegation rules. */
  delegations(): string;
  /** Notification list. */
  notifications(): string;

  /** Detail page for one approval instance. */
  caseDetail(instanceId: string): string;
  /**
   * Launch a new approval instance. When `templateId` is passed, the
   * launch form is pre-populated for that template.
   */
  caseNew(templateId?: string): string;

  /** Template index. */
  templates(): string;
  /** Template designer (xyflow canvas). */
  templateDesigner(templateId: string): string;
  /** Template version history. */
  templateVersions(templateId: string): string;
  /** Template categories admin. */
  templateCategories(): string;

  /** Form definitions index. */
  forms(): string;
  /** Form-builder (CodeMirror schema editor + preview). */
  formBuilder(formId: string): string;

  /** Per-member notification preferences. */
  notificationSettings(): string;

  /** Admin: organization tree management. */
  adminOrgs(): string;
  /** Admin: member directory mapping. */
  adminUsers(): string;
  /** Admin: delegation rule management. */
  adminDelegations(): string;
}

/**
 * Factory for the default `BPMRoutes` value. Reproduces the exact path
 * literals BPM views used before `BPMRoutesContext` existed, so existing
 * hosts (no provider mounted) keep working unchanged.
 */
export function createDefaultBPMRoutes(): BPMRoutes {
  return {
    dashboard: () => '/dashboard',
    inbox: () => '/inbox',
    sent: () => '/sent',
    cc: () => '/cc',
    search: () => '/search',
    delegations: () => '/delegations',
    notifications: () => '/notifications',

    caseDetail: (instanceId) => `/instances/${instanceId}`,
    caseNew: (templateId) =>
      templateId
        ? `/instances/new?templateId=${encodeURIComponent(templateId)}`
        : '/instances/new',

    templates: () => '/templates',
    templateDesigner: (templateId) => `/templates/${templateId}/designer`,
    templateVersions: (templateId) => `/templates/${templateId}/versions`,
    templateCategories: () => '/templates/categories',

    forms: () => '/forms',
    formBuilder: (formId) => `/forms/${formId}/builder`,

    notificationSettings: () => '/settings/notifications',

    adminOrgs: () => '/admin/orgs',
    adminUsers: () => '/admin/users',
    adminDelegations: () => '/admin/delegations',
  };
}

const BPMRoutesContext = createContext<BPMRoutes | null>(null);

export interface BPMRoutesProviderProps {
  /**
   * Override the path mapping. Provide a full implementation, or spread
   * the default and override individual entries:
   *
   * ```tsx
   * <BPMRoutesProvider value={{
   *   ...createDefaultBPMRoutes(),
   *   caseDetail: (id) => `/workspace/cases/${id}`,
   * }}>
   * ```
   */
  readonly value?: BPMRoutes;
  readonly children: ReactNode;
}

/**
 * Wraps the BPM React tree with a {@link BPMRoutes} value. Mounting the
 * provider is **optional** — `useBPMRoutes()` falls back to
 * {@link createDefaultBPMRoutes} when no provider is present. Use it
 * only when the host needs to remap BPM's internal paths.
 */
export function BPMRoutesProvider({
  value,
  children,
}: BPMRoutesProviderProps): React.ReactElement {
  const resolved = useMemo(() => value ?? createDefaultBPMRoutes(), [value]);
  return (
    <BPMRoutesContext.Provider value={resolved}>
      {children}
    </BPMRoutesContext.Provider>
  );
}

/**
 * Reads the host-configured {@link BPMRoutes}. Falls back to
 * {@link createDefaultBPMRoutes} when no `<BPMRoutesProvider>` ancestor
 * is mounted, so views remain self-contained.
 */
export function useBPMRoutes(): BPMRoutes {
  const value = useContext(BPMRoutesContext);
  return value ?? DEFAULT_ROUTES;
}

const DEFAULT_ROUTES: BPMRoutes = createDefaultBPMRoutes();
