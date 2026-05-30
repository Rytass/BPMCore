import { createWorkflowChatPOST } from '@rytass/bpm-core-react/next/workflow-chat-route';

// LLM assistant for the workflow designer. Logic lives in the BPM React lib;
// this host only wires the route + holds the server-side AI Gateway key.
export const runtime = 'nodejs';

export const POST = createWorkflowChatPOST();
