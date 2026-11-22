/** API transports are unavailable in this MCP-only deployment. Core models use study-mcp/model. */
function apiDisabled(): never { throw new Error('This OpenMAIC deployment uses durable MCP model turns. Direct model API transports are disabled.'); }
export const createOpenAI: typeof import('@ai-sdk/openai').createOpenAI = apiDisabled;
export const createAzure: typeof import('@ai-sdk/azure').createAzure = apiDisabled;
export const createAnthropic: typeof import('@ai-sdk/anthropic').createAnthropic = apiDisabled;
export const createAmazonBedrock: typeof import('@ai-sdk/amazon-bedrock').createAmazonBedrock = apiDisabled;
export const createGoogleGenerativeAI: typeof import('@ai-sdk/google').createGoogleGenerativeAI = apiDisabled;
