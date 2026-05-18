'use client';

import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button, Input, Typography } from '@mezzanine-ui/react';
import { LoginIcon } from '@mezzanine-ui/icons';
import { useAuth } from '../auth-provider';
import { BPMFormField } from '../_components/bpm-form-field';
import { ApiPublicMember, listApiTestMembers } from '../_lib/api-auth-client';
import { sanitizeLoginNextPath } from './login-routing';
import styles from './login.module.scss';

const DEFAULT_IDENTIFIER = 'lin.ceo@example.internal';
const DEFAULT_PASSWORD = 'demo';

export default function LoginPage(): ReactElement {
  const router = useRouter();
  const { loading, login, member } = useAuth();
  const [testMembers, setTestMembers] = useState<readonly ApiPublicMember[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState(DEFAULT_IDENTIFIER);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [submitting, setSubmitting] = useState(false);

  useEffect((): void => {
    if (loading || !member) {
      return;
    }

    router.replace(readNextPath());
  }, [loading, member, router]);

  useEffect((): void => {
    async function loadTestMembers(): Promise<void> {
      try {
        setTestMembers(await listApiTestMembers());
      } catch {
        setTestMembers([]);
      }
    }

    void loadTestMembers();
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setError(null);
      setSubmitting(true);

      try {
        await login({ identifier, password });
        router.replace(readNextPath());
      } catch (loginError: unknown) {
        setError(readErrorMessage(loginError));
      } finally {
        setSubmitting(false);
      }
    },
    [identifier, login, password, router],
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
          <Image
            alt=""
            height={40}
            priority
            src="/rytass-logo.png"
            width={40}
          />
          <div>
            <Typography variant="h3">BPM Admin</Typography>
            <Typography color="text-neutral" variant="body">
              BPM API 登入
            </Typography>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <BPMFormField label="帳號" name="identifier" required>
            <Input
              fullWidth
              name="identifier"
              onChange={handleIdentifierChange}
              placeholder="member id 或 email"
              value={identifier}
            />
          </BPMFormField>

          <BPMFormField label="密碼" name="password" required>
            <Input
              fullWidth
              inputType="password"
              name="password"
              onChange={handlePasswordChange}
              value={password}
              variant="password"
            />
          </BPMFormField>

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

function readNextPath(): string {
  if (typeof window === 'undefined') {
    return '/';
  }

  const next = new URLSearchParams(window.location.search).get('next');

  return sanitizeLoginNextPath(next);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '登入失敗';
}
