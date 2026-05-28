'use client';

import type { ReactElement } from 'react';
import { NavigationIconButton } from '@mezzanine-ui/react';
import { NotificationUnreadIcon } from '@mezzanine-ui/icons';
import { useNotificationDrawer } from '../lib/notification-drawer-provider';
import { useNotificationUnread } from '../lib/notification-unread-provider';
import styles from './bpm-notification-bell-button.module.scss';

export interface BPMNotificationBellButtonProps {
  /** Override the aria-label / tooltip. Defaults to `通知中心`. */
  readonly label?: string;
}

/**
 * Drop-in notification bell. Reads the unread count from
 * `<NotificationUnreadProvider>`, opens the BPM `<NotificationDrawer />`
 * mounted by `<Providers>` (or `<BPMNextProviders>`) on click, and
 * renders a small red badge with the unread count.
 *
 * Use this when the host navigation wants the BPM notification UX with
 * minimum wiring. Hosts that need a fully custom button can skip this
 * widget and consume `useNotificationDrawer()` + `useNotificationUnread()`
 * directly to wire their own trigger.
 *
 * Visual: uses Mezzanine `NavigationIconButton` so the bell aligns with
 * surrounding Mezzanine navigation chrome. The button is decoupled from
 * the `<Navigation>` container — it does not require a Mezzanine
 * navigation tree to render.
 */
export function BPMNotificationBellButton({
  label = '通知中心',
}: BPMNotificationBellButtonProps = {}): ReactElement {
  const { open } = useNotificationDrawer();
  const { unreadCount } = useNotificationUnread();
  const ariaLabel = unreadCount > 0 ? `${label}，${unreadCount} 則未讀` : label;
  return (
    <span className={styles.root}>
      <NavigationIconButton
        aria-label={ariaLabel}
        icon={NotificationUnreadIcon}
        onClick={(): void => {
          open();
        }}
        title={label}
        type="button"
      />
      {unreadCount > 0 ? (
        <span className={styles.badge}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </span>
  );
}
