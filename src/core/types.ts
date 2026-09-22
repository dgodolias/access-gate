import type { PathMatcher } from "./paths.js";

export type { PathMatcher };

/** All user-visible strings on the login page. */
export interface GateTexts {
  /** `<title>` of the login page. */
  title: string;
  /** Small uppercase line above the heading. Empty string hides it. */
  eyebrow: string;
  heading: string;
  intro: string;
  /** Label of the password field. */
  label: string;
  /** Submit button caption. */
  button: string;
  /** Neutral helper text under the button when there is no error. */
  hint: string;
  errors: {
    /** Wrong password. */
    incorrect: string;
    /** Too many failed attempts (429). */
    throttled: string;
    /** Login body larger than `maxFormBytes` (413). */
    tooLarge: string;
    /** Content-Type other than application/x-www-form-urlencoded (415). */
    unsupported: string;
    /** Body could not be read (400). */
    unreadable: string;
    /** Same-origin check failed (403). */
    verify: string;
    /** JSON error for API-like requests without a session (401). */
    unauthenticated: string;
    /** JSON error when the gate is required but not configured (503). */
    unavailable: string;
    /** HTML message when the gate is required but not configured (503). */
    notConfigured: string;
    /** Shown after `?logout=1`. */
    loggedOut: string;
  };
}

export type PartialTexts = Partial<Omit<GateTexts, "errors">> & { errors?: Partial<GateTexts["errors"]> };

/** Colours and typography of the built-in login page. Any CSS value. */
export interface GateTheme {
  colorScheme: "dark" | "light";
  background: string;
  /** Optional decorative gradient painted over the background. Empty disables it. */
  glow: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  /** Text colour on the accent button. */
  accentText: string;
  error: string;
  inputBackground: string;
  radius: string;
  font: string;
  headingFont: string;
}

export type PresetName = "dark" | "paper";

export interface GateEvent {
  type: "login" | "failed" | "throttled" | "denied" | "bypassed";
  /** Best-effort client key (first hop of X-Forwarded-For or "unknown"). */
  ip: string;
  path: string;
  /** Milliseconds since epoch. */
  at: number;
}

export interface AttemptRecord {
  count: number;
  /** Milliseconds since epoch at which the window resets. */
  resetAt: number;
}

/**
 * Storage for failed-attempt counters. The built-in store is in-memory and
 * per-instance; plug in Redis/Upstash/Neon for multi-instance correctness.
 */
export interface GateStore {
  get(key: string): AttemptRecord | undefined | Promise<AttemptRecord | undefined>;
  set(key: string, value: AttemptRecord, ttlMs: number): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

export interface RenderContext {
  /** Absolute path of the login route, e.g. "/_access". Use it as the form action. */
  accessPath: string;
  /** Already validated return path to put in the hidden `next` field (escape it!). */
  nextPath: string;
  /** Error message to show, or "" when there is none. */
  error: string;
  /** Neutral message (e.g. after logout) shown instead of the hint. */
  notice: string;
  texts: GateTexts;
  theme: GateTheme;
  lang: string;
  /** Tiny inline script that preserves `location.hash` in the `next` field; its sha256 is in the CSP. */
  script: string;
  escapeHTML: (value: unknown) => string;
}

export type EnvironmentSource = Record<string, string | undefined>;

export interface GateOptions {
  /** Shared password. Env: ACCESS_GATE_PASSWORD. Unset/empty → gate off (unless failClosed). */
  password?: string | undefined;
  /** Previous password accepted for existing sessions during rotation. Env: ACCESS_GATE_PREVIOUS_PASSWORD. */
  previousPassword?: string | undefined;
  /** Independent signing secret. When set, sessions survive password changes. Env: ACCESS_GATE_SECRET. */
  secret?: string | undefined;
  /** Login route. Env: ACCESS_GATE_PATH. Default "/_access". */
  accessPath?: string | undefined;
  /** Base cookie name (the `__Host-` prefix is added on HTTPS). Env: ACCESS_GATE_COOKIE. Default "access_gate_session". */
  cookieName?: string | undefined;
  /** Session lifetime in seconds, capped at 30 days. Env: ACCESS_GATE_TTL. Default 28800 (8 h). */
  ttlSeconds?: number | undefined;
  /** Paths that pass through untouched. Globs: `*` = one segment, `**` = any depth. Env: ACCESS_GATE_EXEMPT (comma-separated). */
  exempt?: readonly PathMatcher[] | undefined;
  /** Static assets the login page itself may reference (e.g. "/logo.svg"). Env: ACCESS_GATE_PUBLIC_ASSETS. */
  allowPublicAssets?: readonly string[] | undefined;
  /** Path prefixes that always get a JSON 401 instead of the HTML page. Env: ACCESS_GATE_API_PATHS. Default ["/api"]. */
  apiPaths?: readonly string[] | undefined;
  /** Full override of the "is this an API/fetch call?" rule. */
  isApi?: ((url: URL, request: Request) => boolean) | undefined;
  /** Environments (VERCEL_ENV, falling back to NODE_ENV) in which the gate is active. Env: ACCESS_GATE_ENVIRONMENTS. Default ["production", "preview"]. */
  environments?: readonly string[] | undefined;
  /** Master switch. `false` turns the gate off even when a password is set. Env: ACCESS_GATE_ENABLED=false. Default true. */
  enabled?: boolean | undefined;
  /** Gate regardless of environment. Env: ACCESS_GATE_ALWAYS=1. */
  always?: boolean | undefined;
  /** Respond 503 instead of passing through when no password is configured. Env: ACCESS_GATE_REQUIRED=1 (production only). */
  failClosed?: boolean | undefined;
  /** Built-in look. Env: ACCESS_GATE_PRESET. Default "dark". */
  preset?: PresetName | undefined;
  theme?: Partial<GateTheme> | undefined;
  texts?: PartialTexts | undefined;
  /** `lang` attribute of the login page. Env: ACCESS_GATE_LANG. Default "en". */
  lang?: string | undefined;
  /** Escape hatch: render the whole login page yourself. Must post `password` (and `next`) to `ctx.accessPath`. */
  renderPage?: ((ctx: RenderContext) => string) | undefined;
  /** Failed-attempt counter storage. Default: in-memory. */
  store?: GateStore | undefined;
  /** Failed attempts allowed per client key per window. Default 8. */
  maxAttempts?: number | undefined;
  /** Throttle window in milliseconds. Default 600000 (10 min). */
  windowMs?: number | undefined;
  /** Maximum login body size in bytes (streamed). Default 4096. */
  maxFormBytes?: number | undefined;
  /** Observability hook. Never receives the password. */
  onEvent?: ((event: GateEvent) => void) | undefined;
  /** Environment source. Default `process.env` when available. */
  env?: EnvironmentSource | undefined;
  /** Clock override (ms since epoch), for tests. */
  now?: (() => number) | undefined;
}

export type NextHandler = () => Promise<Response> | Response;

export interface Gate {
  /** Runs the gate: returns a gate response, or whatever `next()` returns when the request may proceed. */
  handle(request: Request, next: NextHandler): Promise<Response>;
  /** Resolved (option > env > default) view of the configuration for the given env. Never includes the password. */
  describe(env?: EnvironmentSource): GateDescription;
}

export interface GateDescription {
  environment: string;
  active: boolean;
  configured: boolean;
  failClosed: boolean;
  accessPath: string;
  cookieName: string;
  ttlSeconds: number;
  apiPaths: string[];
  preset: PresetName;
  lang: string;
}
