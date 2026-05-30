import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type Tool,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { WORKFLOW_TOOLSET } from '@rytass/bpm-core-shared';

/**
 * Next.js route handler for the workflow designer LLM assistant.
 *
 * The model is advertised the workflow {@link WORKFLOW_TOOLSET} but the tools
 * carry **no `execute`** — so every tool call is forwarded to the browser,
 * where `useChat`'s `onToolCall` runs it against the React designer controller
 * (see `use-workflow-chat.ts`). This route only holds the API key, runs the
 * model, and streams the tool-call plan back. It never touches the canvas.
 *
 * Host usage (apps/client/src/app/api/chat/route.ts):
 *   export const runtime = 'nodejs';
 *   export const POST = createWorkflowChatPOST();
 */

/** Default OpenAI model id (overridable via BPM_LLM_MODEL). */
const DEFAULT_MODEL = 'gpt-5.4-mini';

/**
 * Resolve the model via the OpenAI provider directly (reads `OPENAI_API_KEY`).
 * Accepts a bare id (`gpt-5.4-mini`) or a `openai/`-prefixed id; the prefix is
 * stripped. This deployment talks to OpenAI directly — no AI Gateway.
 */
function resolveModel(setting: string): LanguageModel {
  return openai(setting.replace(/^openai\//u, ''));
}

/**
 * Strict guardrail: the assistant may ONLY design this approval flow, using the
 * provided tools. Anything else is declined. Lives server-side so it cannot be
 * overridden by client-supplied messages.
 */
export const WORKFLOW_CHAT_SYSTEM_PROMPT = `你是「簽核流程設計器」頁面內建的 AI 助理，唯一職責是協助使用者在這個畫布上設計／修改一個簽核審批流程（workflow）。

你只能透過系統提供的工具（tools）來操作流程：新增/重命名/刪除節點、連線、設定簽核人、設定條件分流、設定系統節點動作、自動排版、查詢現況與驗證等。除了這些工具，你沒有其他能力。

工作守則：
1. 動作前，先呼叫 get_workflow_snapshot 了解目前畫布的節點與連線，再規劃要呼叫哪些工具。
2. 盡量用高階工具（insert_approval_step / insert_notification / insert_conditional_branch）一次完成多步；需要細修時再用細顆粒工具。
3. **重要：要果斷、先把流程畫出來。** 使用者只給一兩句話時，直接依常見公司慣例建立初稿，不要反覆追問細節。簽核人若使用者沒指定，就省略 approverResolver（系統會自動用「直屬主管」為預設，不需要真實會員 id）；通知節點同理可省略 action（預設站內通知）。先把結構建好、再請使用者調整。
4. 工具呼叫不會因為「缺簽核人/缺資料」而失敗；缺的部分會以合理預設補上，並由 validate_workflow 標示。所以放心連續呼叫工具把流程建完，不要因為怕缺欄位就停下來問。
5. 當使用者「點名」某個人或部門當簽核人/收件者時，先用 search_members（依姓名關鍵字）、list_org_units、list_positions 查到真實 id，再用 set_user_task_approver / set_service_action 指定（如 DIRECT memberIds、ORG_UNIT_MANAGER orgUnitId、POSITION positionId）。查不到就回報並請使用者確認，不要編造 id。
6. 節點 id 可從 snapshot 取得；連線條件需要先綁定表單欄位（若 list_form_fields 為空，提醒使用者先綁定表單版本）。
7. **條件分流務必主動補上「其他情況」**：設計 exclusiveGateway（條件分流）時，除了符合條件的分支，一定要保留一條未設條件、標記為預設（isDefault）的「其他情況」路徑當 else（通常指向後續節點或完成）。不要把所有輸出連線都設成條件而沒有預設出口；缺預設出口時，用 set_edge_default 把其中一條設為預設。
8. 完成後，呼叫 validate_workflow，並用一兩句話說明你建了什麼流程、哪些地方（如簽核人、條件門檻）建議使用者再確認或指定。
9. 全程使用繁體中文（台灣用語）回覆。

嚴格界線：
- 只做「設計這個簽核流程」相關的事。任何與此無關的請求（閒聊、寫詩、寫程式、查天氣／新聞、操作其他系統或頁面、回答一般知識問題等）一律婉拒，並簡短引導使用者回到流程設計，例如：「我只能協助你設計這個簽核流程，需要我幫你新增關卡或設定條件嗎？」
- 不要假裝執行你工具以外的動作，也不要編造結果。`;

/** Build AI SDK tools from WORKFLOW_TOOLSET — no `execute`, so the browser runs them. */
export function buildWorkflowAiSdkTools(): ToolSet {
  const entries: readonly (readonly [string, Tool])[] = WORKFLOW_TOOLSET.map(
    (workflowTool) =>
      [
        workflowTool.name,
        tool({
          description: workflowTool.description,
          inputSchema: jsonSchema(
            workflowTool.inputSchema as Parameters<typeof jsonSchema>[0],
          ),
        }),
      ] as const,
  );

  return Object.fromEntries(entries) as ToolSet;
}

export interface WorkflowChatRouteOptions {
  /** Override the OpenAI model id (else BPM_LLM_MODEL env, else the default). */
  readonly model?: string;
  /** Override the system prompt (else the strict design-only guardrail). */
  readonly system?: string;
}

interface WorkflowChatRequestBody {
  readonly messages: readonly UIMessage[];
}

/** Create the `POST` handler for the workflow chat route. */
export function createWorkflowChatPOST(
  options: WorkflowChatRouteOptions = {},
): (request: Request) => Promise<Response> {
  const tools = buildWorkflowAiSdkTools();

  return async function POST(request: Request): Promise<Response> {
    const body = (await request.json()) as WorkflowChatRequestBody;
    const result = streamText({
      messages: await convertToModelMessages([...body.messages]),
      model: resolveModel(
        options.model ?? process.env.BPM_LLM_MODEL ?? DEFAULT_MODEL,
      ),
      system: options.system ?? WORKFLOW_CHAT_SYSTEM_PROMPT,
      tools,
    });

    return result.toUIMessageStreamResponse();
  };
}
