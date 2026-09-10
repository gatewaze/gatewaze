/**
 * Mobile app module-contribution contract (spec-mobile-app.md).
 *
 * A module opts into the Gatewaze mobile app by shipping a `mobile/`
 * directory whose `index.ts` exports a `GatewazeMobileModule`. The mobile
 * registry generator (packages/mobile/scripts/generate-mobile-registry.ts)
 * discovers these from configured module sources and bakes them into the
 * app at build time. The core app itself contains no module-specific code.
 *
 * Everything here is either plain data or a lazily-required component
 * thunk. Components are React Native component trees ONLY — no DOM, no
 * webviews. Types are framework-agnostic (`unknown` component payloads,
 * mirroring GatewazeModule's portal/admin route typing) so this package
 * never depends on react-native.
 */

/** Lazy component thunk — `() => require('./screens/Foo')` or dynamic import. */
export type MobileComponentThunk = () =>
  | { default: unknown }
  | Promise<{ default: unknown }>;

/**
 * Native capabilities the core capability kit ships. A module must declare
 * every capability its mobile code uses; the registry generator unions the
 * declarations per build to gate entitlements/permissions, and fails the
 * build if a module imports capability code it did not declare.
 */
export type MobileCapability =
  | 'camera'
  | 'barcode'
  | 'image-picker'
  | 'health'
  | 'notifications';

/**
 * One primary destination contributed by a module.
 *
 * Named "tab" for history; since the coach rebrand these render as entries
 * in the app's slide-out drawer, grouped by `section`. The shape is
 * unchanged so existing manifests keep working.
 */
export interface MobileTabContribution {
  /** Stable id, unique across the app's baked modules. */
  id: string;
  /** Label shown in the drawer. */
  label: string;
  /** Core icon name (an SF Symbol on iOS, MaterialCommunityIcons elsewhere). */
  icon: string;
  /** Sort order across all modules' entries (ascending). */
  order: number;
  /** The destination's screen component. */
  screen: MobileComponentThunk;
  /**
   * Drawer section heading this entry groups under, e.g. 'Health'.
   * Entries without one group under the app's own name. Sections render
   * in the order their lowest-ordered entry appears.
   */
  section?: string;
}

/**
 * A composer mode contributed by a module (the mode-pill track next to the
 * chat input). The core owns the composer; modules own what each mode
 * does, so the core never calls a module's API.
 */
export interface MobileComposerMode {
  /** Stable id, unique across baked modules, e.g. 'photo' | 'scan'. */
  id: string;
  /** Pill label. */
  label: string;
  /** Core icon name. */
  icon: string;
  /** Order within the mode track (ascending); the core's Chat mode is first. */
  order: number;
  /**
   * The mode's surface, rendered behind the composer while the mode is
   * active (camera preview, scanner, search results). Reports results by
   * enqueuing or creating through its own module's API.
   *
   * Receives `{ onDismiss, threadId, switchMode }`. `switchMode` hands
   * control to another mode of the SAME module by its bare id, with
   * optional props for the surface it opens. A surface that renders a
   * sibling mode itself would leave the core's mode pill pointing at the
   * one it replaced, because the core owns that state.
   */
  surface: MobileComponentThunk;
}

/**
 * What the core's on-device detection saw in a captured photo.
 *
 * Detection runs on the device, never on a server. The whole point of the
 * progress-photo privacy work is that the exposure window is a plaintext
 * photo sitting on someone else's computer, so a photo must not be uploaded
 * merely to work out where it should go.
 */
export interface MobilePhotoDetection {
  /** Whether a person was found, and how sure the detector is (0 to 1). */
  person: boolean;
  confidence: number;
  /**
   * Which way the person is facing, when that could be told apart. Inferred
   * from face visibility and shoulder separation, so it is a suggestion the
   * receiving surface may override, not a fact.
   */
  facing?: 'front' | 'side' | 'back';
}

/** The subject a photo target handles. */
export type MobilePhotoSubject = 'person' | 'other';

/**
 * Somewhere a captured photo can go. The core owns the camera and the
 * routing; a module owns what happens to the image.
 *
 * The core routes silently when detection is confident. When it is not, the
 * member is asked to confirm, and `label` is what they see. Modules do not
 * get to draw a chooser of their own.
 */
