import { NotificationTypeEnum } from './notification.enums';

interface NotificationTemplate {
  readonly body: string;
  readonly title: string;
}

const TEMPLATES: Readonly<Record<NotificationTypeEnum, NotificationTemplate>> =
  {
    [NotificationTypeEnum.INSTANCE_COMPLETED]: {
      body: '案件 {{instanceTitle}} 已完成。',
      title: '案件已完成',
    },
    [NotificationTypeEnum.SLA_OVERDUE]: {
      body: '{{nodeLabel}} 已於 {{slaDueAt}} 逾時，處理者：{{assigneeMemberId}}。',
      title: 'SLA 已逾時',
    },
    [NotificationTypeEnum.SLA_WARNING]: {
      body: '{{nodeLabel}} 將於 {{slaDueAt}} 到期，請儘快處理。',
      title: 'SLA 即將到期',
    },
    [NotificationTypeEnum.TASK_ASSIGNED]: {
      body: '案件 {{instanceTitle}} 的 {{nodeLabel}} 已指派給你。',
      title: '新的待簽任務',
    },
    [NotificationTypeEnum.TASK_TRANSFERRED]: {
      body: '案件 {{instanceTitle}} 的 {{nodeLabel}} 已轉派給你。',
      title: '新的轉派任務',
    },
  };

export function renderNotificationTemplate({
  payload,
  type,
}: {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly type: NotificationTypeEnum;
}): NotificationTemplate {
  const template = TEMPLATES[type];

  return {
    body: renderTemplate(template.body, payload),
    title: renderTemplate(template.title, payload),
  };
}

function renderTemplate(
  template: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return template.replace(
    /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/gu,
    (_match, key: string): string => readPayloadValue(payload, key),
  );
}

function readPayloadValue(
  payload: Readonly<Record<string, unknown>>,
  path: string,
): string {
  const value = path
    .split('.')
    .reduce<unknown>(
      (currentValue, key) =>
        isRecord(currentValue) ? currentValue[key] : undefined,
      payload,
    );

  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
