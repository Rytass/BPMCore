'use client';

import { useEffect } from 'react';
import { NotificationCenter } from '@mezzanine-ui/react';
import { readApiBaseUrl } from '@rytass/bpm-core-client';
import { useBPMMember } from '@rytass/bpm-core-react';

/**
 * Staging showcase for NOTIFY webhooks: listens to the API's showcase stream
 * (`apps/api/src/app/api-showcase-webhook.controller.ts`) and shows each
 * delivery of the "展示：右上角通知" endpoint as a top-right notification.
 *
 * Host-side demo only. Where the API does not serve the stream (production,
 * or the showcase switched off) EventSource gets a non-200 answer and stops
 * on its own, so this renders nothing and costs one request per sign-in.
 */

export const SHOWCASE_WEBHOOK_STREAM_PATH =
  '/showcase/webhook-notifications/stream';

/** How long a notification stays before it closes itself. */
export const SHOWCASE_WEBHOOK_NOTIFICATION_DURATION_MS = 8_000;

export interface ShowcaseWebhookNotification {
  readonly deliveryId: string;
  readonly description: string;
  readonly title: string;
}

export function parseShowcaseWebhookNotification(
  data: unknown,
): ShowcaseWebhookNotification | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    const value: unknown = JSON.parse(data);

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const { deliveryId, description, title } = value as Readonly<
      Record<string, unknown>
    >;

    return typeof deliveryId === 'string' &&
      typeof description === 'string' &&
      typeof title === 'string'
      ? { deliveryId, description, title }
      : null;
  } catch {
    return null;
  }
}

export function HostShowcaseWebhookNotifications(): null {
  const member = useBPMMember();
  const memberId = member?.memberId ?? null;

  useEffect((): (() => void) | undefined => {
    if (!memberId || typeof EventSource === 'undefined') {
      return undefined;
    }

    // Reopened per member: the stream is authorized by the session cookie
    // the API set at sign-in.
    const source = new EventSource(
      `${readApiBaseUrl()}${SHOWCASE_WEBHOOK_STREAM_PATH}`,
      { withCredentials: true },
    );

    source.addEventListener('notification', (event: MessageEvent): void => {
      const notification = parseShowcaseWebhookNotification(event.data);

      if (notification) {
        NotificationCenter.info({
          description: notification.description,
          duration: SHOWCASE_WEBHOOK_NOTIFICATION_DURATION_MS,
          reference: notification.deliveryId,
          title: notification.title,
        });
      }
    });

    return (): void => {
      source.close();
    };
  }, [memberId]);

  return null;
}
