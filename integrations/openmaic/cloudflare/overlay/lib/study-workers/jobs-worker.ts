import { DurableObject } from 'cloudflare:workers';
import type { ExportedHandler, Rpc } from '@cloudflare/workers-types';
import { signOpenMaicTicket } from '../study-mcp/protocol';

type JobsEnv = Required<Pick<CloudflareEnv, 'STUDY_MCP_SECRET' | 'OPENMAIC_JOBS' | 'WORKER_SELF_REFERENCE'>>;
export interface JobsApi extends Rpc.DurableObjectBranded { wake(): Promise<void> }

export class CoreCoordinator extends DurableObject<JobsEnv> {
  async wake(): Promise<void> {
    await this.ctx.storage.put('wake', (await this.ctx.storage.get<number>('wake') ?? 0) + 1);
    await this.ctx.storage.setAlarm(Date.now() + 1);
  }
  async alarm(): Promise<void> {
    const generation = await this.ctx.storage.get<number>('wake');
    await this.ctx.storage.setAlarm(Date.now() + 6 * 60_000);
    const maintenance = Date.now() - (await this.ctx.storage.get<number>('maintenance-at') ?? 0) >= 15 * 60_000;
    const ticket = await signOpenMaicTicket({ sub: 'study:workers-coordinator', aud: 'study-openmaic', scope: 'api', exp: Date.now() + 5 * 60_000 }, this.env.STUDY_MCP_SECRET);
    const response = await this.env.WORKER_SELF_REFERENCE.fetch('https://internal/api/study-workers/tick', {
      method: 'POST', headers: { authorization: `Bearer ${ticket}`, 'x-study-maintenance': String(maintenance) },
    });
    if (!response.ok) throw new Error(`Core job tick failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
    const result = await response.json<{ more: boolean; nextAlarm?: number; maintained?: boolean }>();
    if (result.maintained) await this.ctx.storage.put('maintenance-at', Date.now());
    if (result.more || generation !== await this.ctx.storage.get<number>('wake')) await this.ctx.storage.setAlarm(Date.now() + 100);
    else if (result.nextAlarm) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, result.nextAlarm));
    else await this.ctx.storage.deleteAlarm();
  }
}
const worker: ExportedHandler<JobsEnv> = {
  async scheduled(_event, env) { await env.OPENMAIC_JOBS.getByName('coordinator-v1').wake(); },
};
export default worker;
