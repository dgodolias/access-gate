import { assertCookieName, clearCookie, effectiveCookieName, readSessionCookie, sessionCookie } from "./cookie.js";
import { constantTimeEqual } from "./crypto.js";
import { DEFAULT_MAX_FORM_BYTES, FormError, MAX_PASSWORD_LENGTH, limitedForm } from "./form.js";
import { isSameOriginPost, isSecureRequest, publicOrigin } from "./origin.js";
import {
  DEFAULT_TEXTS,
  HASH_FRAGMENT_SCRIPT,
  escapeHTML,
  hashFragmentScriptDigest,
  mergeTexts,
  mergeTheme,
  renderDefaultPage,
  renderUnavailablePage,
} from "./page.js";
import { compileMatchers, isPathPrefixed, normaliseAccessPath, parseList, safeNextPath, type CompiledMatcher } from "./paths.js";
import { isPresetName, presets } from "./presets.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_MS,
  MemoryStore,
  activeAttempt,
  clientKey,
  recordFailedAttempt,
  retryAfterSeconds,
} from "./throttle.js";
import { DEFAULT_TTL_SECONDS, clampTtl, createSessionToken, verifySessionToken } from "./token.js";
import type {
  EnvironmentSource,
  Gate,
  GateDescription,
  GateEvent,
  GateOptions,
  GateStore,
  GateTexts,
  GateTheme,
  NextHandler,
  PresetName,
  RenderContext,
} from "./types.js";

