import { describe, expect, test } from "vitest";
import { clearCookie, effectiveCookieName, readCookie, readSessionCookie, sessionCookie } from "../src/core.js";

function withCookie(header: string | null): Request {
  return new Request("https://gate.test/", header === null ? {} : { headers: { cookie: header } });
}

describe("readCookie", () => {
  test("reads exact names and tolerates spacing, quotes and duplicates", () => {
    expect(readCookie(withCookie("a=1"), "a")).toBe("1");
    expect(readCookie(withCookie("  a = 1 ; b=2"), "a")).toBe("1");
    expect(readCookie(withCookie("b=2; a=1"), "a")).toBe("1");
    expect(readCookie(withCookie('a="quoted"'), "a")).toBe("quoted");
    expect(readCookie(withCookie("a=1; a=2"), "a")).toBe("1");
    expect(readCookie(withCookie("a=x=y"), "a")).toBe("x=y");
    expect(readCookie(withCookie("a="), "a")).toBe("");
  });

  test("ignores malformed pairs, prefixes and absurd headers", () => {
    expect(readCookie(withCookie(null), "a")).toBe("");
    expect(readCookie(withCookie(""), "a")).toBe("");
    expect(readCookie(withCookie("a"), "a")).toBe("");
    expect(readCookie(withCookie(";;;"), "a")).toBe("");
    expect(readCookie(withCookie("aa=1"), "a")).toBe("");
    expect(readCookie(withCookie("xa=1"), "a")).toBe("");
    expect(readCookie(withCookie("__Host-a=1"), "a")).toBe("");
    expect(readCookie(withCookie("=1"), "a")).toBe("");
    expect(readCookie(withCookie(`a=${"x".repeat(20000)}`), "a")).toBe("");
    expect(readCookie(withCookie("b=1;a"), "a")).toBe("");
  });

  test("fuzz: never throws and only returns values for the exact name", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = "abc=;, \t\"__-Host1";
    for (let round = 0; round < 3000; round += 1) {
      const length = Math.floor(random() * 60);
      let header = "";
      for (let index = 0; index < length; index += 1) header += alphabet[Math.floor(random() * alphabet.length)];
      let value = "";
      expect(() => {
        value = readCookie(withCookie(header), "a");
      }).not.toThrow();
      if (value) {
        const names = header.split(";").filter((part) => part.includes("=")).map((part) => part.slice(0, part.indexOf("=")).trim());
        expect(names).toContain("a");
      }
    }
  });
});

describe("session cookie helpers", () => {
  test("prefers the __Host- variant and falls back to the plain one", () => {
    expect(readSessionCookie(withCookie("__Host-s=host; s=plain"), "s")).toBe("host");
    expect(readSessionCookie(withCookie("s=plain"), "s")).toBe("plain");
    expect(readSessionCookie(withCookie("t=other"), "s")).toBe("");
  });

  test("serialises secure and insecure variants", () => {
    expect(effectiveCookieName("s", true)).toBe("__Host-s");
    expect(effectiveCookieName("s", false)).toBe("s");
    expect(sessionCookie("__Host-s", "tok", 60, true)).toBe("__Host-s=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure");
    expect(sessionCookie("s", "tok", 60, false)).toBe("s=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax");
    expect(clearCookie("__Host-s", true)).toBe("__Host-s=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
  });
});
