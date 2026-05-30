'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { WORKFLOW_TOOLSET } from '@rytass/bpm-core-shared';
import type { WorkflowDesignerController } from './use-workflow-designer-controller';

/**
 * EXPERIMENTAL offline fallback that drives the workflow toolset with Chrome's
 * built-in on-device model (Prompt API / `LanguageModel`, Gemini Nano).
 *
 * The Prompt API has **no native tool-calling**, so this runs a hand-written
 * observe→act loop: each step the model is constrained (JSON Schema) to emit a
 * single decision — call a tool (name + input) or reply with a message. Tool
 * calls run against the same {@link WorkflowDesignerController} the UI and the
 * online assistant use; the resulting snapshot is fed back for the next step.
 *
 * This path is capability-gated: when `available` is false the UI hides offline
 * mode entirely, so unsupported browsers never see it. It cannot be verified in
 * CI (needs a flag-enabled Chrome + downloaded model).
 */

const MAX_STEPS = 12;

type ChromeAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

interface ChromeLanguageModelSession {
  prompt(
    input: string,
    options?: { readonly responseConstraint?: unknown },
  ): Promise<string>;
  destroy(): void;
}

interface ChromeLanguageModelStatic {
  availability(): Promise<ChromeAvailability>;
  create(options?: {
    readonly initialPrompts?: readonly {
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }[];
  }): Promise<ChromeLanguageModelSession>;
}

function readChromeLanguageModel(): ChromeLanguageModelStatic | null {
  const candidate = (globalThis as { readonly LanguageModel?: unknown })
    .LanguageModel;

  return candidate && typeof candidate === 'object'
    ? (candidate as ChromeLanguageModelStatic)
    : null;
}

/** One structured decision per loop step (enforced via responseConstraint). */
interface ChromeStepDecision {
  readonly action: 'tool' | 'message';
  readonly tool?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly text?: string;
}

const DECISION_SCHEMA = {
  additionalProperties: false,
  properties: {
    action: { enum: ['tool', 'message'], type: 'string' },
    input: { type: 'object' },
    text: { type: 'string' },
    tool: { type: 'string' },
  },
  required: ['action'],
  type: 'object',
} as const;

function readOfflineSystemPrompt(): string {
  const toolLines = WORKFLOW_TOOLSET.map(
    (tool) =>
      `- ${tool.name}(${JSON.stringify(
        (tool.inputSchema as { readonly properties?: unknown }).properties ?? {},
      )}): ${tool.description}`,
  ).join('\n');

  return `你是「簽核流程設計器」頁面的離線 AI 助理。只能透過下列工具操作這個流程畫布，其他請求一律婉拒並引導回流程設計。

每一步只輸出一個 JSON 決策物件：
- 呼叫工具：{"action":"tool","tool":"<工具名>","input":{...}}
- 回覆使用者（完成或詢問）：{"action":"message","text":"<繁體中文訊息>"}

規則：先用 get_workflow_snapshot 了解現況再規劃；完成後用 validate_workflow 檢查並以 message 說明做了什麼。

可用工具：
${toolLines}`;
}

export interface UseChromeWorkflowChatResult {
  /** True only when the on-device model is usable in this browser. */
  readonly available: boolean;
  readonly messages: readonly UIMessage[];
  readonly status: 'ready' | 'submitted' | 'streaming' | 'error';
  readonly send: (text: string) => void;
}

export function useChromeWorkflowChat({
  controller,
}: {
  readonly controller: WorkflowDesignerController;
}): UseChromeWorkflowChatResult {
  const [available, setAvailable] = useState(false);
  const [messages, setMessages] = useState<readonly UIMessage[]>([]);
  const [status, setStatus] =
    useState<UseChromeWorkflowChatResult['status']>('ready');
  const idRef = useRef(0);

  useEffect((): void => {
    const model = readChromeLanguageModel();

    if (!model) {
      return;
    }

    void model
      .availability()
      .then((availability): void => {
        setAvailable(availability !== 'unavailable');
      })
      .catch((): void => setAvailable(false));
  }, []);

  const appendMessage = useCallback(
    (role: UIMessage['role'], text: string): void => {
      idRef.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: `chrome-${idRef.current}`,
          parts: [{ text, type: 'text' }],
          role,
        } as UIMessage,
      ]);
    },
    [],
  );

  const send = useCallback(
    (text: string): void => {
      const model = readChromeLanguageModel();

      if (!model || status !== 'ready') {
        return;
      }

      appendMessage('user', text);
      setStatus('submitted');

      void runOfflineLoop({
        appendMessage,
        controller,
        model,
        userText: text,
      })
        .then((): void => setStatus('ready'))
        .catch((error: unknown): void => {
          appendMessage('assistant', readErrorMessage(error));
          setStatus('error');
        });
    },
    [appendMessage, controller, status],
  );

  return { available, messages, send, status };
}

async function runOfflineLoop({
  appendMessage,
  controller,
  model,
  userText,
}: {
  readonly appendMessage: (role: UIMessage['role'], text: string) => void;
  readonly controller: WorkflowDesignerController;
  readonly model: ChromeLanguageModelStatic;
  readonly userText: string;
}): Promise<void> {
  const session = await model.create({
    initialPrompts: [{ content: readOfflineSystemPrompt(), role: 'system' }],
  });

  try {
    let nextPrompt = `使用者需求：${userText}\n目前流程：${JSON.stringify(
      controller.snapshot,
    )}`;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const raw = await session.prompt(nextPrompt, {
        responseConstraint: DECISION_SCHEMA,
      });
      const decision = parseDecision(raw);

      if (!decision || decision.action === 'message') {
        appendMessage(
          'assistant',
          decision?.text ?? '我已完成可處理的部分。',
        );

        return;
      }

      if (!decision.tool) {
        appendMessage('assistant', '我已完成可處理的部分。');

        return;
      }

      const result = await controller.executeTool(
        decision.tool,
        decision.input ?? {},
      );

      if (result.ok) {
        const observation =
          result.kind === 'query' ? result.data : result.snapshot;

        appendMessage('assistant', `⚙ ${decision.tool}`);
        nextPrompt = `工具 ${decision.tool} 已執行。最新流程：${JSON.stringify(
          observation,
        )}\n請決定下一步。`;
      } else {
        nextPrompt = `工具 ${decision.tool} 失敗：${result.error}\n請改用其他方式或回覆使用者。`;
      }
    }

    appendMessage('assistant', '已達到單次操作步數上限，請告訴我下一步。');
  } finally {
    session.destroy();
  }
}

function parseDecision(raw: string): ChromeStepDecision | null {
  try {
    const value: unknown = JSON.parse(raw);

    if (
      typeof value === 'object' &&
      value !== null &&
      (value as { action?: unknown }).action !== undefined
    ) {
      return value as ChromeStepDecision;
    }

    return null;
  } catch {
    return null;
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `離線模式發生錯誤：${error.message}`
    : '離線模式發生未知錯誤。';
}
