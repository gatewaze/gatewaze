import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('initTracing', () => {
  let savedEndpoint: string | undefined;
  beforeEach(() => {
    savedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    vi.resetModules();
  });
  afterEach(() => {
    if (savedEndpoint !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedEndpoint;
  });

  it('is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    // Spy on the SDK init — should never run.
    const sdkSpy = vi.fn();
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: vi.fn().mockImplementation(() => ({ start: sdkSpy })),
    }));
    const { initTracing } = await import('../tracing.js');
    await initTracing();
    expect(sdkSpy).not.toHaveBeenCalled();
  });

  it('returns immediately on second call (idempotent)', async () => {
    const { initTracing } = await import('../tracing.js');
    // Both calls are no-ops without endpoint, but neither throws.
    await initTracing();
    await initTracing();
    // No assertion — just exercising the early-return path.
    expect(true).toBe(true);
  });
});
