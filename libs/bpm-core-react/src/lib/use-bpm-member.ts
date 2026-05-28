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
