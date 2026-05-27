'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

interface NotificationDrawerContextValue {
  readonly close: () => void;
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly toggle: () => void;
}

const NotificationDrawerContext =
  createContext<NotificationDrawerContextValue | null>(null);

interface NotificationDrawerProviderProps {
  readonly children: ReactNode;
}

/**
 * Controls the open/closed state of the BPM notification drawer. Wraps
 * children with a context that `<NotificationDrawer />` reads to mount /
 * hide itself, and that `<AppLayout />` reads to open the drawer when
 * the bell icon is clicked.
 *
 * When used outside this provider, the returned hook is a safe no-op so
 * components don't crash in test or storybook environments.
 */
export function NotificationDrawerProvider({
  children,
}: NotificationDrawerProviderProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((): void => {
    setIsOpen(true);
  }, []);
  const close = useCallback((): void => {
    setIsOpen(false);
  }, []);
  const toggle = useCallback((): void => {
    setIsOpen((current) => !current);
  }, []);

  const value = useMemo<NotificationDrawerContextValue>(
    () => ({ close, isOpen, open, toggle }),
    [close, isOpen, open, toggle],
  );

  return (
    <NotificationDrawerContext.Provider value={value}>
      {children}
    </NotificationDrawerContext.Provider>
  );
}

/**
 * Read the BPM notification drawer's open state and control helpers.
 * Returns a no-op stub when used outside `<NotificationDrawerProvider>`.
 */
export function useNotificationDrawer(): NotificationDrawerContextValue {
  const context = useContext(NotificationDrawerContext);
  if (!context) {
    return {
      close: (): void => undefined,
      isOpen: false,
      open: (): void => undefined,
      toggle: (): void => undefined,
    };
  }
  return context;
}
