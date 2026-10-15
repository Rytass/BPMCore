import { createWorkflowChatPOST } from '@rytass/bpm-core-react/next/workflow-chat-route';

// LLM assistant for the workflow designer. Logic lives in the BPM React lib;
// this host only wires the route. The server-side OPENAI_API_KEY is read by the
// route in the BPM React lib; the deployment talks to OpenAI directly (no AI Gateway).
export const runtime = 'nodejs';

export const POST = createWorkflowChatPOST();
