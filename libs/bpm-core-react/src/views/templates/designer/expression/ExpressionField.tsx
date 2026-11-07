'use client';

import {
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Badge,
  Button,
  InlineMessage,
  Select,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import type { ExpressionUsagePoint } from '@rytass/bpm-core-shared';
import type { WorkflowExpressionDialect } from '@rytass/bpm-core-shared/workflow';
import type { GraphQlRequestOptions } from '@rytass/bpm-core-client';
import {
  ExpressionCatalogRecord,
  ExpressionEvaluationRecord,
  ExpressionIssueRecord,
  ExpressionPreviewRecord,
  PreviewExpressionInput,
  previewExpression,
  readExpressionCatalog,
  readExpressionIssueMessage,
} from '@rytass/bpm-core-client/template';
import { BPMFormField } from '../../../../components/bpm-form-field';

/**
 * Where the backend check of one expression stands. `UNAVAILABLE`: the check
 * itself failed (network, 403); the field cannot vouch for the expression.
 */
export type ExpressionFieldStatus =
  | 'CHECKING'
  | 'EMPTY'
  | 'INVALID'
  | 'UNAVAILABLE'
  | 'VALID';

export interface ExpressionFieldLint {
  readonly issues: readonly ExpressionIssueRecord[];
  readonly status: ExpressionFieldStatus;
}

/** The backend calls the field makes; injectable for tests and Storybook. */
export interface ExpressionFieldApi {
  readonly preview: (
    input: PreviewExpressionInput,
    options?: GraphQlRequestOptions,
  ) => Promise<ExpressionPreviewRecord>;
  readonly readCatalog: (
    input: Readonly<{
      formDefinitionVersionId?: string | null;
      usagePoint: ExpressionUsagePoint;
    }>,
    options?: GraphQlRequestOptions,
  ) => Promise<ExpressionCatalogRecord>;
}

export interface ExpressionFieldProps {
  readonly api?: ExpressionFieldApi;
  /** Lint delay after the last keystroke. */
  readonly debounceMs?: number;
  readonly dialect: WorkflowExpressionDialect;
  readonly disabled?: boolean;
  /** FLOW_CONDITION: the type of the node the edge leaves. */
  readonly edgeSourceNodeType?: string | null;
  /** Offer a sample-data trial run (EVALUATE) under the field. */
  readonly evaluable?: boolean;
  readonly formDefinitionVersionId?: string | null;
  readonly hintText?: string;
  readonly label: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  /** Every change of the backend check, so a host can block applying. */
  readonly onLintChange?: (lint: ExpressionFieldLint) => void;
  readonly required?: boolean;
  readonly rows?: number;
  /** SERVICE_FORM_FIELD_VALUE: the field the value is written to. */
  readonly targetFieldKey?: string | null;
  readonly usagePoint: ExpressionUsagePoint;
  readonly value: string;
}

const DEFAULT_API: ExpressionFieldApi = {
  preview: previewExpression,
  readCatalog: readExpressionCatalog,
};

const STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
};

const ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--mzn-spacing-gap-base)',
};

interface CatalogOption {
  readonly id: string;
  readonly name: string;
}

/** Catalog entries as insertable snippets: field paths, then `name(`. */
export function readExpressionCatalogOptions(
  catalog: ExpressionCatalogRecord | null,
): readonly CatalogOption[] {
  if (!catalog) {
    return [];
  }

  return [
    ...catalog.roots.map((root) => ({ id: root, name: `${root}（根）` })),
    ...catalog.fields.map((field) => ({
      id: field.path,
      name: `${field.path}（${field.label}）`,
    })),
    ...catalog.functions.map((fn) => ({
      id: `${fn.name}(`,
      name: `${fn.name}(${fn.parameters.map((parameter) => parameter.name).join(', ')})${fn.label ? `（${fn.label}）` : ''}`,
    })),
  ];
}

