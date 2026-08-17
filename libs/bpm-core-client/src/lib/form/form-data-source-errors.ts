/**
 * Stable error codes raised by the BPM form DataSource GraphQL surface.
 *
 * The backend deliberately returns codes rather than prose so it never leaks an
 * upstream URL, header, query or response body. Consumers are expected to map
 * them to their own copy; `readFormDataSourceErrorMessage` is the default
 * mapping used by the bundled React views.
 */
export const FORM_DATA_SOURCE_ERROR_CODES = [
  'FORM_DATA_SOURCE_FIELD_NOT_DYNAMIC',
  'FORM_DATA_SOURCE_INVALID_BINDING',
  'FORM_DATA_SOURCE_INVALID_DESCRIPTOR',
  'FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT',
  'FORM_DATA_SOURCE_MISSING',
  'FORM_DATA_SOURCE_PARAMETER_LIMIT_EXCEEDED',
  'FORM_DATA_SOURCE_PROVIDER_FAILURE',
  'FORM_DATA_SOURCE_RESULT_LIMIT_EXCEEDED',
  'FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN',
  'FORM_DATA_SOURCE_SEARCH_NOT_SUPPORTED',
  'FORM_DATA_SOURCE_SEARCH_TOO_SHORT',
  'FORM_DATA_SOURCE_TIMEOUT',
  'FORM_DATA_SOURCE_UNSUPPORTED_CONTROL',
  'FORM_DATA_SOURCE_VALUE_NOT_RESOLVED',
  'FORM_DATA_SOURCE_VERSION_MISSING',
  'FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES',
] as const;

