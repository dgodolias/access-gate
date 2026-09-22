const MAX_COOKIE_HEADER = 16 * 1024;
const COOKIE_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * Minimal, defensive cookie parser. Returns the first value whose name matches
 * exactly, ignores malformed pairs and refuses absurdly large headers.
 */
export function readCookie(request: Request, name: string): string {
  const header = request.headers.get("cookie");
  if (!header || header.length > MAX_COOKIE_HEADER) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return value;
  }
  return "";
}

export function assertCookieName(name: string): string {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.length > 128 || !COOKIE_NAME_PATTERN.test(trimmed)) {
    throw new Error(`access-gate: invalid cookie name "${name}".`);
  }
  if (trimmed.startsWith("__Host-") || trimmed.startsWith("__Secure-")) {
    throw new Error("access-gate: do not include the __Host-/__Secure- prefix in cookieName; it is added automatically on HTTPS.");
  }
  return trimmed;
}

export function effectiveCookieName(baseName: string, secure: boolean): string {
  return secure ? `__Host-${baseName}` : baseName;
}

/** Reads the session cookie, preferring the `__Host-` variant. */
export function readSessionCookie(request: Request, baseName: string): string {
  return readCookie(request, `__Host-${baseName}`) || readCookie(request, baseName);
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [`${name}=${token}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  const attributes = [`${name}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
