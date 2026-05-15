'use client';

import {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from './auth-provider';
import { readUnreadNotificationCount } from './instances/_lib/workflow-api';

interface NotificationUnreadContextValue {
  readonly refreshUnreadCount: () => Promise<number>;
  readonly unreadCount: number;
}

const NotificationUnreadContext =
  createContext<NotificationUnreadContextValue | null>(null);

interface NotificationUnreadProviderProps {
  readonly children: ReactNode;
}

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

    const nextUnreadCount = await readUnreadNotificationCount(currentMemberId);

    setUnreadCount(nextUnreadCount);

    return nextUnreadCount;
  }, [currentMemberId]);

  useEffect((): (() => void) => {
    let active = true;

    async function refresh(): Promise<void> {
      try {
        const nextUnreadCount = await refreshUnreadCount();

        if (active) {
          setUnreadCount(nextUnreadCount);
        }
      } catch {
        if (active) {
          setUnreadCount(0);
        }
      }
    }

    void refresh();

    return (): void => {
      active = false;
    };
  }, [refreshUnreadCount]);

  const value = useMemo(
    (): NotificationUnreadContextValue => ({
      refreshUnreadCount,
      unreadCount,
    }),
    [refreshUnreadCount, unreadCount],
  );

  return (
    <NotificationUnreadContext.Provider value={value}>
      {children}
    </NotificationUnreadContext.Provider>
  );
}

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
