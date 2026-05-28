'use client';

import { useAuth } from './auth-provider';

/**
 * Drop-in logout handler for host navigation menus. Wraps the BPM auth
 * context's logout flow — calls `logoutApi()` against the BPM REST
 * session endpoint, clears the in-memory member, then redirects to the
 * configured `loginPath`.
 *
 * Hosts mount this on their own logout buttons / menu items so they do
 * not need to touch `useAuth()` directly. To customize the post-logout
 * destination, override the `loginPath` prop on `<BPMNextProviders>` or
 * `<AuthProvider>`.
 */
export function useBPMLogout(): () => Promise<void> {
  const { logout } = useAuth();
  return logout;
}
