'use client';

import {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
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

  const value = useMemo(
    (): NotificationDrawerContextValue => ({
      close,
      isOpen,
      open,
      toggle,
    }),
    [close, isOpen, open, toggle],
  );

  return (
    <NotificationDrawerContext.Provider value={value}>
      {children}
    </NotificationDrawerContext.Provider>
  );
}

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
