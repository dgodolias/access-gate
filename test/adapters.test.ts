import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import * as nextEntry from "../src/next.js";
import * as vercelEntry from "../src/vercel.js";
import * as presetsEntry from "../src/presets.js";
import * as rootEntry from "../src/index.js";
import { NOW, PASSWORD } from "./helpers.js";

const ENV = { VERCEL_ENV: "production", ACCESS_GATE_PASSWORD: PASSWORD };

describe("access-gate/next", () => {
  test("createProxy gates and passes through with NextResponse.next()", async () => {
    const proxy = nextEntry.createProxy({ env: ENV, now: () => NOW });
    const denied = await proxy(new NextRequest("https://app.test/", { headers: { accept: "text/html" } }));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("content-security-policy")).toMatch(/default-src 'none'/);

    const login = await proxy(
      new NextRequest("https://app.test/_access", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://app.test" },
        body: new URLSearchParams({ password: PASSWORD, next: "/dash" }).toString(),
      }),
    );
    expect(login.status).toBe(303);
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const allowed = await proxy(new NextRequest("https://app.test/dash", { headers: { cookie } }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("x-middleware-next")).toBe("1");

    const off = nextEntry.createProxy({ env: { VERCEL_ENV: "development" } });
    expect((await off(new NextRequest("https://app.test/"))).headers.get("x-middleware-next")).toBe("1");
  });

  test("default proxy reads process.env and exports a catch-all matcher", async () => {
    const previous = { ...process.env };
    try {
      process.env.VERCEL_ENV = "production";
      process.env.ACCESS_GATE_PASSWORD = PASSWORD;
      const res = await nextEntry.proxy(new NextRequest("https://app.test/_next/static/x.js"));
      expect(res.status).toBe(401);
      delete process.env.ACCESS_GATE_PASSWORD;
      const pass = await nextEntry.proxy(new NextRequest("https://app.test/_next/static/x.js"));
      expect(pass.headers.get("x-middleware-next")).toBe("1");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    expect(nextEntry.middleware).toBe(nextEntry.proxy);
    expect(nextEntry.config).toEqual({ matcher: ["/:path*"] });
  });
});

describe("access-gate/vercel", () => {
  test("default export gates and passes through with @vercel/functions next()", async () => {
    const proxy = vercelEntry.createProxy({ env: ENV, now: () => NOW });
    const denied = await proxy(new Request("https://site.test/api/data"));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ ok: false, error: "Authentication required." });

    const login = await proxy(
      new Request("https://site.test/_access", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://site.test" },
        body: new URLSearchParams({ password: PASSWORD }).toString(),
      }),
    );
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const allowed = await proxy(new Request("https://site.test/index.html", { headers: { cookie } }));
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    expect(typeof vercelEntry.default).toBe("function");
    expect(vercelEntry.default).toBe(vercelEntry.proxy);
  });
});

describe("other entries", () => {
  test("presets and root entry", () => {
    expect(presetsEntry.paper.background).toBe("#f4f3ec");
    expect(presetsEntry.dark.colorScheme).toBe("dark");
    expect(presetsEntry.presets.paper).toBe(presetsEntry.paper);
    expect(typeof rootEntry.createGate).toBe("function");
    expect(rootEntry.paper).toBe(presetsEntry.paper);
  });
});
