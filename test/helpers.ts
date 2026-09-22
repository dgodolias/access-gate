import { createGate, MemoryStore } from "../src/core.js";
import type { EnvironmentSource, GateOptions, GateStore } from "../src/core.js";

/** Obviously fake test value. The real password never appears in this repository. */
export const PASSWORD = "test-only-not-a-real-password";
export const ORIGIN = "https://gate.test";
export const HTTP_ORIGIN = "http://localhost:3000";
export const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
export const PROD_ENV: EnvironmentSource = { VERCEL_ENV: "production", ACCESS_GATE_PASSWORD: PASSWORD };

export function request(path = "/", init: RequestInit = {}, origin = ORIGIN): Request {
  return new Request(`${origin}${path}`, init);
}

/** A browser-like navigation (Accept: text/html, no sec-fetch headers, like in-app browsers). */
export function navigate(path = "/", headers: Record<string, string> = {}, origin = ORIGIN): Request {
  return request(path, { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...headers } }, origin);
}

export function nextResponse(): Response {
  return new Response("continued", { headers: { "x-test-next": "1" } });
}

export interface InvokeOptions extends GateOptions {
  now?: () => number;
}

export function gateWith(options: GateOptions = {}, env: EnvironmentSource = PROD_ENV, now = NOW, store: GateStore = new MemoryStore(() => now)) {
  return createGate({ env, now: () => now, store, ...options });
}

export function invoke(req: Request, env: EnvironmentSource = PROD_ENV, now = NOW, store: GateStore = new MemoryStore(() => now), options: GateOptions = {}) {
  return gateWith(options, env, now, store).handle(req, nextResponse);
}

export function loginRequest(
  password: string,
  next = "/#chat",
  origin = ORIGIN,
  ip = Math.random().toString(),
  extraHeaders: Record<string, string> = {},
  requestOrigin = ORIGIN,
): Request {
  const body = new URLSearchParams({ password, next }).toString();
  return request(
    "/_access",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        origin,
        "x-forwarded-for": ip,
        ...extraHeaders,
      },
      body,
    },
    requestOrigin,
  );
}

export function cookieOf(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";", 1)[0]!;
}
