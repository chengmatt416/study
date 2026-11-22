import { Check, Errors, type XSchema } from "typebox/schema";

interface ModelOutput {
  text: string;
  tool_calls?: { id?: string; name: string; arguments: Record<string, unknown> }[];
}
const MAX_ERRORS = 30;
const MAX_ERROR_CHARS = 600;
const MAX_DIAGNOSTIC_CHARS = 64_000;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const schemaLike = (value: unknown): value is XSchema => typeof value === "boolean" || object(value) !== null;

/** Validate without compiling schemas or executing generated tools/scripts in the Worker. */
export function outputErrors(request: unknown, output: ModelOutput): string[] {
  const model = object(request);
  const errors: string[] = [];
  const add = (message: string) => { if (errors.length < MAX_ERRORS) errors.push(message.slice(0, MAX_ERROR_CHARS)); };
  const validate = (schema: unknown, value: unknown, label: string) => {
    if (schema === undefined) return;
    if (!schemaLike(schema)) { add(`${label}: official JSON schema is invalid`); return; }
    try {
      if (Check(schema, value)) return;
      // Exhaustive diagnostics for a huge invalid result can cost more memory than the result itself.
      if (JSON.stringify(value).length > MAX_DIAGNOSTIC_CHARS) {
        add(`${label}: value does not match the official JSON schema; correct the current bounded task before submission`);
        return;
      }
      const [, details] = Errors(schema, value);
      if (!details.length) add(`${label}: value does not match the official JSON schema`);
      for (const error of details) add(`${label}${error.instancePath || "/"}: ${error.message}`);
    } catch {
      add(`${label}: unable to validate against the official JSON schema; do not submit unverified output`);
    }
  };
  const tools = new Map<string, Record<string, unknown>>();
  if (Array.isArray(model?.tools)) for (const value of model.tools) {
    const tool = object(value);
    if (tool?.type === "function" && typeof tool.name === "string") tools.set(tool.name, tool);
  }
  const calls = output.tool_calls ?? [];
  const choice = object(model?.toolChoice);
  const choiceType = choice?.type ?? model?.toolChoice;
  if (choiceType === "none" && calls.length) add("tool_calls: the official toolChoice forbids tool calls");
  if (choiceType === "required" && !calls.length) add("tool_calls: the official toolChoice requires at least one tool call");
  if (choiceType === "tool") {
    if (!calls.length) add(`tool_calls: the official toolChoice requires tool ${String(choice?.toolName)}`);
    if (calls.some(call => call.name !== choice?.toolName)) add(`tool_calls: only the required tool ${String(choice?.toolName)} may be called`);
  }
  for (const [index, call] of calls.entries()) {
    if (errors.length >= MAX_ERRORS) break;
    const tool = tools.get(call.name);
    const label = `tool_calls[${index}].arguments`;
    if (!tool) { add(`tool_calls[${index}]: ${call.name} is not declared in the official task`); continue; }
    validate(tool.inputSchema, call.arguments, label);
  }
  const format = object(model?.responseFormat);
  if (format?.type === "json" && !calls.length) {
    let parsed: unknown;
    try { parsed = JSON.parse(output.text); }
    catch { add("output.text: the official response format requires valid JSON without markdown fences"); return errors; }
    validate(format.schema, parsed, "output.text");
  }
  return errors;
}
