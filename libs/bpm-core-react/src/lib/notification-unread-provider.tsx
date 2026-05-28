'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { readUnreadNotificationCount } from '@rytass/bpm-core-client/workflow';
import { useAuth } from './auth-provider';

interface NotificationUnreadContextValue {
  readonly refreshUnreadCount: () => Promise<number>;
  readonly unreadCount: number;
}

const NotificationUnreadContext =
  createContext<NotificationUnreadContextValue | null>(null);

interface NotificationUnreadProviderProps {
  readonly children: ReactNode;
}

/**
 * Polls BPM for the current member's unread notification count via
 * `readUnreadNotificationCount` and exposes it through context for the
 * host navigation (`<BPMNotificationBellButton />` badge or any custom
 * trigger using `useNotificationUnread().unreadCount`) and the BPM
 * `<NotificationDrawer />` (header count). Refresh is triggered on
 * mount and whenever the auth member id changes; consumers can call
 * `refreshUnreadCount()` after acknowledging a notification.
 */
export function NotificationUnreadProvider({
  children,
}: NotificationUnreadProviderProps): ReactElement {
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async (): Promise<number> => {
    if (!currentMemberId) {
      setUnreadCount(0);
      return 0;
    }
    const next = await readUnreadNotificationCount(currentMemberId);
    setUnreadCount(next);
    return next;
  }, [currentMemberId]);

  useEffect((): (() => void) => {
    let active = true;
    void (async () => {
      try {
        const next = await refreshUnreadCount();
        if (active) setUnreadCount(next);
      } catch {
        if (active) setUnreadCount(0);
      }
    })();
    return (): void => {
      active = false;
    };
  }, [refreshUnreadCount]);

  const value = useMemo<NotificationUnreadContextValue>(
    () => ({ refreshUnreadCount, unreadCount }),
    [refreshUnreadCount, unreadCount],
  );

  return (
    <NotificationUnreadContext.Provider value={value}>
      {children}
    </NotificationUnreadContext.Provider>
  );
}

/**
 * Read the current unread-notification count and a manual refresh helper.
 * Returns a zero/no-op stub when used outside
 * `<NotificationUnreadProvider>`.
 */
export function useNotificationUnread(): NotificationUnreadContextValue {
  const context = useContext(NotificationUnreadContext);
  if (!context) {
    return {
      refreshUnreadCount: async (): Promise<number> => 0,
      unreadCount: 0,
    };
  }
  return context;
}
