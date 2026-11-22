import { AsyncLocalStorage } from "node:async_hooks";
interface Scope {
  runId: string;
  counters: Map<string, number>;
}
const symbol = Symbol.for("study.openmaic.mcp.scope");
const state = globalThis as typeof globalThis & {
  [symbol]?: AsyncLocalStorage<Scope>;
};
export const mcpScope = (state[symbol] ??= new AsyncLocalStorage<Scope>());
export const withMcpScope = <T>(runId: string, execute: () => Promise<T>) =>
  mcpScope.run({ runId, counters: new Map() }, execute);
