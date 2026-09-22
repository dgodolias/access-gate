export type PathMatcher = string | RegExp | ((url: URL, request: Request) => boolean);

const MAX_NEXT_LENGTH = 2048;

/**
 * Validates a post-login return path. Only same-origin, absolute-path
 * references survive; everything else collapses to "/".
 */
export function safeNextPath(value: unknown, accessPath: string): string {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > MAX_NEXT_LENGTH) return "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  if (candidate.includes("\\")) return "/";
  // Reject control characters and raw whitespace that could confuse a Location header.
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code < 0x21 || code === 0x7f) return "/";
  }

  try {
    const base = new URL("https://access-gate.invalid");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return "/";
    if (parsed.username || parsed.password) return "/";
    if (parsed.pathname === accessPath || parsed.pathname.startsWith(`${accessPath}/`)) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function normaliseAccessPath(value: unknown): string {
  const candidate = String(value ?? "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || /[\s\\?#]/.test(candidate) || candidate.length > 256) {
    throw new Error(`access-gate: accessPath must be an absolute path without query/hash, got "${candidate}".`);
  }
  return candidate.length > 1 && candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compiles a glob-ish pattern: `*` matches within one path segment, `**`
 * matches across segments. A pattern without wildcards matches exactly.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

export type CompiledMatcher = (url: URL, request: Request) => boolean;

export function compileMatchers(list: readonly PathMatcher[]): CompiledMatcher[] {
  return list.map((entry) => {
    if (typeof entry === "function") return entry;
    if (entry instanceof RegExp) return (url: URL) => entry.test(url.pathname);
    const pattern = String(entry).trim();
    if (!pattern) return () => false;
    const regexp = globToRegExp(pattern);
    return (url: URL) => regexp.test(url.pathname);
  });
}

export function parseList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isPathPrefixed(pathname: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) return true;
  }
  return false;
}
