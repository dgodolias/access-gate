/**
 * Crypto primitives built only on Web Crypto (`globalThis.crypto.subtle`),
 * `TextEncoder` and `btoa`. No `node:` imports, so the same code runs on the
 * Node runtime, the Edge runtime and any other WinterCG-compatible host.
 */

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error("access-gate: Web Crypto (globalThis.crypto.subtle) is not available in this runtime.");
  }
  return c.subtle;
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export async function sha256(value: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof value === "string" ? utf8(value) : value;
  const digest = await subtle().digest("SHA-256", data as BufferSource);
  return new Uint8Array(digest);
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}

export function base64url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let cached = keyCache.get(secret);
  if (!cached) {
    cached = subtle().importKey("raw", utf8(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    // Do not let an unbounded number of secrets accumulate (rotations, tests).
    if (keyCache.size > 64) keyCache.clear();
    keyCache.set(secret, cached);
    cached.catch(() => keyCache.delete(secret));
  }
  return cached;
}

export async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const signature = await subtle().sign("HMAC", key, utf8(payload) as BufferSource);
  return new Uint8Array(signature);
}

/** Constant-time comparison of two byte arrays of equal length. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
  return diff === 0;
}

/**
 * Constant-time string comparison: both inputs are hashed to fixed-length
 * digests first, so neither the length nor the content of the secret leaks
 * through timing.
 */
export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256(String(left)), sha256(String(right))]);
  return bytesEqual(leftDigest, rightDigest);
}
