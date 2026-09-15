'use client';

import type { ApiMember } from '@rytass/bpm-core-client';
import { useAuth } from './auth-provider';

/**
 * Read the currently authenticated BPM member. Returns `null` when there
 * is no active session — typically only seen on the login page or during
 * the brief loading window before `<AuthProvider>` resolves the cookie.
 *
 * Convenience alias for `useAuth().member` aimed at host navigations
 * (avatar, display name, role-based menu visibility) that should not
 * depend on the broader `useAuth()` surface.
 */
export function useBPMMember(): ApiMember | null {
  const { member } = useAuth();
  return member;
}

const BPM_ADMIN_PERMISSIONS: ReadonlySet<string> = new Set([
  'bpm:*',
  'bpm:admin',
  'bpm.admin',
  'bpm:admin:*',
]);

/**
 * Whether the member passes the server's `@BPMAdminOnly()` check — the
 * `BPM_ADMIN` role or one of the administrator permissions. Use it to decide
 * whether to show administrator-only UI; the server still enforces access.
 */
export function isBPMAdminMember(
  member: Pick<ApiMember, 'permissions' | 'roles'> | null,
): boolean {
  if (!member) {
    return false;
  }

  // The member comes from the host's `/auth/me` unvalidated; a host that
  // omits either list must not take the page that asks down with it.
  return (
    (member.roles ?? []).includes('BPM_ADMIN') ||
    (member.permissions ?? []).some((permission) =>
      BPM_ADMIN_PERMISSIONS.has(permission),
    )
  );
}
