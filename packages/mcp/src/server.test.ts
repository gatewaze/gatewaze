import { describe, expect, it, vi, type Mock } from 'vitest';
import { InMemoryTransport, type JSONRPCMessage, type Server } from '@modelcontextprotocol/server';
import { createGatewazeMcpServer, type CallerIdentity } from './server.js';
import { ApiError, type GatewazeApiClient } from './lib/supabase.js';

// ── Harness ──────────────────────────────────────────────────────────────
// Drives the real Server over the SDK's in-memory transport with raw
// JSON-RPC, so tools/list and tools/call exercise the same filter + switch
// the hosted endpoint runs. The API client is a stub: these tests pin the
// MCP layer (visibility, scope gates, body shaping, error mapping), not the
// platform API.

type FakeApi = GatewazeApiClient & { get: Mock; post: Mock; patch: Mock; put: Mock };

function fakeApi(): FakeApi {
  return {
    get: vi.fn(async () => ({ data: [], pagination: { total: 0, limit: 25, offset: 0, has_more: false } })),
    post: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
  } as unknown as FakeApi;
}

type RpcResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function connect(server: Server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number' && pending.has(message.id)) {
      pending.get(message.id)!(message);
      pending.delete(message.id);
    }
  };
  await clientTransport.start();
  await server.connect(serverTransport);

  let nextId = 1;
  const rpc = <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) => {
        if ('error' in message) reject(new Error(JSON.stringify(message.error)));
        else resolve((message as unknown as { result: T }).result);
      });
      void clientTransport.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage);
    });

  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);

  return {
    listToolNames: async () => {
      const res = await rpc<{ tools: Array<{ name: string }> }>('tools/list');
      return res.tools.map((t) => t.name);
    },
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const res = await rpc<RpcResult>('tools/call', { name, arguments: args });
      return { ...res, body: JSON.parse(res.content[0]!.text) as Record<string, unknown> };
    },
    close: () => clientTransport.close(),
  };
}

function identity(...scopes: string[]): CallerIdentity {
  return {
    subject: 'lfid|tester',
    email: 'tester@example.org',
    personId: '11111111-1111-4111-8111-111111111111',
    tier: 'member',
    authMode: 'lfid',
    clientId: 'test-client',
    scopes: new Set(scopes),
  };
}

const CONTENT_SOURCE_TOOLS = [
  'content_sources_list',
  'content_sources_get',
  'content_sources_resolve',
  'content_sources_submit',
  'content_sources_set_status',
];
const SOURCE_ID = '2f4b1c3e-7d8a-4e9f-9b0c-1d2e3f4a5b6c';

// ── Tests ────────────────────────────────────────────────────────────────

describe('content_sources_* tool visibility', () => {
  it('a keyed full-profile caller sees all five tools', async () => {
    const c = await connect(createGatewazeMcpServer(fakeApi(), { profile: 'full' }));
    const names = await c.listToolNames();
    for (const tool of CONTENT_SOURCE_TOOLS) expect(names).toContain(tool);
    await c.close();
  });

  it('the anonymous public profile neither lists nor serves them', async () => {
    const api = fakeApi();
    const c = await connect(createGatewazeMcpServer(api, { profile: 'public' }));
    const names = await c.listToolNames();
    for (const tool of CONTENT_SOURCE_TOOLS) expect(names).not.toContain(tool);

    const res = await c.call('content_sources_list');
    expect(res.isError).toBe(true);
    expect(res.body.error).toMatch(/Unknown tool: content_sources_list/);
    expect(api.get).not.toHaveBeenCalled();
    await c.close();
  });

  it('an OAuth caller sees exactly the tools its scopes cover', async () => {
    const readOnly = await connect(createGatewazeMcpServer(fakeApi(), { identity: identity('content-sources:read') }));
    const readNames = await readOnly.listToolNames();
    expect(readNames).toEqual(expect.arrayContaining(['content_sources_list', 'content_sources_get', 'content_sources_resolve']));
    expect(readNames).not.toContain('content_sources_submit');
    expect(readNames).not.toContain('content_sources_set_status');
    await readOnly.close();

    const noScope = await connect(createGatewazeMcpServer(fakeApi(), { identity: identity() }));
    const noScopeNames = await noScope.listToolNames();
    for (const tool of CONTENT_SOURCE_TOOLS) expect(noScopeNames).not.toContain(tool);
    await noScope.close();
  });
});

