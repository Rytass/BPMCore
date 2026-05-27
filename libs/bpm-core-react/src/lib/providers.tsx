'use client';

import type { ReactElement, ReactNode } from 'react';
import {
  CalendarConfigProviderMoment,
  CalendarLocale,
} from '@mezzanine-ui/react/moment';
import { AuthProvider } from './auth-provider';
import { NotificationDrawer } from '../components/notification-drawer';
import { NotificationDrawerProvider } from './notification-drawer-provider';
import { NotificationUnreadProvider } from './notification-unread-provider';

interface ProvidersProps {
  readonly children: ReactNode;
  /** Override Mezzanine calendar locale. Defaults to `CalendarLocale.ZH_TW`. */
  readonly locale?: CalendarLocale;
  /**
   * Public paths that should not trigger redirect to `/login` when there
   * is no session. Forwarded to `<AuthProvider>`. Defaults to `['/login']`.
   */
  readonly publicPaths?: readonly string[];
  /** Where to send unauthenticated users. Defaults to `'/login'`. */
  readonly loginPath?: string;
}

/**
 * One-stop BPM admin provider stack. Wires:
 *
 * - Mezzanine UI calendar locale (moment-based, `ZH_TW` by default)
 * - `<AuthProvider>` (BPM session via REST `/auth/*`)
 * - `<NotificationUnreadProvider>` (polls unread count)
 * - `<NotificationDrawerProvider>` (controls drawer open/close state)
 * - `<NotificationDrawer />` mounted at the root so the bell-icon button in
 *   `<AppLayout />` can open it.
 *
 * Consumer hosts wrap this **inside** a `<RouterAdapterProvider>` (provided
 * by the `pages/*` subpath shims when consuming via Next.js, or wired by
 * hand for other frameworks).
 */
export function Providers({
  children,
  locale = CalendarLocale.ZH_TW,
  publicPaths,
  loginPath,
}: ProvidersProps): ReactElement {
  return (
    <CalendarConfigProviderMoment locale={locale}>
      <AuthProvider publicPaths={publicPaths} loginPath={loginPath}>
        <NotificationUnreadProvider>
          <NotificationDrawerProvider>
            {children}
            <NotificationDrawer />
          </NotificationDrawerProvider>
        </NotificationUnreadProvider>
      </AuthProvider>
    </CalendarConfigProviderMoment>
  );
}
