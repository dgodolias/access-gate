import { describe, expect, test } from "vitest";
import { globToRegExp, isPathPrefixed, parseList, safeNextPath } from "../src/core.js";

const ACCESS = "/_access";

describe("safeNextPath", () => {
  test("keeps safe relative paths with query and hash (surrounding whitespace is trimmed)", () => {
    expect(safeNextPath(" /x\n", ACCESS)).toBe("/x");
    expect(safeNextPath("/", ACCESS)).toBe("/");
    expect(safeNextPath("/dashboard", ACCESS)).toBe("/dashboard");
    expect(safeNextPath("/a/b?c=1&d=2#frag", ACCESS)).toBe("/a/b?c=1&d=2#frag");
    expect(safeNextPath("/_accessible", ACCESS)).toBe("/_accessible");
    expect(safeNextPath("/@evil.test", ACCESS)).toBe("/@evil.test");
    expect(safeNextPath("/%CE%B1", ACCESS)).toBe("/%CE%B1");
    expect(safeNextPath("/ελληνικά", ACCESS)).toBe("/%CE%B5%CE%BB%CE%BB%CE%B7%CE%BD%CE%B9%CE%BA%CE%AC");
    // Unicode line/paragraph separators are percent-encoded, never emitted raw.
    expect(safeNextPath("/\u2028x", ACCESS)).toBe("/%E2%80%A8x");
  });

  test("collapses unsafe or foreign targets to /", () => {
    const unsafe = [
      "",
      null,
      undefined,
      42,
      "   ",
      "https://evil.test/",
      "http://evil.test",
      "//evil.test/",
      "///evil.test",
      "/\\evil.test/",
      "\\\\evil.test",
      "/a\\b",
      "\r\nLocation: https://evil.test",
      "/x\r\nSet-Cookie: a=b",
      "/x\0",
      "/x y",
      "/x\ty",
      "javascript:alert(1)",
      "data:text/html,hi",
      "evil.test",
      "?next=/x",
      "#hash",
      "/_access",
      "/_access/",
      "/_access?next=/x",
      "/_access/sub",
      "/x\u007f",
      `/${"a".repeat(3000)}`,
      "/\u0000",
    ];
    for (const candidate of unsafe) {
      expect(safeNextPath(candidate, ACCESS), JSON.stringify(candidate)).toBe("/");
    }
  });

  test("fuzz: random byte soup never escapes the origin", () => {
    let seed = 1234567;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = "/\\:@?#%&=.\r\n\t \u0000abcXYZ09-_~!$'()*+,;[]{}|^`<>\"";
    for (let round = 0; round < 3000; round += 1) {
      const length = Math.floor(random() * 40);
      let candidate = "";
      for (let index = 0; index < length; index += 1) candidate += alphabet[Math.floor(random() * alphabet.length)];
      const result = safeNextPath(candidate, ACCESS);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(result).not.toMatch(/[\r\n\\\0\s]/);
      const resolved = new URL(result, "https://origin.test");
      expect(resolved.origin).toBe("https://origin.test");
      expect(resolved.pathname === ACCESS || resolved.pathname.startsWith(`${ACCESS}/`)).toBe(false);
    }
  });
});

describe("globToRegExp", () => {
  test("exact, single-segment and multi-segment wildcards", () => {
    expect(globToRegExp("/api/health").test("/api/health")).toBe(true);
    expect(globToRegExp("/api/health").test("/api/healthz")).toBe(false);
    expect(globToRegExp("/api/cron/*").test("/api/cron/daily")).toBe(true);
    expect(globToRegExp("/api/cron/*").test("/api/cron/")).toBe(true);
    expect(globToRegExp("/api/cron/*").test("/api/cron/a/b")).toBe(false);
    expect(globToRegExp("/api/cron/**").test("/api/cron/a/b")).toBe(true);
    expect(globToRegExp("/*.png").test("/logo.png")).toBe(true);
    expect(globToRegExp("/*.png").test("/img/logo.png")).toBe(false);
    expect(globToRegExp("/a.b").test("/aXb")).toBe(false);
    expect(globToRegExp("/(x)+?").test("/(x)+?")).toBe(true);
  });
});

describe("helpers", () => {
  test("parseList trims and drops empties", () => {
    expect(parseList(" /a, /b ,, /c ")).toEqual(["/a", "/b", "/c"]);
    expect(parseList("")).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });

  test("isPathPrefixed matches whole segments only", () => {
    expect(isPathPrefixed("/api", ["/api"])).toBe(true);
    expect(isPathPrefixed("/api/x", ["/api"])).toBe(true);
    expect(isPathPrefixed("/apix", ["/api"])).toBe(false);
    expect(isPathPrefixed("/x", [])).toBe(false);
    expect(isPathPrefixed("/x", [""])).toBe(false);
  });
});
