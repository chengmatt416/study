import {
  signOpenMaicTicket,
  verifyOpenMaicTicket,
} from "@/lib/study-mcp/protocol";
import { COOKIE } from "@/lib/study-mcp/auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded"))
    return new Response("Invalid session request", { status: 400 });
  const data = await request.formData();
  const token = data.get("ticket");
  const secret = process.env.STUDY_MCP_SECRET ?? "";
  const ticket =
    typeof token === "string"
      ? await verifyOpenMaicTicket(token, secret)
      : null;
  if (!ticket || ticket.scope !== "classroom" || !ticket.classroom_id)
    return new Response("Expired STUDY classroom session", { status: 401 });
  const exp = Date.now() + 15 * 60_000;
  const session = await signOpenMaicTicket({ ...ticket, exp }, secret);
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/classroom/${encodeURIComponent(ticket.classroom_id)}`,
      "Set-Cookie": `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
