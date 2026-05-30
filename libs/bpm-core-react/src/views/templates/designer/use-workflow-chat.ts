'use client';

import { useMemo } from 'react';
import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai';
import type { WorkflowDesignerController } from './use-workflow-designer-controller';

/**
 * Connects the workflow designer chat UI to the LLM.
 *
 * The server route (`@rytass/bpm-core-react/next/workflow-chat-route`) advertises
 * the workflow tools with no `execute`, so every tool call is forwarded here.
 * `onToolCall` runs it against the same {@link WorkflowDesignerController} the UI
 * uses — so the assistant draws on the canvas exactly as a user would — and feeds
 * the resulting snapshot back to the model, forming the observe→act loop.
 *
 * All tools are dynamic on the client (their names are not statically wired into
 * `useChat`), so we handle (not skip) `toolCall.dynamic`.
 */
export interface UseWorkflowChatOptions {
  readonly controller: WorkflowDesignerController;
  /** Chat API route. Defaults to same-origin `/api/chat`. */
  readonly api?: string;
}

export function useWorkflowChat({
  controller,
  api = '/api/chat',
}: UseWorkflowChatOptions): UseChatHelpers<UIMessage> {
  const transport = useMemo(
    (): DefaultChatTransport<UIMessage> =>
      new DefaultChatTransport<UIMessage>({ api }),
    [api],
  );

  const chat = useChat<UIMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }): Promise<void> {
      const result = await controller.executeTool(
        toolCall.toolName,
        toolCall.input,
      );

      if (result.ok) {
        chat.addToolOutput({
          output: result.kind === 'query' ? result.data : result.snapshot,
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
        });

        return;
      }

      chat.addToolOutput({
        errorText: result.error,
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
      });
    },
  });

  return chat;
}
