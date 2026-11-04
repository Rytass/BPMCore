import { readFormDataSourceErrorMessage } from '@rytass/bpm-core-client/form';
import { ATTACHMENT_NOT_BINDABLE_ERROR_CODE } from '@rytass/bpm-core-shared/form';

const ATTACHMENT_NOT_BINDABLE_MESSAGE =
  '表單中有附件無法附加到這個案件（只能附加申請人為本案上傳的檔案），請移除後重新上傳再送出。';

/**
 * The message a case page shows for a failed request: a stable server code
 * translated into words, otherwise the server's own message.
 */
export function readErrorMessage(error: unknown): string {
  // DataSource failures arrive as stable codes so the backend never leaks
  // upstream transport detail; translate them instead of showing the raw code.
  const dataSourceMessage = readFormDataSourceErrorMessage(error);

  if (dataSourceMessage) {
    return dataSourceMessage;
  }

  const message = error instanceof Error ? error.message : null;

  // Names the problem, not the attachment ids the server lists.
  if (message?.includes(ATTACHMENT_NOT_BINDABLE_ERROR_CODE)) {
    return ATTACHMENT_NOT_BINDABLE_MESSAGE;
  }

  return message ?? '發生未知錯誤';
}
