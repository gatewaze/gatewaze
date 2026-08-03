/*!
 * gatewaze-arcade 1.0 — Gatewaze Arcade browser SDK.
 *
 * Dependency-free, no build step. Vendor this file into your game repo and load
 * it with a plain <script src="gatewaze-arcade.js"></script>, or reference the
 * copy the games origin serves at /sdk/gatewaze-arcade-1.js.
 *
 * Two modes, one code path:
 *   local  — no portal host (file://, python -m http.server, GitHub Pages).
 *            Everything maps to namespaced localStorage, including a working
 *            local hall of fame. This is the default and the fallback.
 *   portal — running inside the Gatewaze portal, signed in. Progress, scores
 *            and the shared leaderboard are server-side.
 *
 * The SDK never throws. Every call resolves; failures degrade to local mode.
 * The access token lives in a closure variable only — never localStorage,
 * sessionStorage, IndexedDB or a cookie.
 */
(function (root) {
  'use strict';
  if (!root) return;

  var SDK_VERSION = '1.0';
  var HANDSHAKE_TIMEOUT_MS = 800;
  var SAVE_DEBOUNCE_MS = 2000;
  var REFRESH_LEAD_MS = 5 * 60 * 1000;
  var BACKOFF_FLOOR_MS = 2000;
  var BACKOFF_CAP_MS = 30000;
  var RATE_LIMIT_ATTEMPTS = 3;
  var BOARD_LIMIT = 50;
  var NAME_MAX = 40;

  // Expected host-page origin.
  //
  // The copy served from the games origin at /sdk/gatewaze-arcade-1.js has this
  // placeholder substituted at boot with the deployment's real portal origin, so
  // the handshake is pinned to exactly one origin. A copy vendored into a creator
  // repo keeps the placeholder — that copy only ever runs standalone (local
  // mode), where no handshake happens at all, and a creator who wants the strict
  // check anyway can pass `portalOrigin` to init().
  //
  // Without a pin we fall back to a shape check. That is deliberately weaker: it
  // relies on the games origin's `frame-ancestors` CSP to stop a hostile page
  // framing the game in the first place, and CSP should not be the only control.
  var PINNED_HOST_ORIGIN = '__GATEWAZE_PORTAL_ORIGIN__';
  var HTTPS_ORIGIN_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/i;
  var DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/i;
  var expectedHostOrigin = null;

  function pinnedOrigin() {
    if (expectedHostOrigin) return expectedHostOrigin;
    // The placeholder is only itself when this copy was never templated.
    if (PINNED_HOST_ORIGIN.indexOf('__GATEWAZE') !== 0) return PINNED_HOST_ORIGIN;
    return null;
  }

  function isAcceptableHostOrigin(origin) {
    if (typeof origin !== 'string' || origin.length === 0 || origin.length > 255) return false;
    var pinned = pinnedOrigin();
    if (pinned) return origin === pinned;
    if (HTTPS_ORIGIN_RE.test(origin)) return true;
    // An http host origin is accepted only when the game itself is being served
    // over plain http, i.e. local development. A game on https never takes one.
    try {
      if (root.location && root.location.protocol === 'http:') return DEV_ORIGIN_RE.test(origin);
    } catch (err) {
      /* cross-origin location access — treat as not-dev */
    }
    return false;
  }

  // ── small helpers ────────────────────────────────────────────────────────

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeInt(value) {
    var n = typeof value === 'number' ? value : parseInt(value, 10);
    if (!isFinite(n)) return 0;
    n = Math.floor(n);
    return n < 0 ? 0 : n;
  }

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (err) {
      return '';
    }
  }

  function warn(message) {
    try {
      if (root.console && root.console.warn) root.console.warn('[gatewaze-arcade] ' + message);
    } catch (err) {
      /* console unavailable */
    }
  }

  function storage() {
    try {
      var s = root.localStorage;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') return s;
    } catch (err) {
      /* storage disabled by the browser */
    }
    return null;
  }

  function readJson(key, fallback) {
    var s = storage();
    if (!s) return fallback;
    try {
      var raw = s.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    var s = storage();
    if (!s) return false;
    try {
      s.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      warn('could not write ' + key + ' (storage full or blocked)');
      return false;
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      try {
        root.setTimeout(resolve, ms);
      } catch (err) {
        resolve();
      }
    });
  }

  function stripControlChars(value) {
    var out = '';
    for (var i = 0; i < value.length; i += 1) {
      var code = value.charCodeAt(i);
      if (code >= 0x20 && code !== 0x7f) out += value.charAt(i);
    }
    return out;
  }

  function trimName(name) {
    if (name === null || name === undefined) return '';
    return stripControlChars(String(name)).trim().slice(0, NAME_MAX);
  }

  // ── the instance ─────────────────────────────────────────────────────────

  function createArcade(game) {
    var stateKey = 'gw:' + game + ':state';
    var boardKey = 'gw:' + game + ':board';

    var mode = 'local';
    var signedIn = false;
    var user = null;

    // Held in this closure ONLY. Never persisted anywhere.
    var token = null;
    var tokenExpiresAt = 0;

    var host = null; // { window, origin, nonce }
    var stateUrl = null;
    var leaderboardUrl = null;

    var listeners = { change: [] };
    var pendingState = null;
    var saveTimer = null;
    var refreshTimer = null;

    function emitChange() {
      var fns = listeners.change.slice();
      for (var i = 0; i < fns.length; i += 1) {
        try {
          fns[i]({ mode: mode, signedIn: signedIn, user: user });
        } catch (err) {
          warn('a change listener threw: ' + err);
        }
      }
    }

    function goLocal(reason) {
      token = null;
      tokenExpiresAt = 0;
      if (mode !== 'local') {
        mode = 'local';
        signedIn = false;
        if (reason) warn('falling back to local mode (' + reason + ')');
        emitChange();
      }
    }

    // ── local hall of fame ────────────────────────────────────────────────
    // One key holds the whole local board: the player's best score, their
    // chosen name, and the named entries. Namespaced by game because the games
    // origin is shared (spec §6).

    function localBoard() {
      var board = readJson(boardKey, null);
      if (!isPlainObject(board)) board = {};
      return {
        best: safeInt(board.best),
        name: typeof board.name === 'string' ? board.name : null,
        entries: Array.isArray(board.entries) ? board.entries : [],
      };
    }

    function sortEntries(entries) {
      entries.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.at) < String(b.at) ? -1 : 1;
      });
      return entries.slice(0, BOARD_LIMIT);
    }

    function saveLocalBoard(board) {
      board.entries = sortEntries(board.entries);
      writeJson(boardKey, board);
      return board;
    }

    function upsertLocalEntry(board) {
      if (!board.name || board.best <= 0) return board;
      var found = null;
      for (var i = 0; i < board.entries.length; i += 1) {
        if (board.entries[i] && board.entries[i].displayName === board.name) {
          found = board.entries[i];
          break;
        }
      }
      if (!found) {
        board.entries.push({ displayName: board.name, score: board.best, at: nowIso() });
      } else if (board.best > safeInt(found.score)) {
        found.score = board.best;
        found.at = nowIso();
      }
      return board;
    }

    function localRank(board) {
      var better = 0;
      for (var i = 0; i < board.entries.length; i += 1) {
        if (safeInt(board.entries[i].score) > board.best) better += 1;
      }
      return better + 1;
    }

    // ── transport ─────────────────────────────────────────────────────────

    function post(type, extra) {
      if (!host) return;
      var message = { gw: 1, type: type, nonce: host.nonce };
      if (extra) {
        for (var key in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, key)) message[key] = extra[key];
        }
      }
      try {
        host.window.postMessage(message, host.origin);
      } catch (err) {
        warn('postMessage failed: ' + err);
      }
    }

    /**
     * One HTTP attempt. Resolves { status, body } — never rejects; a transport
     * failure resolves with status 0.
     */
    function attempt(url, options) {
      var fetchFn = null;
      try {
        fetchFn = root.fetch;
      } catch (err) {
        fetchFn = null;
      }
      if (typeof fetchFn !== 'function') return Promise.resolve({ status: 0, body: null, headers: null });

      var init = { method: options.method, headers: options.headers, credentials: 'omit', mode: 'cors' };
      if (options.body !== undefined) init.body = options.body;
      if (options.keepalive) init.keepalive = true;

      return fetchFn.call(root, url, init).then(
        function (response) {
          return response
            .text()
            .then(function (text) {
              var parsed = null;
              try {
                parsed = text ? JSON.parse(text) : null;
              } catch (err) {
                parsed = null;
              }
              return { status: response.status, body: parsed, headers: response.headers };
            })
            .catch(function () {
              return { status: response.status, body: null, headers: response.headers };
            });
        },
        function () {
          return { status: 0, body: null, headers: null };
        },
      );
    }

    function retryAfterMs(headers, attemptIndex) {
      var seconds = 0;
      try {
        if (headers && typeof headers.get === 'function') seconds = parseInt(headers.get('Retry-After'), 10);
      } catch (err) {
        seconds = 0;
      }
      var wait = isFinite(seconds) && seconds > 0 ? seconds * 1000 : BACKOFF_FLOOR_MS * Math.pow(2, attemptIndex);
      if (wait < BACKOFF_FLOOR_MS) wait = BACKOFF_FLOOR_MS;
      if (wait > BACKOFF_CAP_MS) wait = BACKOFF_CAP_MS;
      return wait;
    }

    /**
     * Authenticated call to the state API with the §8 error policy:
     *   401/403 → drop to local mode      429 → backoff honouring Retry-After
     *   413     → keep local + warn       network → one retry, then local
     * Resolves { ok, status, body } and never rejects.
     */
    function callApi(method, payload, opts) {
      var options = opts || {};
      if (mode !== 'portal' || !token || !stateUrl) {
        return Promise.resolve({ ok: false, status: 0, body: null });
      }

      var headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      var body;
      if (payload !== undefined && payload !== null) {
        headers['Content-Type'] = 'application/json';
        try {
          body = JSON.stringify(payload);
        } catch (err) {
          return Promise.resolve({ ok: false, status: 400, body: null });
        }
      }

      var networkRetried = false;

      function run(attemptIndex) {
        return attempt(stateUrl, {
          method: method,
          headers: headers,
          body: body,
          keepalive: !!options.keepalive,
        }).then(function (res) {
          if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, body: res.body };

          if (res.status === 401 || res.status === 403) {
            goLocal('session expired');
            return { ok: false, status: res.status, body: null };
          }
          if (res.status === 413) {
            warn('save rejected: state too large — keeping the local copy only');
            return { ok: false, status: 413, body: null };
          }
          if (res.status === 429 && attemptIndex + 1 < RATE_LIMIT_ATTEMPTS && !options.keepalive) {
            return sleep(retryAfterMs(res.headers, attemptIndex)).then(function () {
              return run(attemptIndex + 1);
            });
          }
          if (res.status === 0 && !networkRetried && !options.keepalive) {
            networkRetried = true;
            return sleep(BACKOFF_FLOOR_MS).then(function () {
              return run(attemptIndex);
            });
          }
          if (res.status === 0) {
            goLocal('network unavailable');
            return { ok: false, status: 0, body: null };
          }
          return { ok: false, status: res.status, body: res.body };
        });
      }

      return run(0);
    }

    // ── handshake ─────────────────────────────────────────────────────────

    function scheduleRefresh() {
      if (refreshTimer) {
        try {
          root.clearTimeout(refreshTimer);
        } catch (err) {
          /* no timers */
        }
        refreshTimer = null;
      }
      if (!host || !tokenExpiresAt) return;
      var delay = tokenExpiresAt - Date.now() - REFRESH_LEAD_MS;
      if (delay < 1000) delay = 1000;
      try {
        refreshTimer = root.setTimeout(function () {
          post('arcade:request-token');
        }, delay);
      } catch (err) {
        /* no timers */
      }
    }

    function applyHello(data) {
      user = isPlainObject(data.user)
        ? {
            profileName: typeof data.user.profileName === 'string' ? data.user.profileName : null,
            avatarUrl: typeof data.user.avatarUrl === 'string' ? data.user.avatarUrl : null,
          }
        : null;

      stateUrl = typeof data.stateUrl === 'string' ? data.stateUrl : null;
      leaderboardUrl = typeof data.leaderboardUrl === 'string' ? data.leaderboardUrl : null;
      token = typeof data.token === 'string' && data.token.length > 0 ? data.token : null;

      var expires = 0;
      if (typeof data.expiresAt === 'string') expires = Date.parse(data.expiresAt);
      else if (typeof data.expiresAt === 'number') expires = data.expiresAt;
      tokenExpiresAt = isFinite(expires) && expires > 0 ? expires : Date.now() + 3600 * 1000;

      // A signed-out hello keeps the bridge (so requestSignIn works) but leaves
      // the SDK in local mode — server persistence needs a token (spec §7).
      var nextMode = token && stateUrl ? 'portal' : 'local';
      var changed = nextMode !== mode || (!!token) !== signedIn;
      mode = nextMode;
      signedIn = !!token;
      scheduleRefresh();
      return changed;
    }

    function handshake() {
      return new Promise(function (resolve) {
        var parent = null;
        try {
          parent = root.parent;
        } catch (err) {
          parent = null;
        }
        // Standalone tab, file:// or no framing at all → local mode, no wait.
        if (!parent || parent === root || typeof parent.postMessage !== 'function') {
          resolve();
          return;
        }

        var settled = false;
        var timer = null;

        function finish() {
          if (settled) return;
          settled = true;
          if (timer) {
            try {
              root.clearTimeout(timer);
            } catch (err) {
              /* no timers */
            }
          }
          resolve();
        }

        function onMessage(event) {
          try {
            if (!event || event.source !== parent) return;
            if (host && event.origin !== host.origin) return;
            if (!host && !isAcceptableHostOrigin(event.origin)) return;

            var data = event.data;
            if (!isPlainObject(data) || data.gw !== 1 || data.type !== 'arcade:hello') return;
            if (typeof data.nonce !== 'string' || data.nonce.length === 0) return;
            if (host && data.nonce !== host.nonce) return;

            if (!host) host = { window: parent, origin: event.origin, nonce: data.nonce };
            var changed = applyHello(data);
            var first = !settled;
            finish();
            if (!first && changed) emitChange();
          } catch (err) {
            warn('handshake message ignored: ' + err);
          }
        }

        try {
          root.addEventListener('message', onMessage);
        } catch (err) {
          resolve();
          return;
        }

        try {
          timer = root.setTimeout(finish, HANDSHAKE_TIMEOUT_MS);
        } catch (err) {
          /* no timers: the hello, if any, still resolves */
        }

        try {
          parent.postMessage({ gw: 1, type: 'arcade:ready', sdk: SDK_VERSION }, '*');
        } catch (err) {
          finish();
        }
      });
    }

    // ── save debounce + flush-on-exit ──────────────────────────────────────

    function writeLocalState(state) {
      writeJson(stateKey, state);
    }

    function flush(useKeepalive) {
      if (pendingState === null) return Promise.resolve({ ok: true, status: 200, body: null });
      var state = pendingState;
      pendingState = null;
      if (saveTimer) {
        try {
          root.clearTimeout(saveTimer);
        } catch (err) {
          /* no timers */
        }
        saveTimer = null;
      }

      if (mode !== 'portal') {
        writeLocalState(state);
        return Promise.resolve({ ok: true, status: 200, body: null });
      }

      return callApi('PUT', { state: state }, { keepalive: !!useKeepalive }).then(function (res) {
        // 413 (and any hard failure) keeps the player's progress on the device.
        if (!res.ok) writeLocalState(state);
        return res;
      });
    }

    function installExitFlush() {
      function onExit() {
        try {
          flush(true);
        } catch (err) {
          /* never throw out of an unload handler */
        }
      }
      try {
        root.addEventListener('pagehide', onExit);
      } catch (err) {
        /* no listeners */
      }
      try {
        var doc = root.document;
        if (doc && typeof root.addEventListener === 'function') {
          root.addEventListener('visibilitychange', function () {
            try {
              if (root.document && root.document.visibilityState === 'hidden') onExit();
            } catch (err) {
              /* ignore */
            }
          });
        }
      } catch (err) {
        /* no document */
      }
    }

    // ── public surface ────────────────────────────────────────────────────

    function load() {
      return callApi('GET').then(
        function (res) {
          if (res.ok && isPlainObject(res.body) && isPlainObject(res.body.state)) return res.body.state;
          var local = readJson(stateKey, {});
          return isPlainObject(local) ? local : {};
        },
        function () {
          return {};
        },
      );
    }

    function save(state) {
      if (!isPlainObject(state)) {
        warn('save() expects a plain object; ignoring');
        return Promise.resolve(false);
      }
      pendingState = state;
      if (mode !== 'portal') {
        // Local mode has nothing to batch — write straight through.
        writeLocalState(state);
        pendingState = null;
        return Promise.resolve(true);
      }
      if (saveTimer) {
        try {
          root.clearTimeout(saveTimer);
        } catch (err) {
          /* no timers */
        }
      }
      try {
        saveTimer = root.setTimeout(function () {
          saveTimer = null;
          flush(false);
        }, SAVE_DEBOUNCE_MS);
      } catch (err) {
        return flush(false).then(function () {
          return true;
        });
      }
      return Promise.resolve(true);
    }

    function submitScore(score) {
      var value = safeInt(score);
      if (mode === 'portal') {
        return callApi('PUT', { score: value }).then(function (res) {
          if (res.ok && isPlainObject(res.body)) {
            return {
              bestScore: safeInt(res.body.bestScore),
              rank: typeof res.body.rank === 'number' ? res.body.rank : null,
            };
          }
          return localSubmit(value);
        });
      }
      return Promise.resolve(localSubmit(value));
    }

    function localSubmit(value) {
      var board = localBoard();
      if (value > board.best) board.best = value;
      board = upsertLocalEntry(board);
      saveLocalBoard(board);
      return { bestScore: board.best, rank: localRank(board) };
    }

    function setDisplayName(name) {
      var cleaned = trimName(name);
      if (mode === 'portal') {
        return callApi('PUT', { displayName: cleaned.length ? cleaned : null }).then(function (res) {
          if (!res.ok) localSetName(cleaned);
          return cleaned.length ? cleaned : null;
        });
      }
      localSetName(cleaned);
      return Promise.resolve(cleaned.length ? cleaned : null);
    }

    function localSetName(cleaned) {
      var board = localBoard();
      var previous = board.name;
      if (previous) {
        board.entries = board.entries.filter(function (entry) {
          return !entry || entry.displayName !== previous;
        });
      }
      board.name = cleaned.length ? cleaned : null;
      board = upsertLocalEntry(board);
      saveLocalBoard(board);
    }

    function localLeaderboard() {
      var board = saveLocalBoard(localBoard());
      var out = [];
      for (var i = 0; i < board.entries.length; i += 1) {
        var entry = board.entries[i];
        out.push({
          rank: i + 1,
          displayName: String(entry.displayName),
          score: safeInt(entry.score),
          at: typeof entry.at === 'string' ? entry.at : '',
        });
      }
      return out;
    }

    function leaderboard() {
      if (mode === 'portal' && leaderboardUrl) {
        return attempt(leaderboardUrl, { method: 'GET', headers: { Accept: 'application/json' } }).then(function (res) {
          if (res.status >= 200 && res.status < 300 && isPlainObject(res.body) && Array.isArray(res.body.entries)) {
            return res.body.entries;
          }
          return localLeaderboard();
        });
      }
      return Promise.resolve(localLeaderboard());
    }

    function requestSignIn() {
      // The iframe never navigates itself — the host page owns the redirect.
      if (host) post('arcade:request-signin');
    }

    function on(eventName, fn) {
      if (eventName !== 'change' || typeof fn !== 'function') return function () {};
      listeners.change.push(fn);
      return function off() {
        var index = listeners.change.indexOf(fn);
        if (index >= 0) listeners.change.splice(index, 1);
      };
    }

    var api = {
      game: game,
      load: load,
      save: save,
      submitScore: submitScore,
      setDisplayName: setDisplayName,
      leaderboard: leaderboard,
      requestSignIn: requestSignIn,
      on: on,
      /** Force any debounced save out now. Called automatically on tab exit. */
      flush: function () {
        return flush(false);
      },
    };

    Object.defineProperty(api, 'mode', {
      enumerable: true,
      get: function () {
        return mode;
      },
    });
    Object.defineProperty(api, 'signedIn', {
      enumerable: true,
      get: function () {
        return signedIn;
      },
    });
    Object.defineProperty(api, 'user', {
      enumerable: true,
      get: function () {
        return user;
      },
    });

    return {
      api: api,
      start: function () {
        return handshake().then(function () {
          installExitFlush();
          return api;
        });
      },
    };
  }

  // ── entry point ──────────────────────────────────────────────────────────

  function init(options) {
    var game = '';
    try {
      if (options && typeof options.game === 'string') game = options.game.trim();
    } catch (err) {
      game = '';
    }
    if (!/^[a-z][a-z0-9-]{1,60}$/.test(game)) {
      warn('init({ game }) needs a slug matching ^[a-z][a-z0-9-]{1,60}$ — using "unknown-game"');
      game = 'unknown-game';
    }

    // Optional explicit pin. Overrides the templated value, and is the only way
    // a vendored (untemplated) copy can get an exact origin check.
    try {
      if (options && typeof options.portalOrigin === 'string') {
        var wanted = options.portalOrigin.trim().replace(/\/+$/, '');
        if (/^https?:\/\/[^/?#]+$/.test(wanted)) expectedHostOrigin = wanted;
        else warn('init({ portalOrigin }) must be a bare origin like https://example.org — ignoring');
      }
    } catch (err) {
      /* ignore — never let configuration throw */
    }

    var instance;
    try {
      instance = createArcade(game);
    } catch (err) {
      warn('init failed: ' + err);
      return Promise.resolve(null);
    }

    return instance.start().catch(function (err) {
      warn('handshake failed: ' + err);
      return instance.api;
    });
  }

  root.GatewazeArcade = { init: init, version: SDK_VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : this);
