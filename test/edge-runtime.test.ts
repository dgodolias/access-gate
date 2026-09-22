/**
 * Runs the BUILT core bundle inside a bare `node:vm` context that exposes only
 * the Web platform globals an Edge runtime provides: no `process`, no
 * `require`, no `Buffer`, no `node:` modules. If the gate ever reaches for a
 * Node-only API, this test fails.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import { NOW, PASSWORD } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, "../dist/core.cjs");

function loadInEdgeSandbox(): typeof import("../src/core.js") {
  const source = readFileSync(bundlePath, "utf8");
  const moduleExports: Record<string, unknown> = {};
  const sandbox: Record<string, unknown> = {
    // Web platform only.
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    ReadableStream,
    btoa,
    atob,
    Promise,
    Map,
    Set,
    Uint8Array,
    Number,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    RegExp,
    Error,
    TypeError,
    console: { log() {}, error() {}, warn() {} },
    // CommonJS wrapper shims (the bundle has no runtime requires).
    module: { exports: moduleExports },
    exports: moduleExports,
    require: (name: string) => {
      throw new Error(`edge sandbox: require("${name}") is not available`);
    },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  expect(context.process).toBeUndefined();
  expect(context.Buffer).toBeUndefined();
  vm.runInContext(source, context, { filename: "core.cjs" });
  const exported = (sandbox.module as { exports: unknown }).exports as typeof import("../src/core.js");
  expect(typeof exported.createGate).toBe("function");
  return exported;
}

describe("edge-like runtime (no node: modules, no process)", () => {
  test("the built bundle exists and has no require() calls", () => {
    const source = readFileSync(bundlePath, "utf8");
    expect(source).not.toMatch(/require\(/);
    expect(source).not.toMatch(/node:/);
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  test("full login flow works with Web Crypto only", async () => {
    const core = loadInEdgeSandbox();
    const gate = core.createGate({ env: { VERCEL_ENV: "production", ACCESS_GATE_PASSWORD: PASSWORD }, now: () => NOW });
    const next = () => new Response("continued", { headers: { "x-test-next": "1" } });

    const page = await gate.handle(new Request("https://edge.test/", { headers: { accept: "text/html" } }), next);
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('action="/_access"');

    const body = new URLSearchParams({ password: PASSWORD, next: "/hello" }).toString();
    const login = await gate.handle(
      new Request("https://edge.test/_access", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://edge.test" },
        body,
      }),
      next,
    );
    expect(login.status).toBe(303);
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    expect(cookie).toMatch(/^__Host-access_gate_session=v1\./);

    const authed = await gate.handle(new Request("https://edge.test/hello", { headers: { cookie } }), next);
    expect(authed.headers.get("x-test-next")).toBe("1");

    // Tokens minted in the sandbox verify with the Node build and vice versa.
    const nodeCore = await import("../src/core.js");
    const token = cookie.split("=")[1]!;
    expect(await nodeCore.verifySessionToken(token, [PASSWORD], nodeCore.DEFAULT_TTL_SECONDS, NOW)).toBe(true);
    const nodeToken = await nodeCore.createSessionToken(PASSWORD, nodeCore.DEFAULT_TTL_SECONDS, NOW);
    expect(await core.verifySessionToken(nodeToken, [PASSWORD], core.DEFAULT_TTL_SECONDS, NOW)).toBe(true);
  });

  test("without process the gate reads only the env option and defaults to off", async () => {
    const core = loadInEdgeSandbox();
    const gate = core.createGate();
    const res = await gate.handle(new Request("https://edge.test/"), () => new Response("ok"));
    expect(await res.text()).toBe("ok");
    expect(gate.describe({}).active).toBe(false);
  });
});
