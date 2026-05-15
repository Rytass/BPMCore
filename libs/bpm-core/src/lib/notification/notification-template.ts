import * as Handlebars from 'handlebars';
import { NotificationTypeEnum } from './notification.enums';
import { NotificationTemplateEngine } from './notification-options';

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
    [NotificationTypeEnum.WORKFLOW_NOTIFICATION]: {
      body: '{{message}}',
      title: '{{nodeLabel}}',
    },
  };

export function renderNotificationTemplate({
  customTemplate,
  engine = 'simple',
  payload,
  type,
}: {
  readonly customTemplate?: string | null;
  readonly engine?: NotificationTemplateEngine;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly type: NotificationTypeEnum;
}): NotificationTemplate {
  const template = TEMPLATES[type];
  const bodyTemplate = customTemplate?.trim() || template.body;

  return {
    body: renderTemplate(bodyTemplate, payload, engine),
    title: renderTemplate(template.title, payload, engine),
  };
}

function renderTemplate(
  template: string,
  payload: Readonly<Record<string, unknown>>,
  engine: NotificationTemplateEngine,
): string {
  if (engine === 'handlebars') {
    return Handlebars.compile(template, {
      noEscape: true,
      strict: false,
    })(payload);
  }

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