describe('content_sources_submit', () => {
  it('maps a 409 ALREADY_TRACKED from the API to an error result that keeps the existing id', async () => {
    const api = fakeApi();
    api.post.mockRejectedValueOnce(
      new ApiError(409, {
        error: { code: 'ALREADY_TRACKED', message: 'already tracked as https://example.org/feed.xml', details: { id: SOURCE_ID } },
      }),
    );
    const c = await connect(createGatewazeMcpServer(api, { profile: 'full' }));
    const res = await c.call('content_sources_submit', { site_url: 'https://example.org' });
    expect(res.isError).toBe(true);
    expect(res.body).toEqual({
      error: 'already tracked as https://example.org/feed.xml',
      code: 'ALREADY_TRACKED',
      details: { id: SOURCE_ID },
    });
    await c.close();
  });

  it('posts an allowlisted body to /content-sources/sources and drops stray fields', async () => {
    const api = fakeApi();
    api.post.mockResolvedValueOnce({ data: { id: SOURCE_ID, status: 'pending' } });
    const c = await connect(createGatewazeMcpServer(api, { profile: 'full' }));
    const res = await c.call('content_sources_submit', {
      site_url: ' https://example.org/blog ',
      foundation: 'CNCF',
      note: 'project blog',
      status: 'active', // not a submit field — must not reach the API
    });
    expect(res.isError).toBeUndefined();
    expect(api.post).toHaveBeenCalledWith('/content-sources/sources', {
      site_url: 'https://example.org/blog',
      foundation: 'CNCF',
      note: 'project blog',
      // the hosted key is the deployment's, never the caller's: submits stay pending
      as_pending: true,
    });
    expect(res.body).toEqual({ data: { id: SOURCE_ID, status: 'pending' } });
    await c.close();
  });

  it('refuses without site_url before touching the API', async () => {
    const api = fakeApi();
    const c = await connect(createGatewazeMcpServer(api, { profile: 'full' }));
    const res = await c.call('content_sources_submit', {});
    expect(res.body.error).toMatch(/site_url is required/);
    expect(api.post).not.toHaveBeenCalled();
    await c.close();
  });
});

describe('content_sources_set_status', () => {
  it('requires the content-sources:admin scope under OAuth (write is not enough)', async () => {
    const api = fakeApi();
    const c = await connect(
      createGatewazeMcpServer(api, { identity: identity('content-sources:read', 'content-sources:write') }),
    );
    const res = await c.call('content_sources_set_status', { id: SOURCE_ID, status: 'active' });
    expect(res.isError).toBe(true);
    expect(res.body.error).toMatch(/insufficient_scope/);
    expect(res.body.error).toMatch(/'content-sources:admin'/);
    expect(api.patch).not.toHaveBeenCalled();
    await c.close();
  });

  it('with the admin scope PATCHes the source with status and note only', async () => {
    const api = fakeApi();
    api.patch.mockResolvedValueOnce({ data: { id: SOURCE_ID, status: 'active' } });
    const c = await connect(createGatewazeMcpServer(api, { identity: identity('content-sources:admin') }));
    const res = await c.call('content_sources_set_status', {
      id: SOURCE_ID,
      status: 'active',
      note: 'approved',
      egress_locked: true, // not exposed by this tool — must not reach the API
    });
    expect(res.isError).toBeUndefined();
    expect(api.patch).toHaveBeenCalledWith(`/content-sources/sources/${SOURCE_ID}`, { status: 'active', note: 'approved' });
    await c.close();
  });

  it('rejects a non-uuid id and an unknown status before calling the API', async () => {
    const api = fakeApi();
    const c = await connect(createGatewazeMcpServer(api, { profile: 'full' }));
    const badId = await c.call('content_sources_set_status', { id: '../other', status: 'active' });
    expect(badId.body.error).toMatch(/id must be a uuid/);
    const badStatus = await c.call('content_sources_set_status', { id: SOURCE_ID, status: 'deleted' });
    expect(badStatus.body.error).toMatch(/status must be one of/);
    expect(api.patch).not.toHaveBeenCalled();
    await c.close();
  });
});

describe('content_sources read tools', () => {
  it('list forwards the filters as query params', async () => {
    const api = fakeApi();
    const c = await connect(createGatewazeMcpServer(api, { profile: 'full' }));
    await c.call('content_sources_list', { status: 'pending', foundation: 'LF', q: 'blog', limit: 5, offset: 10 });
    expect(api.get).toHaveBeenCalledWith('/content-sources/sources', {
      status: 'pending',
      foundation: 'LF',
      q: 'blog',
      limit: 5,
      offset: 10,
    });
    await c.close();
  });

  it('get validates the uuid; resolve posts the trimmed site_url', async () => {
    const api = fakeApi();
    const c = await connect(createGatewazeMcpServer(api, { profile: 'full' }));
    const bad = await c.call('content_sources_get', { id: 'not-a-uuid' });
    expect(bad.body.error).toMatch(/id must be a uuid/);
    await c.call('content_sources_get', { id: SOURCE_ID });
    expect(api.get).toHaveBeenCalledWith(`/content-sources/sources/${SOURCE_ID}`);

    await c.call('content_sources_resolve', { site_url: ' https://example.org ' });
    expect(api.post).toHaveBeenCalledWith('/content-sources/resolve', { site_url: 'https://example.org' });
    await c.close();
  });
});