export interface MobilePhotoTarget {
  /** Stable id, unique within the module. */
  id: string;
  /** Which subject routes here. */
  subject: MobilePhotoSubject;
  /** Shown only when the member is asked to confirm, e.g. 'Progress photo'. */
  label: string;
  icon: string;
  /** Ascending; the lowest order wins when two targets claim one subject. */
  order: number;
  /**
   * Receives `{ photoUri, detection, onDismiss }`. It must not re-open the
   * camera: the photo has already been taken.
   */
  surface: MobileComponentThunk;
}

/**
 * Drives the coach conversation. Exactly ONE baked module may declare this;
 * the registry generator fails the build if two do. With none declared, the
 * app has no coach surface and opens at the first enabled destination,
 * which keeps non-coach builds (e.g. a future foundation app) working.
 */
export interface MobileCoachProvider {
  /** List the member's threads for the drawer's Recents. */
  threads: (ctx: MobileModuleContext) => Promise<MobileCoachThreadSummary[]>;
  /** Load one thread's messages. */
  thread: (ctx: MobileModuleContext, threadId: string) => Promise<MobileCoachMessage[]>;
  /** Start a new thread; resolves to its id. */
  createThread: (ctx: MobileModuleContext) => Promise<string>;
  /** Send a member message. */
  send: (
    ctx: MobileModuleContext,
    threadId: string,
    text: string,
    attachments?: unknown
  ) => Promise<void>;
  /**
   * Ask for a reply and poll until it lands (the module owns the polling
   * contract). Resolves to the updated message list.
   */
  generate: (ctx: MobileModuleContext, threadId: string) => Promise<MobileCoachMessage[]>;
  /** Unread count for the drawer badge, if the module tracks one. */
  unread?: (ctx: MobileModuleContext) => Promise<number>;
  /**
   * The opening of an empty coach thread: a greeting, an optional line of
   * context beneath it, and suggested openers. The core cannot know a
   * member's name or what today holds, so the module supplies them.
   */
  greeting?: (ctx: MobileModuleContext) => Promise<MobileCoachGreeting>;
}

export interface MobileCoachGreeting {
  /** e.g. "Morning, Dan." */
  title: string;
  /** e.g. "Push Day and 1,430 kcal to go." Rendered in italics. */
  subtitle?: string;
  /** Tappable openers shown under a "FOR YOU" label. */
  starters?: string[];
}

export interface MobileCoachThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * One message in the coach thread. `cards` carry module-specific payloads
 * rendered by the contributing module's registered renderer, so the core
 * shows rich content without knowing any module's data shapes.
 */
export interface MobileCoachMessage {
  id: string;
  role: 'member' | 'coach';
  text?: string;
  /** Tappable quick replies the member can send back. */
  choices?: string[];
  /** Rich cards, dispatched to threadCards renderers by `kind`. */
  cards?: Array<{ kind: string; payload: unknown }>;
  createdAt: string;
  /** Set while a reply is being generated, so the core can show progress. */
  pending?: boolean;
}

/** A non-tab screen, pushed by name via the core router (`/m/<module>/<name>`). */
export interface MobileScreenContribution {
  /** Route name, unique within the module. */
  name: string;
  /** Screen title shown in the header (module can also set it at runtime). */
  title?: string;
  screen: MobileComponentThunk;
}

/** A section contributed to the core-hosted Settings screen. */
export interface MobileSettingsSection {
  id: string;
  title: string;
  order?: number;
  component: MobileComponentThunk;
}

/**
 * Typed failure taxonomy the core API client maps every error into
 * (spec-mobile-app.md "Error handling"). Screens branch on `kind`,
 * never on raw status codes.
 */
export interface MobileApiFailure {
  kind: 'offline' | 'auth' | 'client' | 'server' | 'local';
  status?: number;
  /** Stable machine code when the API supplied one. */
  code?: string;
  message: string;
}

/**
 * The context handed to module code (entitlement probes, outbox replay,
 * lifecycle hooks) and available to screens via the core's useModuleContext().
 *
 * Deliberately generic: core primitives only, so the core never knows any
 * module's client types. Modules build their typed call slices on these.
 */
