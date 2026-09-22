import { describe, expect, test } from "vitest";
import { createGate, createSessionToken, DEFAULT_TTL_SECONDS, MemoryStore } from "../src/core.js";
import type { GateEvent, GateStore, AttemptRecord } from "../src/core.js";
import { HTTP_ORIGIN, NOW, ORIGIN, PASSWORD, PROD_ENV, cookieOf, gateWith, invoke, loginRequest, navigate, nextResponse, request } from "./helpers.js";

const COOKIE = "__Host-access_gate_session";

describe("environments", () => {
  test("only local development bypasses the password gate", async () => {
    for (const value of [undefined, "development"]) {
      const res = await invoke(navigate("/data.json"), { VERCEL_ENV: value, ACCESS_GATE_PASSWORD: PASSWORD });
      expect(res.headers.get("x-test-next")).toBe("1");
    }
    const preview = await invoke(navigate("/data.json"), { VERCEL_ENV: "preview", ACCESS_GATE_PASSWORD: PASSWORD });
    expect(preview.status).toBe(401);
    expect(preview.headers.get("content-type")).toMatch(/text\/html/);
  });

  test("NODE_ENV=production gates non-Vercel hosts, next dev does not", async () => {
    const prod = await invoke(navigate("/"), { NODE_ENV: "production", ACCESS_GATE_PASSWORD: PASSWORD });
    expect(prod.status).toBe(401);
    const dev = await invoke(navigate("/"), { NODE_ENV: "development", ACCESS_GATE_PASSWORD: PASSWORD });
    expect(dev.headers.get("x-test-next")).toBe("1");
  });

  test("environments option, ACCESS_GATE_ENVIRONMENTS and always override the default", async () => {
    const custom = await invoke(navigate("/"), { VERCEL_ENV: "development", ACCESS_GATE_PASSWORD: PASSWORD }, NOW, undefined, { environments: ["development"] });
    expect(custom.status).toBe(401);
    const envList = await invoke(navigate("/"), { VERCEL_ENV: "preview", ACCESS_GATE_PASSWORD: PASSWORD, ACCESS_GATE_ENVIRONMENTS: "production" });
    expect(envList.headers.get("x-test-next")).toBe("1");
    const always = await invoke(navigate("/"), { ACCESS_GATE_PASSWORD: PASSWORD, ACCESS_GATE_ALWAYS: "1" });
    expect(always.status).toBe(401);
    const alwaysOption = await invoke(navigate("/"), { ACCESS_GATE_PASSWORD: PASSWORD }, NOW, undefined, { always: true });
    expect(alwaysOption.status).toBe(401);
  });

  test("unset or empty password turns the gate off with zero effect", async () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "production", ACCESS_GATE_PASSWORD: "" }]) {
      const res = await invoke(navigate("/"), env);
      expect(res.headers.get("x-test-next")).toBe("1");
      const api = await invoke(request("/api/x"), env);
      expect(api.headers.get("x-test-next")).toBe("1");
    }
  });

  test("fail-closed: production + ACCESS_GATE_REQUIRED=1 responds 503 when the password is missing", async () => {
    const env = { VERCEL_ENV: "production", ACCESS_GATE_REQUIRED: "1" };
    const page = await invoke(navigate("/"), env);
    expect(page.status).toBe(503);
    expect(await page.text()).toMatch(/not configured/i);
    expect(page.headers.get("cache-control")).toMatch(/no-store/);

    const api = await invoke(request("/api/ask"), env);
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ ok: false, error: "Access is temporarily unavailable." });

    // Preview is not affected by ACCESS_GATE_REQUIRED.
    const preview = await invoke(navigate("/"), { VERCEL_ENV: "preview", ACCESS_GATE_REQUIRED: "1" });
    expect(preview.headers.get("x-test-next")).toBe("1");

    // The explicit option applies everywhere the gate is active.
    const option = await invoke(navigate("/"), { VERCEL_ENV: "preview" }, NOW, undefined, { failClosed: true });
    expect(option.status).toBe(503);
    const off = await invoke(navigate("/"), { VERCEL_ENV: "production", ACCESS_GATE_REQUIRED: "1" }, NOW, undefined, { failClosed: false });
    expect(off.headers.get("x-test-next")).toBe("1");
  });
});

