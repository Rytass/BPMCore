import {
  createBPMApiSessionAuthorize,
  createWorkflowChatPOST,
} from '@rytass/bpm-core-react/next/workflow-chat-route';

// LLM assistant for the workflow designer. Logic lives in the BPM React lib;
// this host only wires the route. The server-side OPENAI_API_KEY is read by the
// route in the BPM React lib; the deployment talks to OpenAI directly (no AI Gateway).
// Only a caller the BPM API recognises as signed in (GET /auth/me with the
// request's cookie) may use it; anyone else gets 401.
export const runtime = 'nodejs';

export const POST = createWorkflowChatPOST({
  authorize: createBPMApiSessionAuthorize(),
});
