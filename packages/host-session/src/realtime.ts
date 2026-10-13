// Realtime WebSocket proxy. realtime-js sends its token inside messages
// (phx_join and access_token), so the BFF terminates the browser's socket,
// opens its own to Realtime, and puts the real access token into those
// messages. The browser only ever sends the placeholder (or the anon key).
// Ported from the PoC's admin/server/core/realtime.ts.
import WebSocket from 'ws';
import {
  type CoreLogger,
  REFRESH_SKEW_SECONDS,
  SessionUnavailableError,
  type GwSession,
  errorMessage,
  isAdminCheckPending,
} from './session.js';

const BFF_REF_PREFIX = 'bff-';
// When a refresh can't reach GoTrue, try again after this long, for as long
// as the current token is still valid.
const REFRESH_RETRY_MS = 5_000;
// Messages, and bytes, buffered while the upstream socket is still connecting.
const MAX_PENDING = 1_000;
const MAX_PENDING_BYTES = 1024 * 1024;
// Unsent data allowed to pile up on either socket before the bridge closes.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
// Channels one socket may join (realtime-js joins one per subscription).
const MAX_JOINED = 100;
const HANDSHAKE_TIMEOUT_MS = 10_000;

// Phoenix messages are objects in protocol 1.0.0 and arrays
// ([join_ref, ref, topic, event, payload]) in 2.0.0.
interface PhxMessage {
  joinRef: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  array: boolean;
}

export function decode(text: string): PhxMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    // Not JSON: the caller decides what to do with the frame.
    return null;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  if (Array.isArray(m)) {
    if (typeof m[2] !== 'string' || typeof m[3] !== 'string') return null;
    return { joinRef: str(m[0]), ref: str(m[1]), topic: m[2], event: m[3], payload: obj(m[4]), array: true };
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (typeof o.topic !== 'string' || typeof o.event !== 'string') return null;
  return { joinRef: str(o.join_ref), ref: str(o.ref), topic: o.topic, event: o.event, payload: obj(o.payload), array: false };
}

export function encode(m: PhxMessage): string {
  return JSON.stringify(
    m.array
      ? [m.joinRef, m.ref, m.topic, m.event, m.payload]
      : { join_ref: m.joinRef, ref: m.ref, topic: m.topic, event: m.event, payload: m.payload },
  );
}

// Close codes the ws library allows an endpoint to send.
function sendableCode(code: number): number {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999)
    ? code
    : 1000;
}

export interface RealtimeBridgeOptions {
  // ws:// or wss:// URL of the Realtime socket, including the query string.
  upstreamUrl: string;
  session: GwSession;
  // Returns a session with a currently valid token, or null when it has ended.
  fresh: () => Promise<GwSession | null>;
  // Registers a callback for sign-out; returns an unregister function.
  onSignedOut: (fn: () => void) => () => void;
  // How long to wait before retrying a refresh GoTrue could not answer.
  refreshRetryMs?: number;
  // How long the upstream handshake may take.
  handshakeTimeoutMs?: number;
  // Opens the upstream socket. Tests replace it; the default is ws.
  connect?: (url: string, options: WebSocket.ClientOptions) => WebSocket;
  log?: CoreLogger;
}

export interface RealtimeBridge {
  close(code?: number, reason?: string): void;
}

