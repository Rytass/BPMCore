'use client';

import {
  Fragment,
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import Drawer from '@mezzanine-ui/react/Drawer';
import { Button, Textarea, Typography } from '@mezzanine-ui/react';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import type { WorkflowDesignerController } from './use-workflow-designer-controller';
import { useWorkflowChat } from './use-workflow-chat';
import { useChromeWorkflowChat } from './chrome-workflow-chat';

type ChatMode = 'online' | 'offline';

interface ActiveChat {
  readonly messages: readonly UIMessage[];
  readonly status: 'ready' | 'submitted' | 'streaming' | 'error';
  readonly send: (text: string) => void;
}

/**
 * Right-side AI assistant drawer for the workflow designer. Users describe the
 * flow in natural language; the assistant draws it on the canvas by driving the
 * shared workflow toolset through {@link useWorkflowChat}. The layout (canvas +
 * 420px panel) is untouched — this slides over it.
 */
export interface WorkflowChatDrawerProps {
  readonly controller: WorkflowDesignerController;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Chat API route. Defaults to same-origin `/api/chat`. */
  readonly api?: string;
}

const BODY_STYLE: CSSProperties = {
  // No own padding — rely on Mezzanine's `mzn-drawer__content` native padding.
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  height: '100%',
};

const MESSAGE_LIST_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  gap: 12,
  minHeight: 0,
  overflowY: 'auto',
};

const MODE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  paddingBottom: 4,
};

const INPUT_ROW_STYLE: CSSProperties = {
  borderTop: '1px solid var(--mzn-color-border-neutral, #e5e7eb)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 12,
};

const SEND_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
};

// Mezzanine's `fullWidth` isn't reachable through `Textarea`'s props and its
// modifier CSS isn't bundled here, so stretch the TextField host to full width
// with one scoped rule (compound selector beats the base `.mzn-text-field`).
const CHAT_INPUT_CLASS_NAME = 'workflow-chat-input-field';
const CHAT_INPUT_GLOBAL_STYLE = `
.${CHAT_INPUT_CLASS_NAME}.mzn-text-field {
  width: 100%;
}
`;

const TOOL_LINE_STYLE: CSSProperties = {
  color: 'var(--mzn-color-text-secondary, #6b7280)',
  fontSize: 12,
  padding: '2px 0',
};

const TOOL_STATE_LABEL: Readonly<Record<string, string>> = {
  'input-available': '執行中…',
  'input-streaming': '準備中…',
  'output-available': '完成',
  'output-error': '失敗',
};

function readBubbleStyle(role: UIMessage['role']): CSSProperties {
  const isUser = role === 'user';

  return {
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    background: isUser
      ? 'var(--mzn-color-primary, #2563eb)'
      : 'var(--mzn-color-surface, #f3f4f6)',
    borderRadius: 10,
    color: isUser ? '#fff' : 'var(--mzn-color-text-primary, #111827)',
    maxWidth: '85%',
    padding: '8px 12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
}

export function WorkflowChatDrawer({
  api,
  controller,
  onClose,
  open,
}: WorkflowChatDrawerProps): ReactElement {
  const online = useWorkflowChat({ api, controller });
  const offline = useChromeWorkflowChat({ controller });
  const [mode, setMode] = useState<ChatMode>('online');
  const [input, setInput] = useState('');

  const active: ActiveChat =
    mode === 'offline'
      ? {
          messages: offline.messages,
          send: offline.send,
          status: offline.status,
        }
      : {
          messages: online.messages,
          send: (text): void => {
            void online.sendMessage({ text });
          },
          status: online.status,
        };
  const { messages, send } = active;
  const busy = active.status === 'submitted' || active.status === 'streaming';

  const handleSend = useCallback((): void => {
    const text = input.trim();

    if (!text || busy) {
      return;
    }

    setInput('');
    send(text);
  }, [busy, input, send]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      // Never submit while an IME is composing (e.g. Enter that confirms a
      // Chinese candidate). Shift+Enter falls through to insert a newline.
      if (event.nativeEvent.isComposing) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <Drawer
      headerTitle="AI 流程助理"
      isHeaderDisplay
      onClose={onClose}
      open={open}
      size="medium"
    >
      <style>{CHAT_INPUT_GLOBAL_STYLE}</style>
      <div style={BODY_STYLE}>
        {offline.available ? (
          <div style={MODE_ROW_STYLE}>
            <Button
              onClick={(): void => setMode('online')}
              variant={mode === 'online' ? 'base-primary' : 'base-tertiary'}
            >
              線上
            </Button>
            <Button
              onClick={(): void => setMode('offline')}
              variant={mode === 'offline' ? 'base-primary' : 'base-tertiary'}
            >
              離線（裝置內，實驗）
            </Button>
          </div>
        ) : null}
        <div role="log" style={MESSAGE_LIST_STYLE}>
          {messages.length === 0 ? (
            <Typography color="text-neutral" variant="body">
              用一句話描述你想要的流程，例如：「建立三關簽核：部門主管 → 經理 → 財務，金額大於十萬走財務複核」。我會直接在畫布上幫你繪製。
            </Typography>
          ) : null}
          {messages.map((message) => (
            <Fragment key={message.id}>
              {renderMessageParts(message)}
            </Fragment>
          ))}
          {busy ? (
            <Typography color="text-neutral" variant="body">
              思考中…
            </Typography>
          ) : null}
        </div>
        <div style={INPUT_ROW_STYLE}>
          <Textarea
            className={CHAT_INPUT_CLASS_NAME}
            disabled={busy}
            maxLength={2000}
            onChange={(event): void => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要的流程…（Enter 送出，Shift + Enter 換行）"
            rows={3}
            style={TEXTAREA_STYLE}
            value={input}
          />
          <div style={SEND_ROW_STYLE}>
            <Button
              disabled={busy || input.trim().length === 0}
              loading={busy}
              onClick={handleSend}
              type="button"
              variant="base-primary"
            >
              送出
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function renderMessageParts(message: UIMessage): ReactNode {
  return message.parts.map((part, index): ReactNode => {
    if (part.type === 'text') {
      return (
        <div key={`${message.id}-${index}`} style={readBubbleStyle(message.role)}>
          {part.text}
        </div>
      );
    }

    if (part.type === 'dynamic-tool' || isToolUIPart(part)) {
      const toolName = getToolName(part);
      const stateLabel = TOOL_STATE_LABEL[part.state] ?? part.state;

      return (
        <div key={`${message.id}-${index}`} style={TOOL_LINE_STYLE}>
          {`⚙ ${toolName} · ${stateLabel}`}
        </div>
      );
    }

    return null;
  });
}