export type FormDataSourceErrorCode =
  (typeof FORM_DATA_SOURCE_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<FormDataSourceErrorCode, string>> = {
  FORM_DATA_SOURCE_FIELD_NOT_DYNAMIC: '此欄位不是動態選項欄位。',
  FORM_DATA_SOURCE_INVALID_BINDING:
    '選項查詢條件不正確，請重新確認表單內容。',
  FORM_DATA_SOURCE_INVALID_DESCRIPTOR:
    '選項來源設定不正確，請聯絡系統管理員。',
  FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT:
    '選項來源回傳的資料不正確，請聯絡系統管理員。',
  FORM_DATA_SOURCE_MISSING: '選項來源已不存在，請聯絡系統管理員。',
  FORM_DATA_SOURCE_PARAMETER_LIMIT_EXCEEDED:
    '選項查詢條件過大，請縮減表單內容。',
  FORM_DATA_SOURCE_PROVIDER_FAILURE:
    '選項來源目前無法回應，請稍後再試。',
  FORM_DATA_SOURCE_RESULT_LIMIT_EXCEEDED:
    '選項數量超過上限，請縮小查詢範圍。',
  FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN: '沒有權限查詢此欄位的選項。',
  FORM_DATA_SOURCE_SEARCH_NOT_SUPPORTED: '此選項來源不支援搜尋。',
  FORM_DATA_SOURCE_SEARCH_TOO_SHORT: '請輸入更多搜尋文字。',
  FORM_DATA_SOURCE_TIMEOUT: '選項來源回應逾時，請稍後再試。',
  FORM_DATA_SOURCE_UNSUPPORTED_CONTROL:
    '此選項來源不支援目前的欄位型態。',
  FORM_DATA_SOURCE_VALUE_NOT_RESOLVED: '已選取的選項已失效，請重新選擇。',
  FORM_DATA_SOURCE_VERSION_MISSING:
    '選項來源版本已不存在，請聯絡系統管理員。',
  FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES: '請先填寫相依欄位。',
};

/**
 * Token-bounded so `XFORM_DATA_SOURCE_TIMEOUT` is not mistaken for a code, and
 * digit-tolerant so a future code is still recognised as one of ours.
 */
const ERROR_CODE_PATTERN =
  /(?<![A-Za-z0-9_])FORM_DATA_SOURCE_[A-Z0-9_]+(?![A-Za-z0-9_])/u;

/**
 * The only lint shape that carries an error code, anchored to the exact path the
 * backend emits AND to the start of a `'; '`-joined lint segment:
 * `schema.fields[<n>].dataSource <CODE>`.
 *
 * Segment anchoring is what closes the whole family of adversarial names: a
 * host- or designer-chosen parameter or field key can only ever appear after a
 * prose prefix
 * within its segment, never at the segment start, so no name — however it is
 * spelled — can be mistaken for an emitted code.
 *
 * Every other lint line is prose that may quote a host- or designer-chosen name — a
 * DataSource parameter, a descriptor field, a form field key — and such a name
 * may legitimately look like an error code. Replacing only this shape is why the
 * formatter needs no allowlist of prose shapes to avoid rewriting those names.
 */
const LINT_LINE_CODE_PATTERN =
  /(^|; )(schema\.fields\[\d+\]\.dataSource) (FORM_DATA_SOURCE_[A-Z0-9_]+)(?![A-Za-z0-9_])/gu;

/**
 * Recognises publish-lint output by the paths it starts its lines with — both
 * indexed forms (`schema.fields[0]...`) and the unindexed ones the structural
 * lint emits (`schema.fields fieldKey is duplicated: <key>`). Inside
 * such a message only the code-bearing shape above may be rewritten; a bare or
 * wrapped code arrives as a plain error message instead and is mapped whole.
 */
const LINT_MESSAGE_PATTERN = /(?:^|; )(?:schema\.|descriptor\.)/u;

/**
 * Shown when the backend answers with a DataSource code this package does not
 * know yet — a newer core against an older client. Without it the raw code
 * would reach the screen.
 */
const UNKNOWN_CODE_MESSAGE = '選項來源發生問題，請稍後再試或聯絡系統管理員。';

/**
 * Extracts the DataSource error code carried by a rejected request, whether it
 * arrives as the bare code, a GraphQL error message, or an `Error` wrapping
 * either. Returns `null` for anything that is not a DataSource failure.
 */
export function readFormDataSourceErrorCode(
  error: unknown,
): FormDataSourceErrorCode | null {
  const text =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  const match = ERROR_CODE_PATTERN.exec(text);

  return match &&
    (FORM_DATA_SOURCE_ERROR_CODES as readonly string[]).includes(match[0])
    ? (match[0] as FormDataSourceErrorCode)
    : null;
}

/**
 * Maps a rejected request to display copy. Returns `null` only when the failure
 * is not a DataSource error at all, so callers can fall back to their own
 * message; an unrecognised `FORM_DATA_SOURCE_*` code still yields readable copy
 * rather than leaking the code itself.
 */
export function readFormDataSourceErrorMessage(error: unknown): string | null {
  const code = readFormDataSourceErrorCode(error);

  if (code) {
    return ERROR_MESSAGES[code];
  }

  return readsAsFormDataSourceCode(error) ? UNKNOWN_CODE_MESSAGE : null;
}

/**
 * True when the failure carries a `FORM_DATA_SOURCE_*` token, including codes
 * this package does not map yet.
 */
function readsAsFormDataSourceCode(error: unknown): boolean {
  const text =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';

  return ERROR_CODE_PATTERN.test(text);
}

/**
 * Rewrites a publish-lint line such as
 * `schema.fields[1].dataSource FORM_DATA_SOURCE_MISSING` into readable copy
 * while keeping the field path that tells the designer where to look. Lines
 * without a DataSource code are returned unchanged.
 */
export function readFormSchemaLintMessage(error: string): string {
  // A publish failure joins several lint lines, so map every code-bearing
  // occurrence and leave all prose — including author-chosen names that look like
  // codes — exactly as the backend wrote it.
  const mapped = error.replace(
    LINT_LINE_CODE_PATTERN,
    (_match, separator: string, path: string, code: string): string =>
      `${separator}${path} ${readCodeMessage(code)}`,
  );

  if (LINT_MESSAGE_PATTERN.test(error)) {
    return mapped;
  }

  // Not lint output: the message is a bare code or wraps one (for example
  // `GraphQL error: FORM_DATA_SOURCE_TIMEOUT`), so map it as a whole.
  return readFormDataSourceErrorMessage(error) ?? error;
}

function readCodeMessage(code: string): string {
  return (FORM_DATA_SOURCE_ERROR_CODES as readonly string[]).includes(code)
    ? ERROR_MESSAGES[code as FormDataSourceErrorCode]
    : UNKNOWN_CODE_MESSAGE;
}