export function bridgeRealtime(client: WebSocket, opts: RealtimeBridgeOptions): RealtimeBridge {
  let session = opts.session;
  const retryMs = opts.refreshRetryMs ?? REFRESH_RETRY_MS;
  let refSeq = 0;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  // Joined channel topics and their join refs, for pushing new tokens.
  const joined = new Map<string, string | null>();
  const pending: Array<{ data: string; binary: false }> = [];
  let pendingBytes = 0;
  const connect = opts.connect ?? ((url: string, options: WebSocket.ClientOptions) => new WebSocket(url, options));
  const upstream = connect(opts.upstreamUrl, { handshakeTimeout: opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS });

  const close = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    unsubscribe();
    if (client.readyState <= WebSocket.OPEN) client.close(sendableCode(code), reason);
    if (upstream.readyState <= WebSocket.OPEN) upstream.close(sendableCode(code), reason);
  };
  const unsubscribe = opts.onSignedOut(() => close(4001, 'signed out'));

  const toUpstream = (data: string) => {
    if (closed) return;
    if (upstream.readyState === WebSocket.OPEN) {
      // Realtime not reading fast enough: stop rather than buffer without bound.
      if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) return close(1013, 'upstream backlog');
      upstream.send(data, { binary: false });
      return;
    }
    const bytes = Buffer.byteLength(data);
    // A browser that keeps sending while Realtime never answers.
    if (pending.length >= MAX_PENDING || pendingBytes + bytes > MAX_PENDING_BYTES) return close(1011, 'upstream not ready');
    pending.push({ data, binary: false });
    pendingBytes += bytes;
  };

  // Pushes the current token to every joined channel, as realtime-js does
  // after setAuth.
  const pushToken = () => {
    for (const [topic, joinRef] of joined) {
      const ref = `${BFF_REF_PREFIX}${++refSeq}`;
      toUpstream(encode({ joinRef, ref, topic, event: 'access_token', payload: { access_token: session.access_token }, array: true }));
    }
  };

  const schedule = (ms = Math.max(1000, (session.expires_at - REFRESH_SKEW_SECONDS) * 1000 - Date.now())) => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let next: GwSession | null;
      try {
        next = await opts.fresh();
      } catch (e) {
        if (closed) return;
        // GoTrue unreachable: keep the socket while the current token lasts.
        if (e instanceof SessionUnavailableError && session.expires_at * 1000 > Date.now() + retryMs) {
          return schedule(retryMs);
        }
        opts.log?.warn({ err: errorMessage(e), user_id: session.user_id }, 'realtime: session refresh failed; closing');
        return close(1011, 'session refresh failed');
      }
      // The socket closed while the refresh ran: do nothing more.
      if (closed) return;
      if (!next) return close(4001, 'session ended');
      // A pending admin check is not an answer: keep the socket on the new
      // (valid) tokens, and the short expiry brings the retry round.
      if (!next.is_admin && !isAdminCheckPending(next)) return close(4001, 'session ended');
      if (next.access_token !== session.access_token) {
        session = next;
        pushToken();
      }
      schedule();
    }, ms);
  };
  schedule();

  client.on('message', (data, binary) => {
    // Only Phoenix JSON text frames are relayed. A binary or unparseable
    // frame could carry a token the BFF can't rewrite, so the socket is
    // closed (1003, unsupported data) instead of passing it through.
    if (binary) return close(1003, 'binary frames are not supported');
    const m = decode(data.toString());
    if (!m) return close(1003, 'unparseable frame');
    if (m.event === 'phx_join') {
      if (!joined.has(m.topic) && joined.size >= MAX_JOINED) return close(1008, 'too many channels');
      joined.set(m.topic, m.joinRef ?? m.ref);
    }
    if (m.event === 'phx_leave') joined.delete(m.topic);
    if (m.event === 'phx_join' || m.event === 'access_token') {
      // Whatever the browser sent (placeholder, anon key or nothing) is
      // replaced, so subscriptions always run as the session's user.
      m.payload = { ...m.payload, access_token: session.access_token };
      return toUpstream(encode(m));
    }
    toUpstream(data.toString());
  });

  upstream.on('open', () => {
    for (const p of pending.splice(0)) upstream.send(p.data, { binary: p.binary });
    pendingBytes = 0;
  });
  upstream.on('message', (data, binary) => {
    if (!binary) {
      const m = decode(data.toString());
      // Replies to the BFF's own token pushes aren't for the browser.
      if (typeof m?.ref === 'string' && m.ref.startsWith(BFF_REF_PREFIX)) return;
    }
    if (client.readyState !== WebSocket.OPEN) return;
    // The browser not reading fast enough: stop rather than buffer without bound.
    if (client.bufferedAmount > MAX_BUFFERED_BYTES) return close(1013, 'client backlog');
    client.send(data, { binary });
  });

  client.on('close', (code, reason) => close(code, reason.toString()));
  upstream.on('close', (code, reason) => close(code, reason.toString()));
  client.on('error', (e) => {
    opts.log?.warn({ err: e.message }, 'realtime: browser socket error');
    close(1011);
  });
  upstream.on('error', (e) => {
    opts.log?.warn({ err: e.message }, 'realtime: upstream socket error');
    close(1011);
  });

  return { close };
}
