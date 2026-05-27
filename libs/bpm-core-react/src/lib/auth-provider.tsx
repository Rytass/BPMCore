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
import { Typography } from '@mezzanine-ui/react';
import {
  loginApi,
  logoutApi,
  readApiCurrentMember,
  type ApiMember,
} from '@rytass/bpm-core-client';
import { useRouterAdapter } from './router-adapter';
import styles from './auth-provider.module.scss';

interface AuthContextValue {
  readonly loading: boolean;
  readonly member: ApiMember | null;
  readonly login: (input: {
    readonly identifier: string;
    readonly password: string;
  }) => Promise<ApiMember>;
  readonly logout: () => Promise<void>;
  readonly refresh: () => Promise<ApiMember | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  readonly children: ReactNode;
  /**
   * Paths that should not redirect to `/login` when there is no session.
   * Defaults to `['/login']`. Override when your host runs the login UI
   * under a different path.
   */
  readonly publicPaths?: readonly string[];
  /**
   * Where to send unauthenticated users. Defaults to `'/login'`.
   */
  readonly loginPath?: string;
}

/**
 * BPM auth context provider. Reads / writes the host BPM API session via
 * `@rytass/bpm-core-client` (`loginApi` / `logoutApi` / `readApiCurrentMember`)
 * and uses the host-supplied {@link useRouterAdapter} to redirect
 * unauthenticated users.
 */
export function AuthProvider({
  children,
  publicPaths = ['/login'],
  loginPath = '/login',
}: AuthProviderProps): ReactElement {
  const router = useRouterAdapter();
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<ApiMember | null>(null);

  const refresh = useCallback(async (): Promise<ApiMember | null> => {
    const current = await readApiCurrentMember();
    setMember(current);
    return current;
  }, []);

  const login = useCallback(
    async (input: {
      readonly identifier: string;
      readonly password: string;
    }): Promise<ApiMember> => {
      const next = await loginApi(input);
      setMember(next);
      return next;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    await logoutApi();
    setMember(null);
    router.replace(loginPath);
  }, [loginPath, router]);

  useEffect((): (() => void) => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const current = await readApiCurrentMember();
        if (active) setMember(current);
      } catch {
        if (active) setMember(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return (): void => {
      active = false;
    };
  }, []);

  useEffect((): void => {
    if (loading || isPublicPath(router.pathname, publicPaths) || member) return;
    router.replace(
      `${loginPath}?next=${encodeURIComponent(readCurrentPath(router.pathname))}`,
    );
  }, [loading, loginPath, member, publicPaths, router]);

  const value = useMemo<AuthContextValue>(
    () => ({ loading, login, logout, member, refresh }),
    [loading, login, logout, member, refresh],
  );

  if (loading && !isPublicPath(router.pathname, publicPaths)) {
    return <AuthLoadingState label="確認登入狀態" />;
  }
  if (!loading && !member && !isPublicPath(router.pathname, publicPaths)) {
    return <AuthLoadingState label="前往登入頁" />;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the BPM auth context. Throws when used outside `<AuthProvider>`.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

function AuthLoadingState({
  label,
}: {
  readonly label: string;
}): ReactElement {
  return (
    <main className={styles.authLoading}>
      <Typography color="text-neutral" variant="body">
        {label}
      </Typography>
    </main>
  );
}

function isPublicPath(
  pathname: string | null,
  publicPaths: readonly string[],
): boolean {
  return publicPaths.some((p) => p === pathname);
}

function readCurrentPath(pathname: string | null): string {
  if (typeof window === 'undefined') return pathname ?? '/';
  return `${window.location.pathname}${window.location.search}`;
}
