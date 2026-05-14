import { NotificationTypeEnum } from './notification.enums';
import { renderNotificationTemplate } from './notification-template';

describe('renderNotificationTemplate', () => {
  it('renders built-in templates with simple path replacement', (): void => {
    expect(
      renderNotificationTemplate({
        payload: {
          instanceTitle: '採購申請',
          nodeLabel: '主管簽核',
        },
        type: NotificationTypeEnum.TASK_ASSIGNED,
      }),
    ).toEqual({
      body: '案件 採購申請 的 主管簽核 已指派給你。',
      title: '新的待簽任務',
    });
  });

  it('renders custom body templates with handlebars', (): void => {
    expect(
      renderNotificationTemplate({
        customTemplate: '{{instanceTitle}} / {{node.label}}',
        engine: 'handlebars',
        payload: {
          instanceTitle: '合約審核',
          node: { label: '法務簽核' },
        },
        type: NotificationTypeEnum.TASK_ASSIGNED,
      }).body,
    ).toBe('合約審核 / 法務簽核');
  });
});
