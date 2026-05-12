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
import { usePathname, useRouter } from 'next/navigation';
import { Button, Typography } from '@mezzanine-ui/react';
import { LogoutIcon } from '@mezzanine-ui/icons';
import {
  ApiMember,
  loginApi,
  logoutApi,
  readApiCurrentMember,
} from './_lib/api-auth-client';
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
const PUBLIC_PATHS = ['/login'];

interface AuthProviderProps {
  readonly children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<ApiMember | null>(null);

  const refresh = useCallback(async (): Promise<ApiMember | null> => {
    const currentMember = await readApiCurrentMember();

    setMember(currentMember);

    return currentMember;
  }, []);

  const login = useCallback(
    async (input: {
      readonly identifier: string;
      readonly password: string;
    }): Promise<ApiMember> => {
      const loggedInMember = await loginApi(input);

      setMember(loggedInMember);

      return loggedInMember;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    await logoutApi();
    setMember(null);
    router.replace('/login');
  }, [router]);

  useEffect((): (() => void) => {
    let active = true;

    async function checkSession(): Promise<void> {
      setLoading(true);

      try {
        const currentMember = await readApiCurrentMember();

        if (!active) {
          return;
        }

        setMember(currentMember);
      } catch {
        if (active) {
          setMember(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void checkSession();

    return (): void => {
      active = false;
    };
  }, []);

  useEffect((): void => {
    if (loading || isPublicPath(pathname) || member) {
      return;
    }

    router.replace(`/login?next=${encodeURIComponent(readCurrentPath())}`);
  }, [loading, member, pathname, router]);

  const value = useMemo(
    (): AuthContextValue => ({
      loading,
      login,
      logout,
      member,
      refresh,
    }),
    [loading, login, logout, member, refresh],
  );

  if (loading && !isPublicPath(pathname)) {
    return <AuthLoadingState label="確認登入狀態" />;
  }

  if (!loading && !member && !isPublicPath(pathname)) {
    return <AuthLoadingState label="前往登入頁" />;
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {member && !isPublicPath(pathname) ? (
        <div className={styles.accountBar}>
          <div className={styles.accountMeta}>
            <Typography color="text-neutral" variant="caption">
              目前登入
            </Typography>
            <Typography variant="body">{member.name}</Typography>
          </div>
          <Button
            icon={LogoutIcon}
            iconType="leading"
            onClick={(): void => {
              void logout();
            }}
            size="sub"
            variant="base-secondary"
          >
            登出
          </Button>
        </div>
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}

function AuthLoadingState({ label }: { readonly label: string }): ReactElement {
  return (
    <main className={styles.authLoading}>
      <Typography color="text-neutral" variant="body">
        {label}
      </Typography>
    </main>
  );
}

function isPublicPath(pathname: string | null): boolean {
  return PUBLIC_PATHS.some((publicPath) => pathname === publicPath);
}

function readCurrentPath(): string {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
}
