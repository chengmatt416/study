import { workersScope } from "@/lib/study-workers/context";
import { tick } from "@/lib/study-workers/tick";
export const runtime = "nodejs";
export async function POST() {
  if (!workersScope.getStore()?.alarm) return new Response("Not found", { status: 404 });
  return Response.json(await tick());
}