export const DEFAULT_ACCESS_PATH = "/_access";
export const DEFAULT_COOKIE_NAME = "access_gate_session";
export const DEFAULT_API_PATHS = ["/api"];
export const DEFAULT_ENVIRONMENTS = ["production", "preview"];

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function truthy(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

const FALSY = new Set(["0", "false", "no", "off"]);

function falsy(value: string | undefined): boolean {
  return value !== undefined && FALSY.has(value.trim().toLowerCase());
}

function processEnv(): EnvironmentSource {
  const maybeProcess = (globalThis as { process?: { env?: EnvironmentSource } }).process;
  return maybeProcess && maybeProcess.env ? maybeProcess.env : {};
}

interface ResolvedConfig {
  environment: string;
  active: boolean;
  password: string;
  /** Secrets accepted for session verification; index 0 signs new sessions. */
  secrets: string[];
  failClosed: boolean;
  accessPath: string;
  cookieName: string;
  ttlSeconds: number;
  apiPaths: string[];
  exempt: CompiledMatcher[];
  preset: PresetName;
  texts: GateTexts;
  theme: GateTheme;
  lang: string;
}

function acceptsHtml(request: Request): boolean {
  const accept = request.headers.get("accept");
  if (accept === null || accept.trim() === "") return true;
  const lower = accept.toLowerCase();
  return lower.includes("text/html") || lower.includes("*/*") || lower.includes("application/xhtml+xml");
}

function looksLikeFetch(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  return mode !== null && mode.trim() !== "" && mode.trim().toLowerCase() !== "navigate";
}

export function createGate(options: GateOptions = {}): Gate {
  const store: GateStore = options.store ?? new MemoryStore(() => (options.now ? options.now() : Date.now()));
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const windowMs = Math.max(1000, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS));
  const maxFormBytes = Math.max(64, Math.floor(options.maxFormBytes ?? DEFAULT_MAX_FORM_BYTES));
  const optionExempt = compileMatchers([...(options.exempt ?? []), ...(options.allowPublicAssets ?? [])]);
  const isApi = options.isApi;
  const renderPage = options.renderPage ?? renderDefaultPage;
  const onEvent = options.onEvent;
  const envMatcherCache = new Map<string, CompiledMatcher[]>();

  if (options.accessPath !== undefined) normaliseAccessPath(options.accessPath);
  if (options.cookieName !== undefined) assertCookieName(options.cookieName);

  function now(): number {
    return options.now ? options.now() : Date.now();
  }

  function envMatchers(env: EnvironmentSource): CompiledMatcher[] {
    const raw = `${env.ACCESS_GATE_EXEMPT ?? ""}\n${env.ACCESS_GATE_PUBLIC_ASSETS ?? ""}`;
    if (!raw.trim()) return [];
    let compiled = envMatcherCache.get(raw);
    if (!compiled) {
      compiled = compileMatchers([...parseList(env.ACCESS_GATE_EXEMPT), ...parseList(env.ACCESS_GATE_PUBLIC_ASSETS)]);
      if (envMatcherCache.size > 16) envMatcherCache.clear();
      envMatcherCache.set(raw, compiled);
    }
    return compiled;
  }

  function resolve(env: EnvironmentSource): ResolvedConfig {
    const environment = env.VERCEL_ENV || (env.NODE_ENV === "production" ? "production" : "development");
    const environments = options.environments ?? (env.ACCESS_GATE_ENVIRONMENTS !== undefined ? parseList(env.ACCESS_GATE_ENVIRONMENTS) : DEFAULT_ENVIRONMENTS);
    const always = options.always ?? truthy(env.ACCESS_GATE_ALWAYS);
    // Master switch: enabled=false (or ACCESS_GATE_ENABLED=false/0/off/no) turns the gate off even with a password set.
    const enabled = options.enabled ?? !falsy(env.ACCESS_GATE_ENABLED);
    const active = enabled && (always || environments.includes(environment));

    const password = options.password ?? env.ACCESS_GATE_PASSWORD ?? "";
    const previousPassword = options.previousPassword ?? env.ACCESS_GATE_PREVIOUS_PASSWORD ?? "";
    const secret = options.secret ?? env.ACCESS_GATE_SECRET ?? "";
    const secrets = secret ? [secret] : [password, previousPassword].filter((value) => value.length > 0);

    const failClosed = options.failClosed ?? (truthy(env.ACCESS_GATE_REQUIRED) && environment === "production");
    const accessPath = normaliseAccessPath(options.accessPath ?? env.ACCESS_GATE_PATH ?? DEFAULT_ACCESS_PATH);
    const cookieName = assertCookieName(options.cookieName ?? env.ACCESS_GATE_COOKIE ?? DEFAULT_COOKIE_NAME);
    const ttlSeconds = clampTtl(options.ttlSeconds ?? env.ACCESS_GATE_TTL, DEFAULT_TTL_SECONDS);
    const apiPaths = [...(options.apiPaths ?? (env.ACCESS_GATE_API_PATHS !== undefined ? parseList(env.ACCESS_GATE_API_PATHS) : DEFAULT_API_PATHS))];

    const presetCandidate = options.preset ?? env.ACCESS_GATE_PRESET;
    const preset: PresetName = isPresetName(presetCandidate) ? presetCandidate : "dark";
    const theme = mergeTheme(presets[preset], options.theme);
    const texts = mergeTexts(DEFAULT_TEXTS, options.texts);
    const lang = (options.lang ?? env.ACCESS_GATE_LANG ?? "en").trim() || "en";

    return {
      environment,
      active,
      password,
      secrets,
      failClosed,
      accessPath,
      cookieName,
      ttlSeconds,
      apiPaths,
      exempt: [...optionExempt, ...envMatchers(env)],
      preset,
      texts,
      theme,
      lang,
    };
  }

  function emit(type: GateEvent["type"], request: Request, path: string): void {
    if (!onEvent) return;
    try {
      onEvent({ type, ip: clientKey(request), path, at: now() });
    } catch {
      // Observability must never break the gate.
    }
  }

  async function baseHeaders(extra: Record<string, string> = {}): Promise<Headers> {
    const digest = await hashFragmentScriptDigest();
    const headers = new Headers({
      "cache-control": "private, no-store, max-age=0",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${digest}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
    });
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
    return headers;
  }

  async function htmlResponse(request: Request, body: string, status: number, extra: Record<string, string> = {}): Promise<Response> {
    const headers = await baseHeaders({ "content-type": "text/html; charset=utf-8", ...extra });
    return new Response(request.method === "HEAD" ? null : body, { status, headers });
  }

  async function jsonResponse(request: Request, status: number, error: string, extra: Record<string, string> = {}): Promise<Response> {
    const headers = await baseHeaders({ "content-type": "application/json; charset=utf-8", ...extra });
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ ok: false, error }), { status, headers });
  }

  async function redirect(request: Request, path: string, cookie?: string): Promise<Response> {
    const location = new URL(path, `${publicOrigin(request)}/`).toString();
    const headers = await baseHeaders({ location });
    if (cookie) headers.set("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
  }

  function page(config: ResolvedConfig, nextPath: string, error = "", notice = ""): string {
    const ctx: RenderContext = {
      accessPath: config.accessPath,
      nextPath,
      error,
      notice,
      texts: config.texts,
      theme: config.theme,
      lang: config.lang,
      script: HASH_FRAGMENT_SCRIPT,
      escapeHTML,
    };
    return renderPage(ctx);
  }

  function apiLike(config: ResolvedConfig, url: URL, request: Request): boolean {
    if (isApi) return isApi(url, request);
    return isPathPrefixed(url.pathname, config.apiPaths) || !acceptsHtml(request) || looksLikeFetch(request);
  }

  function isExempt(config: ResolvedConfig, url: URL, request: Request): boolean {
    for (const matcher of config.exempt) {
      if (matcher(url, request)) return true;
    }
    return false;
  }

  async function unavailable(config: ResolvedConfig, request: Request, url: URL): Promise<Response> {
    if (apiLike(config, url, request)) return jsonResponse(request, 503, config.texts.errors.unavailable);
    return htmlResponse(request, renderUnavailablePage(config.texts, config.lang), 503);
  }

  async function handleAccessRoute(config: ResolvedConfig, request: Request, url: URL): Promise<Response> {
    const nowMs = now();
    const secure = isSecureRequest(request);
    const cookieName = effectiveCookieName(config.cookieName, secure);
    const queryNext = safeNextPath(url.searchParams.get("next"), config.accessPath);

    if (request.method === "GET" || request.method === "HEAD") {
      if (url.searchParams.get("logout") === "1") {
        return htmlResponse(request, page(config, queryNext, "", config.texts.errors.loggedOut), 200, {
          "set-cookie": clearCookie(cookieName, secure),
        });
      }
      const existing = readSessionCookie(request, config.cookieName);
      if (await verifySessionToken(existing, config.secrets, config.ttlSeconds, nowMs)) return redirect(request, queryNext);
      return htmlResponse(request, page(config, queryNext), 200);
    }

    if (request.method !== "POST") {
      const headers = await baseHeaders({ allow: "GET, HEAD, POST" });
      return new Response(null, { status: 405, headers });
    }

    if (!isSameOriginPost(request)) {
      return htmlResponse(request, page(config, queryNext, config.texts.errors.verify), 403);
    }

    const key = clientKey(request);
    const attempt = await activeAttempt(store, key, nowMs, windowMs);
    if (attempt.count >= maxAttempts) {
      emit("throttled", request, url.pathname);
      return htmlResponse(request, page(config, queryNext, config.texts.errors.throttled), 429, {
        "retry-after": String(retryAfterSeconds(attempt, nowMs)),
      });
    }

    let form: URLSearchParams;
    try {
      form = await limitedForm(request, maxFormBytes);
    } catch (error) {
      const code = error instanceof FormError ? error.code : "UNREADABLE";
      if (code === "FORM_TOO_LARGE") return htmlResponse(request, page(config, queryNext, config.texts.errors.tooLarge), 413);
      if (code === "UNSUPPORTED_MEDIA_TYPE") return htmlResponse(request, page(config, queryNext, config.texts.errors.unsupported), 415);
      return htmlResponse(request, page(config, queryNext, config.texts.errors.unreadable), 400);
    }

    const submitted = form.get("password");
    const formNext = form.has("next") ? safeNextPath(form.get("next"), config.accessPath) : queryNext;
    const valid =
      typeof submitted === "string" && submitted.length > 0 && submitted.length <= MAX_PASSWORD_LENGTH && (await constantTimeEqual(submitted, config.password));

    if (!valid) {
      const failed = await recordFailedAttempt(store, key, nowMs, windowMs);
      if (failed.count >= maxAttempts) {
        emit("throttled", request, url.pathname);
        return htmlResponse(request, page(config, formNext, config.texts.errors.throttled), 429, {
          "retry-after": String(retryAfterSeconds(failed, nowMs)),
        });
      }
      emit("failed", request, url.pathname);
      return htmlResponse(request, page(config, formNext, config.texts.errors.incorrect), 401);
    }

    await store.delete(key);
    emit("login", request, url.pathname);
    const token = await createSessionToken(config.secrets[0]!, config.ttlSeconds, nowMs);
    return redirect(request, formNext, sessionCookie(cookieName, token, config.ttlSeconds, secure));
  }

  async function handle(request: Request, next: NextHandler): Promise<Response> {
    const env = options.env ?? processEnv();
    const config = resolve(env);
    if (!config.active) return next();

    const url = new URL(request.url);
    if (!config.password) {
      if (config.failClosed) return unavailable(config, request, url);
      return next();
    }

    if (url.pathname === config.accessPath) return handleAccessRoute(config, request, url);

    if (isExempt(config, url, request)) {
      emit("bypassed", request, url.pathname);
      return next();
    }

    const token = readSessionCookie(request, config.cookieName);
    if (await verifySessionToken(token, config.secrets, config.ttlSeconds, now())) return next();

    emit("denied", request, url.pathname);
    if (apiLike(config, url, request)) return jsonResponse(request, 401, config.texts.errors.unauthenticated);

    const nextPath = safeNextPath(`${url.pathname}${url.search}`, config.accessPath);
    return htmlResponse(request, page(config, nextPath), 401);
  }

  function describe(env: EnvironmentSource = options.env ?? processEnv()): GateDescription {
    const config = resolve(env);
    return {
      environment: config.environment,
      active: config.active,
      configured: config.password.length > 0,
      failClosed: config.failClosed,
      accessPath: config.accessPath,
      cookieName: config.cookieName,
      ttlSeconds: config.ttlSeconds,
      apiPaths: config.apiPaths,
      preset: config.preset,
      lang: config.lang,
    };
  }

  return { handle, describe };
}
