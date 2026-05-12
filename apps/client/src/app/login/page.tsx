'use client';

import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button, FormField, Input, Typography } from '@mezzanine-ui/react';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import { LoginIcon } from '@mezzanine-ui/icons';
import { useAuth } from '../auth-provider';
import {
  ApiPublicMember,
  listApiDemoMembers,
} from '../_lib/api-auth-client';
import styles from './login.module.scss';

const DEFAULT_IDENTIFIER = 'lin.ceo@example.internal';
const DEFAULT_PASSWORD = 'demo';

export default function LoginPage(): ReactElement {
  const router = useRouter();
  const { loading, login, member } = useAuth();
  const [demoMembers, setDemoMembers] = useState<
    readonly ApiPublicMember[]
  >([]);
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
    async function loadDemoMembers(): Promise<void> {
      try {
        setDemoMembers(await listApiDemoMembers());
      } catch {
        setDemoMembers([]);
      }
    }

    void loadDemoMembers();
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
          <FormField
            fullWidth
            label="帳號"
            layout={FormFieldLayout.VERTICAL}
            name="identifier"
            required
          >
            <Input
              fullWidth
              name="identifier"
              onChange={handleIdentifierChange}
              placeholder="member id 或 email"
              value={identifier}
            />
          </FormField>

          <FormField
            fullWidth
            label="密碼"
            layout={FormFieldLayout.VERTICAL}
            name="password"
            required
          >
            <Input
              fullWidth
              inputType="password"
              name="password"
              onChange={handlePasswordChange}
              value={password}
              variant="password"
            />
          </FormField>

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

        {demoMembers.length ? (
          <div className={styles.demoUsers}>
            <Typography color="text-neutral" variant="caption">
              Demo 帳號
            </Typography>
            <div className={styles.demoUserList}>
              {demoMembers.map((demoMember) => (
                <button
                  className={styles.demoUserButton}
                  key={demoMember.memberId}
                  onClick={(): void => setIdentifier(demoMember.email)}
                  type="button"
                >
                  <span>{demoMember.name}</span>
                  <span>{demoMember.email}</span>
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

  return next?.startsWith('/') ? next : '/';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '登入失敗';
}