describe("unauthenticated requests", () => {
  test("navigations get the login page inline with 401 while APIs return JSON 401", async () => {
    const page = await invoke(navigate("/?view=chat"));
    expect(page.status).toBe(401);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toMatch(/no-store/);
    const html = await page.text();
    expect(html).toContain('name="next" value="/?view=chat"');
    expect(html).toContain('<form method="post" action="/_access">');

    const api = await invoke(request("/api/ask"));
    expect(api.status).toBe(401);
    expect(api.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await api.json()).toEqual({ ok: false, error: "Authentication required." });
  });

  test("everything is gated by default: _next/static, images, favicon, robots, sitemap", async () => {
    for (const path of ["/_next/static/chunks/main.js", "/_next/image?url=%2Fa.png", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/fonts/inter.woff2"]) {
      const res = await invoke(request(path));
      expect(res.status, path).toBe(401);
      expect(res.headers.get("x-test-next")).toBeNull();
    }
  });

  test("API-like detection: Accept without html or a non-navigate Sec-Fetch-Mode tightens to JSON; missing headers stay HTML", async () => {
    const json = await invoke(request("/data", { headers: { accept: "application/json" } }));
    expect(json.headers.get("content-type")).toMatch(/json/);
    const cors = await invoke(request("/data", { headers: { accept: "*/*", "sec-fetch-mode": "cors" } }));
    expect(cors.headers.get("content-type")).toMatch(/json/);
    const inApp = await invoke(request("/data", { headers: { accept: "text/html" } }));
    expect(inApp.headers.get("content-type")).toMatch(/html/);
    const curl = await invoke(request("/", { headers: { accept: "*/*" } }));
    expect(curl.headers.get("content-type")).toMatch(/html/);
    const bare = await invoke(request("/"));
    expect(bare.headers.get("content-type")).toMatch(/html/);
    const custom = await invoke(navigate("/graphql"), PROD_ENV, NOW, undefined, { isApi: (url) => url.pathname === "/graphql" });
    expect(custom.headers.get("content-type")).toMatch(/json/);
    const prefixes = await invoke(navigate("/rpc/x"), { ...PROD_ENV, ACCESS_GATE_API_PATHS: "/rpc,/trpc" });
    expect(prefixes.headers.get("content-type")).toMatch(/json/);
  });

  test("HEAD is handled like GET without a body", async () => {
    const res = await invoke(request("/", { method: "HEAD", headers: { accept: "text/html" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/html/);
    expect(await res.text()).toBe("");
    const page = await invoke(request("/_access", { method: "HEAD" }));
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("");
  });

  test("gate responses carry the full hardening header set", async () => {
    const res = await invoke(navigate("/"));
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-[A-Za-z0-9+/=]+'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'$/);
  });
});

describe("exemptions", () => {
  test("exempt option accepts strings, globs, RegExps and functions; env list works too", async () => {
    const options = { exempt: ["/api/health", "/api/cron/*", /^\/status\/\d+$/, (url: URL) => url.searchParams.has("probe")] };
    for (const path of ["/api/health", "/api/cron/daily", "/status/200", "/anything?probe=1"]) {
      const res = await invoke(request(path), PROD_ENV, NOW, undefined, options);
      expect(res.headers.get("x-test-next"), path).toBe("1");
    }
    for (const path of ["/api/healthz", "/api/cron/a/b", "/api/cron", "/status/abc", "/api/hello", "/"]) {
      const res = await invoke(request(path), PROD_ENV, NOW, undefined, options);
      expect(res.status, path).toBe(401);
    }

    const env = { ...PROD_ENV, ACCESS_GATE_EXEMPT: "/api/health, /api/cron/*" };
    expect((await invoke(request("/api/health"), env)).headers.get("x-test-next")).toBe("1");
    expect((await invoke(request("/api/cron/daily"), env)).headers.get("x-test-next")).toBe("1");
    expect((await invoke(request("/api/hello"), env)).status).toBe(401);
    expect((await invoke(navigate("/"), env)).status).toBe(401);
  });

  test("** matches across segments", async () => {
    const options = { exempt: ["/public/**"] };
    expect((await invoke(request("/public/a/b/c.png"), PROD_ENV, NOW, undefined, options)).headers.get("x-test-next")).toBe("1");
    expect((await invoke(request("/publicx"), PROD_ENV, NOW, undefined, options)).status).toBe(401);
  });

  test("allowPublicAssets lets the login page reference a logo", async () => {
    const options = { allowPublicAssets: ["/logo.svg"] };
    expect((await invoke(request("/logo.svg"), PROD_ENV, NOW, undefined, options)).headers.get("x-test-next")).toBe("1");
    expect((await invoke(request("/logo2.svg"), PROD_ENV, NOW, undefined, options)).status).toBe(401);
    const env = { ...PROD_ENV, ACCESS_GATE_PUBLIC_ASSETS: "/brand/*.png" };
    expect((await invoke(request("/brand/logo.png"), env)).headers.get("x-test-next")).toBe("1");
  });
});

describe("login page", () => {
  test("is usable without JavaScript, has no external requests and carries strict headers", async () => {
    const res = await invoke(request("/_access?next=%2F%23chat"));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/<form method="post" action="\/_access">/);
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/autocomplete="current-password"/);
    expect(html).toMatch(/location\.hash/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link /);
    expect(html).not.toMatch(/<img /);
    expect(html).toContain('name="next" value="/#chat"');
    expect(res.headers.get("content-security-policy")).toMatch(/form-action 'self'/);
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'sha256-/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("the CSP hash matches the inline script", async () => {
    const res = await invoke(request("/_access"));
    const html = await res.text();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script))).toString("base64");
    expect(res.headers.get("content-security-policy")).toContain(`'sha256-${digest}'`);
  });

  test("OPTIONS and other methods on the access path get 405 with Allow", async () => {
    for (const method of ["OPTIONS", "PUT", "DELETE", "PATCH"]) {
      const res = await invoke(request("/_access", { method }));
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD, POST");
    }
  });

  test("an authenticated GET of the access path redirects to next", async () => {
    const token = await createSessionToken(PASSWORD, DEFAULT_TTL_SECONDS, NOW);
    const res = await invoke(request("/_access?next=%2Fdashboard", { headers: { cookie: `${COOKIE}=${token}` } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  test("texts, lang, preset and theme are configurable; renderPage is an escape hatch", async () => {
    const options = {
      preset: "paper" as const,
      lang: "el",
      texts: { eyebrow: "socioeconomicslab", heading: "Περιορισμένη πρόσβαση", button: "Συνέχεια", errors: { incorrect: "Λάθος κωδικός." } },
      theme: { accent: "#123456" },
    };
    const res = await invoke(request("/_access"), PROD_ENV, NOW, undefined, options);
    const html = await res.text();
    expect(html).toContain('<html lang="el">');
    expect(html).toContain("socioeconomicslab");
    expect(html).toContain("Περιορισμένη πρόσβαση");
    expect(html).toContain("Συνέχεια");
    expect(html).toContain("#f4f3ec");
    expect(html).toContain("#123456");
    expect(html).toContain('content="light"');

    const wrong = await invoke(loginRequest("nope"), PROD_ENV, NOW, undefined, options);
    expect(await wrong.text()).toContain("Λάθος κωδικός.");

    const custom = await invoke(request("/_access?next=%2Fx"), PROD_ENV, NOW, undefined, {
      renderPage: (ctx) => `<!doctype html><form action="${ctx.escapeHTML(ctx.accessPath)}" method="post"><input name="next" value="${ctx.escapeHTML(ctx.nextPath)}"><input name="password"></form>`,
    });
    const customHtml = await custom.text();
    expect(customHtml).toBe('<!doctype html><form action="/_access" method="post"><input name="next" value="/x"><input name="password"></form>');
  });

  test("escapes user-controlled values", async () => {
    const res = await invoke(request("/_access?next=%2F%3Fq%3D%22%3E%3Cscript%3E"));
    const html = await res.text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('value="/?q=%22%3E%3Cscript%3E"');
  });

  test("dark and paper presets render distinct backgrounds", async () => {
    const dark = await (await invoke(request("/_access"))).text();
    const paper = await (await invoke(request("/_access"), { ...PROD_ENV, ACCESS_GATE_PRESET: "paper" })).text();
    expect(dark).toContain("#090a0c");
    expect(paper).toContain("#f4f3ec");
    expect(paper).toContain("#3f4a2e");
  });
});

describe("login POST", () => {
  test("wrong password and cross-origin attempts are rejected, and the password is never echoed", async () => {
    const unique = "zq9-wrong-attempt-marker-7731";
    const events: GateEvent[] = [];
    const wrong = await invoke(loginRequest(unique), PROD_ENV, NOW, undefined, { onEvent: (event) => events.push(event) });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const html = await wrong.text();
    expect(html).toMatch(/Incorrect password/);
    expect(html).not.toContain(unique);
    expect(JSON.stringify(events)).not.toContain(unique);
    expect(events.map((event) => event.type)).toEqual(["failed"]);

    const crossOrigin = await invoke(loginRequest(PASSWORD, "/", "https://evil.test"));
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("set-cookie")).toBeNull();

    const noOrigin = await invoke(loginRequest(PASSWORD, "/", "", "1.1.1.1"));
    expect(noOrigin.status).toBe(403);
  });

  test("accepts Vercel forwarded public origin and same-origin browser metadata", async () => {
    const body = new URLSearchParams({ password: PASSWORD, next: "/" }).toString();
    const forwarded = new Request("https://internal-deployment.vercel.app/_access", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        host: "gate.test",
        origin: ORIGIN,
        "x-forwarded-host": "gate.test",
        "x-forwarded-proto": "https",
      },
      body,
    });
    const forwardedResponse = await invoke(forwarded);
    expect(forwardedResponse.status).toBe(303);
    expect(forwardedResponse.headers.get("location")).toBe(`${ORIGIN}/`);

    const metadataOnly = request("/_access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "null", "sec-fetch-site": "same-origin" },
      body,
    });
    expect((await invoke(metadataOnly)).status).toBe(303);

    const crossSite = request("/_access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "sec-fetch-site": "cross-site" },
      body,
    });
    expect((await invoke(crossSite)).status).toBe(403);
  });

  test("correct password issues a secure __Host- session on HTTPS and permits subsequent requests", async () => {
    const events: GateEvent[] = [];
    const login = await invoke(loginRequest(PASSWORD, "/?view=chat"), PROD_ENV, NOW, undefined, { onEvent: (event) => events.push(event) });
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe(`${ORIGIN}/?view=chat`);
    expect(events.map((event) => event.type)).toEqual(["login"]);
    expect(JSON.stringify(events)).not.toContain(PASSWORD);

    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toMatch(new RegExp(`^${COOKIE}=v1\\.\\d+\\.[A-Za-z0-9_-]+; `));
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(new RegExp(`Max-Age=${DEFAULT_TTL_SECONDS}`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);

    const cookie = cookieOf(login);
    const api = await invoke(request("/api/ask", { headers: { cookie } }));
    expect(api.headers.get("x-test-next")).toBe("1");
    const page = await invoke(navigate("/", { cookie }));
    expect(page.headers.get("x-test-next")).toBe("1");
    const asset = await invoke(request("/_next/static/x.js", { headers: { cookie } }));
    expect(asset.headers.get("x-test-next")).toBe("1");
  });

  test("plain HTTP (local dev) falls back to an unprefixed cookie without Secure", async () => {
    const login = await invoke(loginRequest(PASSWORD, "/", HTTP_ORIGIN, "127.0.0.1", {}, HTTP_ORIGIN));
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe(`${HTTP_ORIGIN}/`);
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^access_gate_session=/);
    expect(setCookie).not.toMatch(/Secure/);
    expect(setCookie).toMatch(/HttpOnly/);
    const cookie = cookieOf(login);
    const page = await invoke(navigate("/", { cookie }, HTTP_ORIGIN));
    expect(page.headers.get("x-test-next")).toBe("1");
  });

  test("cookie name is configurable via option and env", async () => {
    const option = await invoke(loginRequest(PASSWORD), PROD_ENV, NOW, undefined, { cookieName: "my_gate" });
    expect(option.headers.get("set-cookie")).toMatch(/^__Host-my_gate=/);
    const env = await invoke(loginRequest(PASSWORD), { ...PROD_ENV, ACCESS_GATE_COOKIE: "env_gate" });
    expect(env.headers.get("set-cookie")).toMatch(/^__Host-env_gate=/);
    expect(() => createGate({ cookieName: "__Host-x" })).toThrow(/prefix/);
    expect(() => createGate({ cookieName: "bad name" })).toThrow(/invalid cookie name/);
  });

  test("form next takes precedence over the query and both are validated", async () => {
    const res = await invoke(loginRequest(PASSWORD, "/from-form"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/from-form`);
    const noNext = request("/_access?next=%2Ffrom-query", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
    });
    expect((await invoke(noNext)).headers.get("location")).toBe(`${ORIGIN}/from-query`);
  });

  test("return paths cannot redirect outside the origin or back to the access path", async () => {
    for (const unsafe of ["https://evil.test/", "//evil.test/", "/\\evil.test/", "\r\nLocation: https://evil.test", "/_access", "/_access?next=/x", "/\tx"]) {
      const res = await invoke(loginRequest(PASSWORD, unsafe));
      expect(res.headers.get("location"), unsafe).toBe(`${ORIGIN}/`);
    }
  });

  test("bodies are capped by streamed bytes, wrong encodings are 415 and empty/oversized passwords fail", async () => {
    const oversized = request("/_access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "x-forwarded-for": "oversized-test" },
      body: `password=${"x".repeat(5000)}`,
    });
    expect((await invoke(oversized)).status).toBe(413);

    const declared = request("/_access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "99999", origin: ORIGIN },
      body: "password=x",
    });
    expect((await invoke(declared)).status).toBe(413);

    const json = request("/_access", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const jsonResponse = await invoke(json);
    expect(jsonResponse.status).toBe(415);
    expect(jsonResponse.headers.get("set-cookie")).toBeNull();

    const multipart = request("/_access", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", origin: ORIGIN },
      body: "--x--",
    });
    expect((await invoke(multipart)).status).toBe(415);

    const longPassword = await invoke(loginRequest("p".repeat(1025)));
    expect(longPassword.status).toBe(401);
    const empty = await invoke(loginRequest(""));
    expect(empty.status).toBe(401);

    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error("boom"));
      },
    });
    const unreadable = request("/_access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: broken,
      // @ts-expect-error Node fetch requires duplex for stream bodies.
      duplex: "half",
    });
    expect((await invoke(unreadable)).status).toBe(400);
  });

  test("failures are throttled per client with Retry-After and unlock after the window", async () => {
    const store = new MemoryStore(() => NOW);
    const events: GateEvent[] = [];
    const options = { onEvent: (event: GateEvent) => events.push(event) };
    let response!: Response;
    for (let index = 0; index < 8; index += 1) {
      response = await invoke(loginRequest("wrong", "/", ORIGIN, "throttle-test"), PROD_ENV, NOW, store, options);
    }
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(events.filter((event) => event.type === "failed")).toHaveLength(7);
    expect(events.filter((event) => event.type === "throttled")).toHaveLength(1);
    expect(events[0]!.ip).toBe("throttle-test");

    const locked = await invoke(loginRequest(PASSWORD, "/", ORIGIN, "throttle-test"), PROD_ENV, NOW, store, options);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("set-cookie")).toBeNull();

    const other = await invoke(loginRequest(PASSWORD, "/", ORIGIN, "other-client"), PROD_ENV, NOW, store, options);
    expect(other.status).toBe(303);

    const unlocked = await invoke(loginRequest(PASSWORD, "/", ORIGIN, "throttle-test"), PROD_ENV, NOW + 10 * 60 * 1000, store, options);
    expect(unlocked.status).toBe(303);
    expect(unlocked.headers.get("set-cookie")).toMatch(new RegExp(`^${COOKIE}=`));
  });

  test("a pluggable async store is honoured", async () => {
    const backing = new Map<string, AttemptRecord>();
    const calls: string[] = [];
    const store: GateStore = {
      async get(key) {
        calls.push(`get:${key}`);
        return backing.get(key);
      },
      async set(key, value) {
        calls.push(`set:${key}:${value.count}`);
        backing.set(key, value);
      },
      async delete(key) {
        calls.push(`delete:${key}`);
        backing.delete(key);
      },
    };
    await invoke(loginRequest("wrong", "/", ORIGIN, "async-client"), PROD_ENV, NOW, store);
    await invoke(loginRequest("wrong", "/", ORIGIN, "async-client"), PROD_ENV, NOW, store);
    expect(backing.get("async-client")?.count).toBe(2);
    const ok = await invoke(loginRequest(PASSWORD, "/", ORIGIN, "async-client"), PROD_ENV, NOW, store);
    expect(ok.status).toBe(303);
    expect(backing.has("async-client")).toBe(false);
    expect(calls).toContain("delete:async-client");
  });

  test("maxAttempts and windowMs are configurable", async () => {
    const store = new MemoryStore(() => NOW);
    const options = { maxAttempts: 2, windowMs: 60_000 };
    await invoke(loginRequest("wrong", "/", ORIGIN, "small"), PROD_ENV, NOW, store, options);
    const second = await invoke(loginRequest("wrong", "/", ORIGIN, "small"), PROD_ENV, NOW, store, options);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
  });
});

describe("sessions", () => {
  test("expired and tampered session cookies are rejected", async () => {
    const token = await createSessionToken(PASSWORD, DEFAULT_TTL_SECONDS, NOW);
    const expired = await invoke(request("/api/ask", { headers: { cookie: `${COOKIE}=${token}` } }), PROD_ENV, NOW + (DEFAULT_TTL_SECONDS + 1) * 1000);
    expect(expired.status).toBe(401);

    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const tampered = await invoke(navigate("/", { cookie: `${COOKIE}=${tamperedToken}` }));
    expect(tampered.status).toBe(401);

    const [version, exp, sig] = token.split(".");
    const future = await invoke(navigate("/", { cookie: `${COOKIE}=${version}.${Number(exp) + 3600}.${sig}` }));
    expect(future.status).toBe(401);
  });

  test("changing the password invalidates existing cookies; ACCESS_GATE_PREVIOUS_PASSWORD keeps them valid", async () => {
    const login = await invoke(loginRequest(PASSWORD));
    const cookie = cookieOf(login);

    const rotated = { VERCEL_ENV: "production", ACCESS_GATE_PASSWORD: "test-only-rotated-password" };
    expect((await invoke(navigate("/", { cookie }), rotated)).status).toBe(401);

    const overlap = { ...rotated, ACCESS_GATE_PREVIOUS_PASSWORD: PASSWORD };
    expect((await invoke(navigate("/", { cookie }), overlap)).headers.get("x-test-next")).toBe("1");

    // Only the current password logs in during the overlap.
    expect((await invoke(loginRequest(PASSWORD), overlap)).status).toBe(401);
    const fresh = await invoke(loginRequest("test-only-rotated-password"), overlap);
    expect(fresh.status).toBe(303);

    // New sessions are signed by the current password, so they die with it.
    const freshCookie = cookieOf(fresh);
    expect((await invoke(navigate("/", { cookie: freshCookie }), PROD_ENV)).status).toBe(401);
  });

  test("ACCESS_GATE_SECRET signs independently of the password", async () => {
    const withSecret = { ...PROD_ENV, ACCESS_GATE_SECRET: "test-only-signing-secret" };
    const cookie = cookieOf(await invoke(loginRequest(PASSWORD), withSecret));
    const changed = { VERCEL_ENV: "production", ACCESS_GATE_PASSWORD: "test-only-other", ACCESS_GATE_SECRET: "test-only-signing-secret" };
    expect((await invoke(navigate("/", { cookie }), changed)).headers.get("x-test-next")).toBe("1");
    // A cookie signed by the password alone is not accepted when a secret is configured.
    const passwordSigned = await createSessionToken(PASSWORD, DEFAULT_TTL_SECONDS, NOW);
    expect((await invoke(navigate("/", { cookie: `${COOKIE}=${passwordSigned}` }), withSecret)).status).toBe(401);
  });

  test("TTL is configurable and capped at 30 days", async () => {
    const short = await invoke(loginRequest(PASSWORD), { ...PROD_ENV, ACCESS_GATE_TTL: "600" });
    expect(short.headers.get("set-cookie")).toMatch(/Max-Age=600;/);
    const huge = await invoke(loginRequest(PASSWORD), PROD_ENV, NOW, undefined, { ttlSeconds: 10 ** 9 });
    expect(huge.headers.get("set-cookie")).toMatch(/Max-Age=2592000;/);
    const bogus = await invoke(loginRequest(PASSWORD), { ...PROD_ENV, ACCESS_GATE_TTL: "nope" });
    expect(bogus.headers.get("set-cookie")).toMatch(new RegExp(`Max-Age=${DEFAULT_TTL_SECONDS};`));
    // A short-TTL cookie is rejected by a gate with the same TTL once it lapses.
    const cookie = cookieOf(short);
    expect((await invoke(navigate("/", { cookie }), { ...PROD_ENV, ACCESS_GATE_TTL: "600" }, NOW + 601_000)).status).toBe(401);
  });

  test("logout clears the cookie and shows the page", async () => {
    const cookie = cookieOf(await invoke(loginRequest(PASSWORD)));
    const res = await invoke(request("/_access?logout=1", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure$`));
    expect(await res.text()).toContain("signed out");
    const http = await invoke(request("/_access?logout=1", {}, HTTP_ORIGIN));
    expect(http.headers.get("set-cookie")).toBe("access_gate_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});

describe("observability and configuration", () => {
  test("onEvent reports denied and bypassed without ever seeing the password", async () => {
    const events: GateEvent[] = [];
    const options = { exempt: ["/api/health"], onEvent: (event: GateEvent) => events.push(event) };
    await invoke(navigate("/secret", { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }), PROD_ENV, NOW, undefined, options);
    await invoke(request("/api/health"), PROD_ENV, NOW, undefined, options);
    expect(events).toEqual([
      { type: "denied", ip: "9.9.9.9", path: "/secret", at: NOW },
      { type: "bypassed", ip: "unknown", path: "/api/health", at: NOW },
    ]);
    // A throwing hook never breaks the gate.
    const res = await invoke(navigate("/"), PROD_ENV, NOW, undefined, {
      onEvent: () => {
        throw new Error("boom");
      },
    });
    expect(res.status).toBe(401);
  });

  test("explicit option beats env var beats default", async () => {
    const env = { ...PROD_ENV, ACCESS_GATE_PATH: "/env-login" };
    const fromEnv = await invoke(navigate("/"), env);
    expect(await fromEnv.text()).toContain('action="/env-login"');
    const fromOption = await invoke(navigate("/"), env, NOW, undefined, { accessPath: "/opt-login" });
    expect(await fromOption.text()).toContain('action="/opt-login"');
    expect((await invoke(request("/opt-login"), env, NOW, undefined, { accessPath: "/opt-login" })).status).toBe(200);
    expect(() => createGate({ accessPath: "login" })).toThrow(/accessPath/);
    expect(() => createGate({ accessPath: "/x?y" })).toThrow(/accessPath/);

    const explicitPassword = await invoke(loginRequest("test-only-option-password"), PROD_ENV, NOW, undefined, { password: "test-only-option-password" });
    expect(explicitPassword.status).toBe(303);
  });

  test("describe() never leaks the password", () => {
    const gate = gateWith({}, { ...PROD_ENV, ACCESS_GATE_PRESET: "paper", ACCESS_GATE_LANG: "el" });
    const description = gate.describe();
    expect(description).toEqual({
      environment: "production",
      active: true,
      configured: true,
      failClosed: false,
      accessPath: "/_access",
      cookieName: "access_gate_session",
      ttlSeconds: DEFAULT_TTL_SECONDS,
      apiPaths: ["/api"],
      preset: "paper",
      lang: "el",
    });
    expect(JSON.stringify(description)).not.toContain(PASSWORD);
  });

  test("next() may return a plain Response or a Promise", async () => {
    const gate = gateWith({}, { VERCEL_ENV: "development" });
    expect((await gate.handle(request("/"), () => nextResponse())).headers.get("x-test-next")).toBe("1");
    expect((await gate.handle(request("/"), async () => nextResponse())).headers.get("x-test-next")).toBe("1");
  });
});