/** Appends a snippet, separated by a space unless the text already ends in one. */
export function appendExpressionSnippet(value: string, snippet: string): string {
  if (value.length === 0 || /[\s(]$/u.test(value)) {
    return `${value}${snippet}`;
  }

  return `${value} ${snippet}`;
}

/** The status badge copy; the issues themselves are listed underneath. */
export function readExpressionFieldStatusText(
  status: ExpressionFieldStatus,
): string | null {
  switch (status) {
    case 'CHECKING':
      return '後端檢查中';
    case 'INVALID':
      return '未通過檢查';
    case 'UNAVAILABLE':
      return '無法檢查';
    case 'VALID':
      return '通過檢查';
    default:
      return null;
  }
}

const STATUS_BADGE_VARIANT = {
  CHECKING: 'dot-info',
  INVALID: 'dot-error',
  UNAVAILABLE: 'dot-warning',
  VALID: 'dot-success',
} as const;

/** The parsed trial-run sample, or why it cannot be one. */
export function readExpressionSample(
  json: string,
): Readonly<Record<string, unknown>> | string {
  try {
    const parsed: unknown = JSON.parse(json);

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return '樣本資料必須是 JSON 物件，例如 { "form": { "amount": 1200 } }。';
    }

    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return '樣本資料不是有效的 JSON。';
  }
}

/** One trial-run outcome as plain text (rendered as text, never as HTML). */
export function readExpressionEvaluationText(
  evaluation: ExpressionEvaluationRecord,
): string {
  if (evaluation.outcome === 'ERROR') {
    return `試算失敗（${evaluation.errorCode ?? '未知錯誤'}）`;
  }

  return `試算結果：${evaluation.resultJson ?? 'null'}${evaluation.resultType ? `（${evaluation.resultType}）` : ''}`;
}

/**
 * A CEL expression input (Phase 23 P4, ADR 22 §3.8): Mezzanine Textarea plus
 * a catalog picker, with the backend's lint findings listed underneath. The
 * browser only sends text; parsing, linting and the optional trial run all
 * happen on the backend (`previewExpression`, designer-only).
 */
