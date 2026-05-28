// Tool-level config shared by the server and every backend.
export const DEFAULT_MAX_CHARS = Number(process.env.BROWSER_MCP_MAX_CHARS ?? 20000);
export const DEFAULT_TIMEOUT_MS = Number(process.env.BROWSER_MCP_TIMEOUT_MS ?? 30000);
