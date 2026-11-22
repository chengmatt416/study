// The caller's own adaptive-learning signals, read by the MCP weakness tool.
import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { learnerWeaknesses } from "../lib/adaptive";

const learning = new Hono<AppEnv>();

learning.get("/weaknesses", async (c) => {
  const classroom = c.req.query("classroom_id");
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit")) || 10));
  return c.json({ classrooms: await learnerWeaknesses(c.env, c.get("user").id, { classroom: classroom || undefined, limit }) });
});

export default learning;