export function ExpressionField({
  api = DEFAULT_API,
  debounceMs = 400,
  dialect,
  disabled = false,
  edgeSourceNodeType = null,
  evaluable = false,
  formDefinitionVersionId = null,
  hintText,
  label,
  name,
  onChange,
  onLintChange,
  required = false,
  rows = 3,
  targetFieldKey = null,
  usagePoint,
  value,
}: ExpressionFieldProps): ReactElement {
  const [lint, setLint] = useState<ExpressionFieldLint>({
    issues: [],
    status: 'EMPTY',
  });
  const [catalog, setCatalog] = useState<ExpressionCatalogRecord | null>(null);
  const [sampleJson, setSampleJson] = useState('{\n  "form": {}\n}');
  const [evaluation, setEvaluation] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const onLintChangeRef = useRef(onLintChange);
  onLintChangeRef.current = onLintChange;

  useEffect((): (() => void) => {
    const controller = new AbortController();

    api
      .readCatalog({ formDefinitionVersionId, usagePoint }, { signal: controller.signal })
      .then((next): void => setCatalog(next))
      .catch((): void => {
        if (!controller.signal.aborted) {
          setCatalog(null);
        }
      });

    return (): void => controller.abort();
  }, [api, formDefinitionVersionId, usagePoint]);

  useEffect((): (() => void) => {
    const expression = value.trim();
    const publish = (next: ExpressionFieldLint): void => {
      setLint(next);
      onLintChangeRef.current?.(next);
    };

    setEvaluation(null);

    if (expression.length === 0) {
      publish({ issues: [], status: 'EMPTY' });

      return (): void => undefined;
    }

    publish({ issues: [], status: 'CHECKING' });

    const controller = new AbortController();
    const timer = setTimeout((): void => {
      api
        .preview(
          {
            dialect,
            edgeSourceNodeType,
            expression,
            formDefinitionVersionId,
            mode: 'LINT',
            targetFieldKey,
            usagePoint,
          },
          { signal: controller.signal },
        )
        .then((preview): void =>
          publish({
            issues: preview.issues,
            status: preview.valid ? 'VALID' : 'INVALID',
          }),
        )
        .catch((): void => {
          if (!controller.signal.aborted) {
            publish({ issues: [], status: 'UNAVAILABLE' });
          }
        });
    }, debounceMs);

    return (): void => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    api,
    debounceMs,
    dialect,
    edgeSourceNodeType,
    formDefinitionVersionId,
    targetFieldKey,
    usagePoint,
    value,
  ]);

  const catalogOptions = useMemo(
    (): readonly CatalogOption[] => readExpressionCatalogOptions(catalog),
    [catalog],
  );
  const statusText = readExpressionFieldStatusText(lint.status);
  const runEvaluation = async (): Promise<void> => {
    const sample = readExpressionSample(sampleJson);

    if (typeof sample === 'string') {
      setEvaluation(sample);

      return;
    }

    setEvaluating(true);

    try {
      const preview = await api.preview({
        dialect,
        edgeSourceNodeType,
        expression: value.trim(),
        formDefinitionVersionId,
        mode: 'EVALUATE',
        sampleContext: sample,
        targetFieldKey,
        usagePoint,
      });

      setEvaluation(
        preview.evaluation
          ? readExpressionEvaluationText(preview.evaluation)
          : '運算式未通過檢查，沒有試算。',
      );
    } catch {
      setEvaluation('無法試算，請稍後再試。');
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <BPMFormField
      hintText={hintText}
      label={label}
      name={name}
      required={required}
      severity={lint.status === 'INVALID' ? 'error' : 'info'}
    >
      <div style={STACK_STYLE}>
        <Textarea
          disabled={disabled}
          name={name}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
            onChange(event.target.value)
          }
          resize="vertical"
          rows={rows}
          value={value}
        />
        <div style={ROW_STYLE}>
          {statusText && lint.status !== 'EMPTY' ? (
            <Badge
              text={statusText}
              variant={STATUS_BADGE_VARIANT[lint.status]}
            />
          ) : null}
          {catalogOptions.length > 0 && !disabled ? (
            <Select
              clearable={false}
              onChange={(option): void => {
                if (option) {
                  onChange(appendExpressionSnippet(value, option.id));
                }
              }}
              options={[...catalogOptions]}
              placeholder="插入欄位或函式"
              value={null}
            />
          ) : null}
          {catalog && !catalog.functionsAvailable ? (
            <Typography variant="caption">
              宿主函式目錄暫時讀不到，只列出欄位。
            </Typography>
          ) : null}
        </div>
        {lint.status === 'UNAVAILABLE' ? (
          <InlineMessage
            content="無法向後端檢查這個運算式，發布時仍會再檢查。"
            severity="warning"
          />
        ) : null}
        {lint.issues.map((issue) => (
          <InlineMessage
            content={readExpressionIssueMessage(issue)}
            key={`${issue.code}:${issue.subject ?? ''}`}
            severity={issue.severity === 'ERROR' ? 'error' : 'warning'}
          />
        ))}
        {evaluable ? (
          <div style={STACK_STYLE}>
            <Textarea
              aria-label={`${label}試算樣本`}
              disabled={disabled}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setSampleJson(event.target.value)
              }
              resize="vertical"
              rows={3}
              value={sampleJson}
            />
            <div style={ROW_STYLE}>
              <Button
                disabled={disabled || evaluating || lint.status !== 'VALID'}
                onClick={(): void => {
                  void runEvaluation();
                }}
                type="button"
                variant="base-secondary"
              >
                以樣本試算
              </Button>
              {evaluation === null ? null : (
                <Typography variant="body">{evaluation}</Typography>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </BPMFormField>
  );
}
