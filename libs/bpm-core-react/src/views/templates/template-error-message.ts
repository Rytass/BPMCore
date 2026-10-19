import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { readFormSchemaLintMessage } from '@rytass/bpm-core-client/form';
import { readWorkflowLintMessage } from '@rytass/bpm-core-client/template';
import type { BPMLanguage } from '../../lib/language-provider';

const UNKNOWN_ERROR_MESSAGES: Readonly<Record<BPMLanguage, string>> = {
  en: 'An unknown error occurred',
  'zh-TW': '發生未知錯誤',
};

const WEBHOOK_LINT_PREFIXES: Readonly<Record<BPMLanguage, string>> = {
  en: 'Webhook settings failed the publish check: ',
  'zh-TW': 'Webhook 設定未通過發布檢查：',
};

/**
 * The message the template designer and the compose wizard show for a failed
 * request, in `language`. Publish failures can carry structural lint lines
 * that name nodes by id and stable `FORM_DATA_SOURCE_*` codes; both are mapped
 * to readable copy and every other message is left untouched.
 */
export function readTemplateErrorMessage(
  error: unknown,
  language: BPMLanguage,
  submittedDefinition?: WorkflowDefinition,
): string {
  if (!(error instanceof Error)) {
    return UNKNOWN_ERROR_MESSAGES[language];
  }

  // Structural publish-lint lines name nodes by id; the definition that was
  // just submitted lets them name the node the way the canvas does.
  const message = submittedDefinition
    ? readWorkflowLintMessage(error.message, submittedDefinition, language)
    : error.message;

  // The backend publish lint speaks in paths and codes; say what failed
  // before it, since the designer's own check only runs once the catalog
  // has loaded.
  return message.includes('WORKFLOW_WEBHOOK_')
    ? `${WEBHOOK_LINT_PREFIXES[language]}${message}`
    : readFormSchemaLintMessage(message, language);
}
