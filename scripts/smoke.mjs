#!/usr/bin/env node
/**
 * End-to-end smoke test for an example app.
 *
 *   node scripts/smoke.mjs next16 | next15-middleware | vercel-static
 *
 * Builds the example (Next only), starts it on a local port with the gate ON
 * and checks the full flow over real HTTP (401 HTML on /, 401 JSON on /api/x,
 * exempt paths open, 8 failures → 429, correct POST → 303 + cookie, 200
 * afterwards, logout). Then restarts it with the gate OFF and checks the app
 * behaves as if the library were not installed. Cross-platform (Windows, macOS, Linux).
 *
 * Requests use node:http (like curl) rather than fetch, because Node's fetch
 * always sends `sec-fetch-mode: cors`, which the gate rightly treats as an API
 * call rather than a browser navigation.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const example = process.argv[2] ?? "next16";
const dir = join(root, "examples", example);
const isNext = example !== "vercel-static";
const PORT = { next16: 3911, "next15-middleware": 3912, "vercel-static": 3913 }[example];
if (!PORT || !existsSync(dir)) {
  console.error(`Unknown example "${example}". Use next16, next15-middleware or vercel-static.`);
  process.exit(2);
}
const BASE = `http://localhost:${PORT}`;
// Obviously fake, smoke-only value. Never a real password.
const PASSWORD = "smoke-only-password-not-real";
const DIST_DIR = ".next-smoke";
const win = process.platform === "win32";
const npm = win ? "npm.cmd" : "npm";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    // npm.cmd needs a shell on Windows; node.exe (a full path that may contain spaces) must not get one.
    const child = spawn(command, args, { stdio: "inherit", cwd: dir, shell: win && command === npm, ...options });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
    child.on("error", reject);
  });
}

async function ensureBuilt() {
  if (!existsSync(join(root, "dist", "next.js")) || !existsSync(join(root, "dist", "vercel.js"))) {
    console.log("> building library");
    await run(npm, ["run", "build"], { cwd: root });
  }
  if (!existsSync(join(dir, "node_modules"))) {
    console.log(`> installing ${example} dependencies`);
    await run(npm, ["install", "--no-audit", "--no-fund"]);
  }
  if (isNext) {
    console.log(`> building ${example}`);
    await run(process.execPath, [join(dir, "node_modules", "next", "dist", "bin", "next"), "build"], {
      env: { ...process.env, NEXT_DIST_DIR: DIST_DIR, NEXT_TELEMETRY_DISABLED: "1" },
    });
  }
}

function start(env) {
  const base = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PORT: String(PORT), NEXT_DIST_DIR: DIST_DIR };
  for (const key of Object.keys(base)) if (key.startsWith("ACCESS_GATE_") || key === "VERCEL_ENV") delete base[key];
  const args = isNext ? [join(dir, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)] : [join(dir, "serve.mjs")];
  const child = spawn(process.execPath, args, { cwd: dir, env: { ...base, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`  [app] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`  [app] ${chunk}`));
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolvePromise) => {
    child.once("exit", resolvePromise);
    if (win) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
    setTimeout(resolvePromise, 5000).unref();
  });
  await waitFor(async () => !(await alive()), 15000);
}

async function alive() {
  try {
    await call("GET", "/");
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

async function waitReady() {
  if (!(await waitFor(alive, 60000))) throw new Error(`server on ${BASE} did not become ready`);
}

/** curl-like request: no implicit headers beyond what we pass. */
function call(method, path, { headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(
      `${BASE}${path}`,
      { method, headers: body === undefined ? headers : { "content-length": String(Buffer.byteLength(body)), ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            setCookie: res.headers["set-cookie"]?.[0] ?? "",
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const navigate = (path, headers = {}) => call("GET", path, { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...headers } });
const api = (path, headers = {}) => call("GET", path, { headers: { accept: "application/json", ...headers } });
const login = (fields, headers = {}) =>
  call("POST", "/_access", {
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
// Next.js turns same-origin absolute Location headers into relative ones; accept both.
const locationIs = (res, path) => res.headers.location === path || res.headers.location === `${BASE}${path}`;

async function gateOnScenario() {
  const home = await navigate("/");
  check("GET / is 401 HTML", home.status === 401 && /text\/html/.test(home.headers["content-type"] ?? ""), `status ${home.status} type ${home.headers["content-type"]}`);
  check("login page has the form and no external requests", home.body.includes('action="/_access"') && !/https?:\/\//.test(home.body));
  check("login page carries the strict CSP", /^default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-/.test(home.headers["content-security-policy"] ?? ""));
  check("no-store + noindex headers", home.headers["cache-control"] === "private, no-store, max-age=0" && home.headers["x-robots-tag"] === "noindex, nofollow");
  const curl = await call("GET", "/", { headers: { accept: "*/*" } });
  check("curl-style GET / (Accept: */*) is 401 HTML", curl.status === 401 && /text\/html/.test(curl.headers["content-type"] ?? ""), `status ${curl.status} type ${curl.headers["content-type"]}`);

  const assetPath = isNext ? "/_next/static/anything.js" : "/index.html";
  const asset = await call("GET", assetPath, { headers: { accept: "*/*" } });
  check(`${assetPath} is gated`, asset.status === 401, `status ${asset.status}`);

  const hello = await api("/api/hello");
  const helloBody = json(hello.body);
  check("GET /api/hello is 401 JSON", hello.status === 401 && helloBody?.ok === false && helloBody?.error === "Authentication required.", `status ${hello.status} body ${hello.body.slice(0, 80)}`);
  const fetchLike = await call("GET", "/", { headers: { accept: "*/*", "sec-fetch-mode": "cors" } });
  check("fetch-style GET / (Sec-Fetch-Mode: cors) is 401 JSON", fetchLike.status === 401 && /json/.test(fetchLike.headers["content-type"] ?? ""), `type ${fetchLike.headers["content-type"]}`);

  const health = await api("/api/health");
  const cron = await api("/api/cron/tick");
  check("exempt /api/health passes", health.status === 200, `status ${health.status}`);
  check("exempt /api/cron/tick passes", cron.status === 200, `status ${cron.status}`);
  const notExempt = await api("/api/cron");
  check("/api/cron itself is still gated", notExempt.status === 401, `status ${notExempt.status}`);

  const wrong = await login({ password: "wrong", next: "/" }, { "x-forwarded-for": "smoke-client-a" });
  check("wrong POST is 401 without a cookie", wrong.status === 401 && !wrong.setCookie, `status ${wrong.status}`);
  check("wrong POST never echoes the submitted value", !wrong.body.includes("wrong"));
  let last;
  for (let index = 0; index < 7; index += 1) last = await login({ password: "wrong", next: "/" }, { "x-forwarded-for": "smoke-client-a" });
  check("8th failure is 429 with Retry-After", last.status === 429 && Number(last.headers["retry-after"]) > 0, `status ${last.status}`);
  const lockedOut = await login({ password: PASSWORD, next: "/" }, { "x-forwarded-for": "smoke-client-a" });
  check("correct password is still 429 while locked", lockedOut.status === 429, `status ${lockedOut.status}`);

  const ok = await login({ password: PASSWORD, next: "/?welcome=1#top" }, { "x-forwarded-for": "smoke-client-b" });
  check("correct POST is 303 to next", ok.status === 303 && locationIs(ok, "/?welcome=1#top"), `status ${ok.status} location ${ok.headers.location}`);
  check(
    "plain-HTTP cookie: unprefixed, HttpOnly, SameSite=Lax, no Secure",
    /^access_gate_session=v1\./.test(ok.setCookie) && /HttpOnly/.test(ok.setCookie) && /SameSite=Lax/.test(ok.setCookie) && !/Secure/.test(ok.setCookie),
    ok.setCookie,
  );
  const cookie = ok.setCookie.split(";", 1)[0];

  const authedHome = await navigate("/", { cookie });
  check("GET / with cookie is 200 and renders the app", authedHome.status === 200 && authedHome.body.includes("You are in"), `status ${authedHome.status}`);
  const authedApi = await api("/api/hello", { cookie });
  check("GET /api/hello with cookie is 200", authedApi.status === 200, `status ${authedApi.status}`);
  if (isNext) {
    const authedAsset = await call("GET", "/robots.txt", { headers: { cookie, accept: "*/*" } });
    check("static asset with cookie is served", authedAsset.status === 200, `status ${authedAsset.status}`);
  }
  const accessWhileAuthed = await navigate("/_access?next=%2Fapi%2Fhello", { cookie });
  check("GET /_access while authenticated redirects to next", accessWhileAuthed.status === 303 && locationIs(accessWhileAuthed, "/api/hello"), `status ${accessWhileAuthed.status} location ${accessWhileAuthed.headers.location}`);

  const tampered = await navigate("/", { cookie: `${cookie.slice(0, -1)}${cookie.endsWith("a") ? "b" : "a"}` });
  check("tampered cookie is 401", tampered.status === 401, `status ${tampered.status}`);

  const logout = await navigate("/_access?logout=1", { cookie });
  check("logout clears the cookie", logout.status === 200 && /^access_gate_session=; .*Max-Age=0/.test(logout.setCookie), logout.setCookie);

  const options = await call("OPTIONS", "/_access");
  check("OPTIONS /_access is 405 with Allow", options.status === 405 && options.headers.allow === "GET, HEAD, POST", `status ${options.status}`);
  const head = await call("HEAD", "/_access");
  check("HEAD /_access is 200 without a body", head.status === 200 && head.body === "", `status ${head.status}`);
  const jsonLogin = await call("POST", "/_access", { headers: { "content-type": "application/json", origin: BASE }, body: "{}" });
  check("JSON login body is 415", jsonLogin.status === 415, `status ${jsonLogin.status}`);
  const crossOrigin = await login({ password: PASSWORD, next: "/" }, { origin: "https://evil.test", "x-forwarded-for": "smoke-client-c" });
  check("cross-origin POST is 403", crossOrigin.status === 403, `status ${crossOrigin.status}`);
  const openRedirect = await login({ password: PASSWORD, next: "https://evil.test/" }, { "x-forwarded-for": "smoke-client-d" });
  check("external next is collapsed to /", openRedirect.status === 303 && locationIs(openRedirect, "/"), `location ${openRedirect.headers.location}`);
}

async function gateOffScenario() {
  const home = await navigate("/");
  check("gate off: GET / is 200 and renders the app", home.status === 200 && home.body.includes("You are in"), `status ${home.status}`);
  const hello = await api("/api/hello");
  check("gate off: GET /api/hello is 200", hello.status === 200, `status ${hello.status}`);
  const access = await navigate("/_access");
  check("gate off: /_access does not exist", access.status === 404, `status ${access.status}`);
}

let child;
try {
  await ensureBuilt();

  console.log(`\n> ${example}: gate ON (${BASE})`);
  child = start({ ACCESS_GATE_PASSWORD: PASSWORD, ACCESS_GATE_EXEMPT: "/api/health,/api/cron/*", ...(isNext ? {} : { ACCESS_GATE_ALWAYS: "1" }) });
  await waitReady();
  await gateOnScenario();
  await stop(child);

  console.log(`\n> ${example}: gate OFF (${BASE})`);
  child = start({});
  await waitReady();
  await gateOffScenario();
  await stop(child);
} catch (error) {
  console.error(error);
  results.push({ name: "runner", ok: false });
} finally {
  await stop(child);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed for ${example}`);
process.exit(failed.length ? 1 : 0);