export interface MobileModuleContext {
  /**
   * Authenticated fetch against the brand API. Prepends the API base URL,
   * attaches the bearer token, retries once on 401 after a forced refresh,
   * and throws a MobileApiFailure on any error. 204 resolves to undefined;
   * other successes resolve to parsed JSON.
   */
  apiFetch: (path: string, init?: MobileFetchInit) => Promise<unknown>;
  /** Read-through cache (backed by sqlite; wiped on sign-out). */
  cacheGet: (key: string) => Promise<unknown | undefined>;
  cacheSet: (key: string, value: unknown) => Promise<void>;
  /**
   * Enqueue a write into the offline outbox. `kind` must be registered in
   * the module's `outboxKinds`; `clientRef` is generated by the caller once
   * per logical action and reused across retries (server-side idempotency).
   */
  enqueue: (kind: string, payload: unknown, clientRef: string) => Promise<void>;
  /**
   * Best-effort shared in-memory KV for the signed-in session (e.g. a
   * module caching the member profile for its own screens). Cleared on
   * sign-out. Never persisted.
   */
  store: {
    get: (key: string) => unknown | undefined;
    set: (key: string, value: unknown) => void;
  };
}

/** Subset of RequestInit the mobile API client supports (framework-agnostic). */
export interface MobileFetchInit {
  method?: string;
  headers?: Record<string, string>;
  /** JSON-serialisable body, or FormData (typed unknown to avoid DOM libs here). */
  body?: unknown;
}

/**
 * Result of a module's post-sign-in hook. 'blocked' means the member cannot
 * proceed into this module family yet (e.g. no person record linked); the
 * core shows the module's `blockedScreen` until a retry succeeds.
 */
export type MobileSessionReadyResult = 'ready' | 'blocked';

/** The manifest a module's `mobile/index.ts` exports. */
export interface GatewazeMobileModule {
  /** Module id — must match the module's manifest id. */
  id: string;
  /** Bottom tabs this module contributes (shown only when `available` passes). */
  tabs?: MobileTabContribution[];
  /** Pushable screens (`/m/<module>/<name>`). */
  screens?: MobileScreenContribution[];
  /** Sections contributed to the core Settings screen. */
  settingsSections?: MobileSettingsSection[];
  /**
   * One-line description of what account deletion removes for this module.
   * Collated by the registry generator into the deletion confirmation.
   */
  deletionCopy?: string;
  /** Capabilities from the core kit this module's code uses. */
  requiredCapabilities?: MobileCapability[];
  /**
   * Composer modes this module adds to the coach composer (photo capture,
   * barcode scan, food search, ...). The core renders the mode track from
   * the union of baked modules' modes, filtered by entitlement.
   */
  composerModes?: MobileComposerMode[];
  /**
   * Renderers for rich cards this module's data appears in, keyed by card
   * kind (namespaced '<module-id>:<kind>'). The core thread surface
   * dispatches by kind; an unregistered kind renders a plain fallback.
   * Each renderer receives `{ payload, threadId }` and talks only to its
   * own module's API.
   */
  threadCards?: Record<string, MobileComponentThunk>;
  /**
   * Declared by the single module that owns the coach conversation.
   * See MobileCoachProvider.
   */
  coachProvider?: MobileCoachProvider;
  /**
   * Runtime entitlement probe: "is this module enabled for the signed-in
   * member?" Evaluated after sign-in and on foreground; the result is
   * persisted as last-known-good so offline launches keep their tabs.
   * Must resolve false (not throw) for a definitive "no"; throwing is
   * treated as transient and keeps the last-known state.
   */
  available: (ctx: MobileModuleContext) => Promise<boolean>;
  /**
   * Optional post-sign-in hook, run before entitlement probes. A module
   * that must bootstrap the member (e.g. link the auth user to a person
   * row) does it here with its own retry policy. Returning 'blocked'
   * shows `blockedScreen` instead of the tab UI.
   */
  onSessionReady?: (ctx: MobileModuleContext) => Promise<MobileSessionReadyResult>;
  /** Screen shown while this module reports 'blocked'. */
  blockedScreen?: MobileComponentThunk;
  /**
   * Account deletion hook. The core Settings delete flow shows the
   * generator-collated deletionCopy list, then invokes each module's hook.
   * Per spec, deletion must be ONE server-side call — a family's root
   * module (e.g. health-core) implements the orchestrating call here and
   * sibling modules omit the hook.
   */
  deleteAccount?: (ctx: MobileModuleContext) => Promise<void>;
  /**
   * Replay handlers for this module's outbox kinds. The core outbox calls
   * the handler with the stored payload + clientRef; the handler performs
   * the write through the module's typed client. Throwing a
   * MobileApiFailure with kind 'client' marks the row failed (user-facing
   * retry/discard); 'offline'/'server' failures stay pending for retry.
   */
  outboxKinds?: Record<
    string,
    (ctx: MobileModuleContext, payload: unknown, clientRef: string) => Promise<void>
  >;
}
