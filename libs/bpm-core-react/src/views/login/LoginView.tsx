'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Button, Input, Typography } from '@mezzanine-ui/react';
import { LoginIcon } from '@mezzanine-ui/icons';
import {
  listApiTestMembers,
  type ApiPublicMember,
} from '@rytass/bpm-core-client';
import { useAuth } from '../../lib/auth-provider';
import { useRouterAdapter } from '../../lib/router-adapter';
import styles from './login.module.scss';

export interface LoginViewProps {
  /**
   * Logo image URL. Renders an inline `<img>` so the view stays framework
   * agnostic (no `next/image` dependency). Defaults to
   * `/rytass-logo.png` — host should serve a static asset at that path or
   * override via this prop.
   */
  readonly logoSrc?: string;
  /**
   * Pre-fill the identifier input. Defaults to the seeded demo account
   * email so the form is usable out of the box.
   */
  readonly defaultIdentifier?: string;
  /**
   * Pre-fill the password input. Defaults to the seeded demo password
   * (`'demo'`). Production hosts should pass an empty string.
   */
  readonly defaultPassword?: string;
  /**
   * Custom redirect target after a successful login. Defaults to reading
   * `?next=` from the host router's search params, falling back to `'/'`.
   */
  readonly defaultNextPath?: string;
  /**
   * Override the BPM admin brand title shown above the form. Defaults to
   * `'BPM Admin'`.
   */
  readonly brandTitle?: string;
  /**
   * Override the brand subtitle shown above the form. Defaults to
   * `'BPM API 登入'`.
   */
  readonly brandSubtitle?: string;
}

const DEFAULT_LOGO = '/rytass-logo.png';
const DEFAULT_IDENTIFIER = 'lin.ceo@example.internal';
const DEFAULT_PASSWORD = 'demo';

/**
 * Login UI for the BPM admin host. Renders the brand mark, identifier /
 * password fields, and a "test members" picker fed by
 * `listApiTestMembers()`. Self-contained: composes Mezzanine UI primitives,
 * reads the auth context, and uses the host router adapter to redirect on
 * success.
 *
 * Wrap with `<AuthProvider>` (and indirectly `<RouterAdapterProvider>`)
 * higher in the tree. The `pages/login` subpath ships a thin Next.js
 * wrapper that exports `default` (Server Component) and `metadata`.
 */
export function LoginView({
  logoSrc = DEFAULT_LOGO,
  defaultIdentifier = DEFAULT_IDENTIFIER,
  defaultPassword = DEFAULT_PASSWORD,
  defaultNextPath,
  brandTitle = 'BPM Admin',
  brandSubtitle = 'BPM API 登入',
}: LoginViewProps = {}): ReactElement {
  const router = useRouterAdapter();
  const { loading, login, member } = useAuth();
  const [testMembers, setTestMembers] = useState<readonly ApiPublicMember[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState(defaultIdentifier);
  const [password, setPassword] = useState(defaultPassword);
  const [submitting, setSubmitting] = useState(false);

  useEffect((): void => {
    if (loading || !member) return;
    router.replace(resolveNextPath(defaultNextPath));
  }, [defaultNextPath, loading, member, router]);

  useEffect((): void => {
    void (async () => {
      try {
        setTestMembers(await listApiTestMembers());
      } catch {
        setTestMembers([]);
      }
    })();
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        await login({ identifier, password });
        router.replace(resolveNextPath(defaultNextPath));
      } catch (loginError: unknown) {
        setError(readErrorMessage(loginError));
      } finally {
        setSubmitting(false);
      }
    },
    [defaultNextPath, identifier, login, password, router],
  );

  function handleIdentifierChange(event: ChangeEvent<HTMLInputElement>): void {
    setIdentifier(event.target.value);
  }
  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>): void {
    setPassword(event.target.value);
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginPanel}>
        <div className={styles.brand}>
          <img alt="" className={styles.brandLogo} src={logoSrc} />
          <div>
            <Typography variant="h3">{brandTitle}</Typography>
            <Typography color="text-neutral" variant="body">
              {brandSubtitle}
            </Typography>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            <Typography color="text-neutral" variant="caption">
              帳號
            </Typography>
            <Input
              fullWidth
              name="identifier"
              onChange={handleIdentifierChange}
              placeholder="member id 或 email"
              value={identifier}
            />
          </label>

          <label>
            <Typography color="text-neutral" variant="caption">
              密碼
            </Typography>
            <Input
              fullWidth
              inputType="password"
              name="password"
              onChange={handlePasswordChange}
              value={password}
              variant="password"
            />
          </label>

          {error ? (
            <Typography color="text-error" variant="body">
              {error}
            </Typography>
          ) : null}

          <Button
            disabled={submitting}
            icon={LoginIcon}
            iconType="leading"
            type="submit"
            variant="base-primary"
          >
            登入
          </Button>
        </form>

        {testMembers.length ? (
          <div className={styles.demoUsers}>
            <Typography color="text-neutral" variant="caption">
              測試帳號
            </Typography>
            <div className={styles.demoUserList}>
              {testMembers.map((testMember) => (
                <button
                  className={styles.demoUserButton}
                  key={testMember.memberId}
                  onClick={(): void => setIdentifier(testMember.email)}
                  type="button"
                >
                  <span>{testMember.name}</span>
                  <span>{testMember.email}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function resolveNextPath(fallback: string | undefined): string {
  if (fallback && fallback.startsWith('/') && !fallback.startsWith('//')) {
    return fallback;
  }
  const params = readBrowserSearchParams();
  const next = params.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/';
  }
  return next;
}

function readBrowserSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '登入失敗';
}
