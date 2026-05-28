'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useEffect,
  useState,
} from 'react';
import {
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  PageHeader,
  RadioGroup,
  Section,
  SectionGroup,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import { useAuth } from '../../../lib/auth-provider';
import {
  NotificationDigestMode,
  NotificationPreferenceRecord,
  readNotificationPreference,
  updateNotificationPreference,
} from '@rytass/bpm-core-client/workflow';
import styles from './notification-settings.module.scss';

interface DigestOption {
  readonly id: NotificationDigestMode;
  readonly name: string;
}

type EnabledSegmentValue = 'OFF' | 'ON';

interface EnabledSegmentOption {
  readonly id: EnabledSegmentValue;
  readonly name: string;
}

const DIGEST_OPTIONS: readonly DigestOption[] = [
  { id: 'INSTANT', name: '即時通知' },
  { id: 'DAILY', name: '每日摘要' },
];

const ENABLED_SEGMENT_OPTIONS: readonly EnabledSegmentOption[] = [
  { id: 'ON', name: '開' },
  { id: 'OFF', name: '關' },
];

const DEFAULT_PREFERENCE: NotificationPreferenceRecord = {
  emailDigestMode: 'INSTANT',
  emailEnabled: true,
  inAppEnabled: true,
  memberId: '',
  quietHoursEnd: null,
  quietHoursStart: null,
  updatedAt: '',
};


export function SettingsNotificationsView(): ReactElement {
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const [preference, setPreference] =
    useState<NotificationPreferenceRecord>(DEFAULT_PREFERENCE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect((): void => {
    if (!currentMemberId) {
      return;
    }

    setLoading(true);
    setError(null);

    readNotificationPreference(currentMemberId)
      .then((nextPreference): void => {
        setPreference(nextPreference);
      })
      .catch((requestError: unknown): void => {
        setError(readErrorMessage(requestError));
      })
      .finally((): void => {
        setLoading(false);
      });
  }, [currentMemberId]);

  async function handlePreferenceChange(
    nextPreference: NotificationPreferenceRecord,
  ): Promise<void> {
    if (!currentMemberId || saving) {
      return;
    }

    const previousPreference = preference;
    setPreference(nextPreference);
    setSaving(true);

    try {
      setPreference(
        await updateNotificationPreference({
          emailDigestMode: nextPreference.emailDigestMode,
          emailEnabled: nextPreference.emailEnabled,
          inAppEnabled: nextPreference.inAppEnabled,
          memberId: currentMemberId,
          quietHoursEnd: nextPreference.quietHoursEnd,
          quietHoursStart: nextPreference.quietHoursStart,
        }),
      );
    } catch (requestError: unknown) {
      setPreference(previousPreference);
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const controlsDisabled = loading || saving;

  return (
    <>
        <PageHeader>
          <ContentHeader
            description="調整站內通知、Email 通知與摘要頻率。"
            title="通知設定"
          />
        </PageHeader>

        <SectionGroup>
          <Section
            filterArea={
              <FilterArea className={styles.preferenceFilter} isDirty={false}>
                <FilterLine>
                  <Filter minWidth={160} span={1}>
                    <FormField
                      layout={FormFieldLayout.VERTICAL}
                      name="inAppEnabled"
                      style={FILTER_FIELD_STYLE}
                    >
                      <div className={styles.segmentFilterControl}>
                        <span className={styles.segmentFilterLabel}>
                          站內通知
                        </span>
                        <RadioGroup
                          disabled={controlsDisabled}
                          name="inAppEnabled"
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            void handlePreferenceChange({
                              ...preference,
                              inAppEnabled: readEnabledSegmentValue(
                                event.target.value,
                              ),
                            });
                          }}
                          options={[...ENABLED_SEGMENT_OPTIONS]}
                          size="sub"
                          type="segment"
                          value={readEnabledSegmentValueId(
                            preference.inAppEnabled,
                          )}
                        />
                      </div>
                    </FormField>
                  </Filter>
                  <Filter minWidth={180} span={1}>
                    <FormField
                      layout={FormFieldLayout.VERTICAL}
                      name="emailEnabled"
                      style={FILTER_FIELD_STYLE}
                    >
                      <div className={styles.segmentFilterControl}>
                        <span className={styles.segmentFilterLabel}>
                          Email 通知
                        </span>
                        <RadioGroup
                          disabled={controlsDisabled}
                          name="emailEnabled"
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            void handlePreferenceChange({
                              ...preference,
                              emailEnabled: readEnabledSegmentValue(
                                event.target.value,
                              ),
                            });
                          }}
                          options={[...ENABLED_SEGMENT_OPTIONS]}
                          size="sub"
                          type="segment"
                          value={readEnabledSegmentValueId(
                            preference.emailEnabled,
                          )}
                        />
                      </div>
                    </FormField>
                  </Filter>
                  <Filter minWidth={280} span={2}>
                    <FormField
                      fullWidth
                      layout={FormFieldLayout.VERTICAL}
                      name="emailDigestMode"
                      style={FILTER_FIELD_STYLE}
                    >
                      <div className={styles.segmentFilterControl}>
                        <span className={styles.segmentFilterLabel}>
                          Email 頻率
                        </span>
                        <RadioGroup
                          disabled={controlsDisabled}
                          name="emailDigestMode"
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            void handlePreferenceChange({
                              ...preference,
                              emailDigestMode: readDigestMode(
                                event.target.value,
                              ),
                            });
                          }}
                          options={[...DIGEST_OPTIONS]}
                          size="sub"
                          type="segment"
                          value={preference.emailDigestMode}
                        />
                      </div>
                    </FormField>
                  </Filter>
                </FilterLine>
              </FilterArea>
            }
          >
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : (
              <Typography color="text-neutral" variant="body">
                偏好設定會立即生效。
              </Typography>
            )}
          </Section>
        </SectionGroup>
      </>
  );
}

const FILTER_FIELD_STYLE = {
  minWidth: 0,
  whiteSpace: 'nowrap',
} satisfies CSSProperties;

function readDigestMode(value: unknown): NotificationDigestMode {
  return value === 'DAILY' ? 'DAILY' : 'INSTANT';
}

function readEnabledSegmentValue(value: unknown): boolean {
  return value !== 'OFF';
}

function readEnabledSegmentValueId(enabled: boolean): EnabledSegmentValue {
  return enabled ? 'ON' : 'OFF';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
