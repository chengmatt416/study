import { studyTicket } from '../study-mcp/auth';

export const CORE_JOB_OWNER = 'study:workers-coordinator';
export async function isCoreJobRequest(request: Pick<Request, 'url' | 'method'> & { headers: Pick<Headers, 'get'> }, secret: string): Promise<boolean> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/study-workers/tick') return false;
  const ticket = await studyTicket(request.headers, secret);
  return ticket?.scope === 'api' && ticket.sub === CORE_JOB_OWNER;
}
