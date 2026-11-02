import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The server logs one JSONL line per tool call on stderr; keep test
    // output readable.
    env: { MCP_LOG_REQUESTS: '0' },
  },
});
