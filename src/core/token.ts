import { base64url, constantTimeEqual, hmacSha256 } from "./crypto.js";

export const TOKEN_VERSION = "v1";
export const CLOCK_SKEW_SECONDS = 60;
export const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export async function signPayload(payload: string, secret: string): Promise<string> {
  return base64url(await hmacSha256(secret, payload));
}

/** Creates a `v1.<expiresAt>.<signature>` token signed with `secret`. */
export async function createSessionToken(secret: string, ttlSeconds: number, nowMs: number = Date.now()): Promise<string> {
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return `${payload}.${await signPayload(payload, secret)}`;
}

const TOKEN_PATTERN = /^([^.]+)\.(\d{1,15})\.([A-Za-z0-9_-]{20,128})$/;

/**
 * Verifies a token against one or more signing secrets (current + previous
 * during a rotation). Rejects malformed, expired, future-dated (beyond
 * ttl + skew) and tampered tokens.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  secrets: readonly string[],
  ttlSeconds: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const match = TOKEN_PATTERN.exec(String(token ?? ""));
  if (!match || match[1] !== TOKEN_VERSION) return false;

  const expiresAt = Number(match[2]);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= nowSeconds) return false;
  if (expiresAt > nowSeconds + ttlSeconds + CLOCK_SKEW_SECONDS) return false;

  const payload = `${match[1]}.${match[2]}`;
  const provided = match[3]!;
  let valid = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = await signPayload(payload, secret);
    if (await constantTimeEqual(provided, expected)) valid = true;
  }
  return valid;
}

export function clampTtl(value: unknown, fallback: number = DEFAULT_TTL_SECONDS): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_TTL_SECONDS);
}
