export const LIVE_CLASSROOM_PATHS = new Set([
  '/api/chat/pi',
  '/api/pbl/v2/instructor',
  '/api/pbl/v2/simulator',
  '/api/pbl/v2/evaluate',
  '/api/pbl/v2/open-task',
]);
export function isLiveClassroomInput(path: string, body: Record<string, unknown>): boolean {
  if (path !== '/api/chat/pi') return !!body.project && typeof body.project === 'object' && !Array.isArray(body.project);
  if (!Array.isArray(body.messages)) return false;
  const config = body.config as { sessionType?: unknown; discussionTopic?: unknown } | undefined;
  // A learner can join an agent-first discussion without typing a first message.
  if (config?.sessionType === 'discussion' && typeof config.discussionTopic === 'string' && config.discussionTopic.trim().length > 0 && config.discussionTopic.length <= 2000) return true;
  return body.messages.some(message => message && message.role === 'user' && (
    typeof message.content === 'string' ? message.content.trim().length > 0 :
    Array.isArray(message.parts) && message.parts.some((part: { type?: string; text?: string }) => part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
  ));
}
export const LIVE_CLASSROOM_STAGES = new Set([
  'chat-adapter', 'pbl-v2-runtime:instructor', 'pbl-v2-runtime:simulator',
  'pbl-v2-runtime:evaluate', 'pbl-v2-runtime:open-task',
]);
