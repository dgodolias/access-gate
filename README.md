# access-gate

Plug-and-play shared-password gate for web apps. One environment variable puts
a login page in front of the **entire** app (pages, API routes, `/_next/static`,
images, fonts, `robots.txt`, everything) until the visitor types the password.
Unset the variable and the library does nothing.

Zero runtime dependencies. Web Crypto only, so the same code runs on the Node
runtime and the Edge runtime.

## Quick start (Next.js)

```bash
npm i github:dgodolias/access-gate
```

```ts
// src/proxy.ts (Next 16) — or src/middleware.ts on Next 13–15 (see below)
export { proxy } from "@dgodolias/access-gate/next";
```

```bash
ACCESS_GATE_PASSWORD=whatever   # set → gate on. Unset or empty → gate off, zero overhead.
```

That is all. No config file, no provider, no layout change, no page to create.
The login page is served straight from the proxy with inline CSS, so nothing of
your app loads until the password is right.

> The package is not on npm yet, hence the GitHub install line. The package name
> is `@dgodolias/access-gate` because the bare `access-gate` name was already
> taken on npm.

## Per framework

### Next.js 16 (`proxy.ts`, Node runtime)

```ts
// src/proxy.ts   (or proxy.ts at the project root if you do not use src/)
export { proxy } from "@dgodolias/access-gate/next";
```

Next validates this file statically and only accepts an `export default`
declaration or a named `proxy` export, so keep the named re-export form. Do
not export a `config`: without one Next runs the proxy on every path, which is
exactly what you want (the gate must intercept static assets too).

With explicit options:

```ts
// src/proxy.ts
import { createProxy } from "@dgodolias/access-gate/next";

export const proxy = createProxy({
  preset: "paper",
  lang: "el",
  texts: { eyebrow: "my-lab", heading: "Περιορισμένη πρόσβαση", button: "Συνέχεια" },
  exempt: ["/api/health", "/api/cron/*"],
});
```

### Next.js 13–15 (`middleware.ts`, Edge runtime)

```ts
// src/middleware.ts
export { middleware } from "@dgodolias/access-gate/next";
```

Same bundle, same options (`createProxy` works here too, export the result as
`middleware`). Everything the gate needs (`crypto.subtle`, `Request`,
`Response`, `TextEncoder`) exists on the Edge runtime.

### Plain Vercel project (static site + functions)

```ts
// proxy.ts
export { default } from "@dgodolias/access-gate/vercel";
```

```json
// vercel.json
{ "proxy": { "entrypoint": "proxy.ts" } }
```

This entry uses `next()` from `@vercel/functions`, which is an optional peer
dependency: `npm i @vercel/functions`. `createProxy(options)` is available here
as well.

### Anything else (`Request`/`Response` runtimes)

```ts
import { createGate } from "@dgodolias/access-gate/core";

const gate = createGate({ always: true });

export default {
  async fetch(request: Request) {
    return gate.handle(request, () => app(request));
  },
};
```

`handle(request, next)` returns a gate response (login page, 401 JSON, 303,
429, …) or whatever `next()` returns when the request may proceed. `next` may
return a `Response` or a `Promise<Response>`. The framework entries are thin
wrappers over this.

## Options

Every option is optional. Precedence: **explicit option > environment
variable > default**. Environment variables are read from `process.env` (or the
`env` option) on every request.

| Option | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `password` | `ACCESS_GATE_PASSWORD` | – | The shared password. Unset/empty → gate off. |
| `previousPassword` | `ACCESS_GATE_PREVIOUS_PASSWORD` | – | Sessions signed by this older password stay valid during a rotation. Only the current password logs in. |
| `secret` | `ACCESS_GATE_SECRET` | – | Sign sessions with an independent secret instead of the password. Changing the password then does **not** log everyone out. |
| `environments` | `ACCESS_GATE_ENVIRONMENTS` | `production,preview` | Environments in which the gate is active. The environment is `VERCEL_ENV`, falling back to `production` when `NODE_ENV=production` and `development` otherwise. So `next dev` is open, `next start` and Vercel production/preview are gated. |
| `enabled` | `ACCESS_GATE_ENABLED` | `true` | Master switch. `false`/`0`/`off`/`no` turns the gate off everywhere, even with a password set (handy to open the site without deleting the secret). |
| `always` | `ACCESS_GATE_ALWAYS=1` | `false` | Gate regardless of environment (non-Vercel hosts, custom servers). |
| `failClosed` | `ACCESS_GATE_REQUIRED=1` | `false` | Respond 503 "not configured" instead of passing through when the gate is active but no password is set. The env var only applies in `production`; the option applies wherever the gate is active. |
| `accessPath` | `ACCESS_GATE_PATH` | `/_access` | Login route (GET renders, POST verifies, `?logout=1` signs out). |
| `cookieName` | `ACCESS_GATE_COOKIE` | `access_gate_session` | Base cookie name. On HTTPS it becomes `__Host-<name>`; on plain HTTP (local dev) the plain name is used. |
| `ttlSeconds` | `ACCESS_GATE_TTL` | `28800` (8 h) | Session lifetime, capped at 30 days. |
| `exempt` | `ACCESS_GATE_EXEMPT` | `[]` | Paths that pass through untouched: strings, globs (`*` = one segment, `**` = any depth), `RegExp`, or `(url, request) => boolean`. Env form is comma-separated: `/api/health,/api/cron/*`. |
| `allowPublicAssets` | `ACCESS_GATE_PUBLIC_ASSETS` | `[]` | Static files the login page itself may reference (e.g. `/logo.svg`) when you use a custom `renderPage`. Same matching rules as `exempt`. |
| `apiPaths` | `ACCESS_GATE_API_PATHS` | `/api` | Path prefixes that always get a JSON 401 instead of the HTML login page. |
| `isApi` | – | see below | Full override of the "is this an API/fetch call?" rule. |
| `preset` | `ACCESS_GATE_PRESET` | `dark` | Built-in look: `dark` or `paper`. |
| `theme` | – | preset | Partial override of the preset's colours/typography (`background`, `panel`, `text`, `muted`, `border`, `accent`, `accentText`, `error`, `inputBackground`, `radius`, `font`, `headingFont`, `glow`, `colorScheme`). |
| `texts` | – | English | Partial override of all strings: `title`, `eyebrow`, `heading`, `intro`, `label`, `button`, `hint`, `errors.{incorrect,throttled,tooLarge,unsupported,unreadable,verify,unauthenticated,unavailable,notConfigured,loggedOut}`. |
| `lang` | `ACCESS_GATE_LANG` | `en` | `lang` attribute of the login page. |
| `renderPage` | – | built-in | `(ctx) => string` escape hatch that renders the whole page. Must POST `password` (and `next`) to `ctx.accessPath`. |
| `store` | – | in-memory | Failed-attempt counter storage: `{ get(key), set(key, value, ttlMs), delete(key) }`, sync or async. |
| `maxAttempts` | – | `8` | Failed attempts per client key per window before 429. |
| `windowMs` | – | `600000` (10 min) | Throttle window. |
| `maxFormBytes` | – | `4096` | Maximum login body size, enforced on streamed bytes. |
| `onEvent` | – | – | `(event) => void` with `{ type: "login" \| "failed" \| "throttled" \| "denied" \| "bypassed", ip, path, at }`. Never receives the password. |
| `env` | – | `process.env` | Environment source (tests, non-Node hosts). |
| `now` | – | `Date.now` | Clock override for tests. |

**API-like detection (default `isApi`).** A request gets the JSON 401 instead
of the HTML page when any of these holds: the path is under an `apiPaths`
prefix; the `Accept` header is present and contains neither `text/html` nor
`*/*`; or `Sec-Fetch-Mode` is present and is not `navigate`. Missing headers
never tighten the rule, so `curl` and in-app browsers (Instagram, Facebook)
get the HTML page and JavaScript is not required to log in.

## How it works

1. **Environment check.** If the gate is not active for the current
   environment, or no password is configured (and `failClosed` is off),
   `next()` is returned immediately. Zero overhead.
2. **Login route.** `GET/HEAD <accessPath>` renders the page (or 303s to
   `next` when the visitor already has a valid session). `POST` verifies the
   same-origin check, the throttle, the body encoding and size, then the
   password (constant-time). Success sets the cookie and 303s to a validated
   `next` path; failure re-renders with the error and 401; too many failures
   give 429 with `Retry-After`. Other methods get 405 with `Allow`.
3. **Exemptions.** Paths matching `exempt`/`allowPublicAssets` pass through
   untouched (`bypassed` event).
4. **Session check.** The cookie holds an HMAC-SHA256 signed token
   `v1.<expiresAt>.<signature>` keyed by the password (or `secret`). Expired,
   future-dated beyond a 60 s skew, malformed or tampered tokens are rejected.
5. **Deny.** Without a valid session the response is the login page (401,
   `next` = current path) or `{"ok":false,"error":"Authentication required."}`
   (401) for API-like requests.

Every response the gate itself returns carries:
`Cache-Control: private, no-store, max-age=0`, `X-Robots-Tag: noindex, nofollow`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-…'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`.
The only script on the page is a tiny inline snippet that keeps `location.hash`
in the `next` field; its hash is the one in the CSP. No fonts, images or
requests to anywhere.

## Security properties

- Constant-time password and signature comparison (digests of equal length).
- Signed, expiring, versioned session; clock-skew tolerance; tampered/expired rejected.
- Same-origin check on the login POST: `Sec-Fetch-Site` when present, else
  `Origin`, honouring `X-Forwarded-Host`/`X-Forwarded-Proto` for Vercel
  deployment URLs behind a custom domain.
- `next` path validated: relative only, no `//`, no backslashes, no control
  characters, never the access path itself, length-capped.
- Login body: `application/x-www-form-urlencoded` only (415 otherwise), capped
  by streamed bytes (413), password length cap 1024, 405 with `Allow` for other
  methods, `OPTIONS` → 405.
- Per-client throttling (8 failures / 10 min by default) with `Retry-After`.
- The submitted password is never echoed in HTML, logs, events or errors.
- `__Host-` cookie prefix on HTTPS (`Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`).
- Everything gated by default, including `/_next/static`, `/_next/image`,
  `favicon.ico`, `robots.txt` and sitemaps.
- No runtime dependencies.

## Threat model and known limits

- **Shared password ≠ per-user auth.** Everyone who knows the password is the
  same anonymous visitor. There is no user identity, no audit trail per person,
  no revocation short of rotating the password. Use it to keep a preview or an
  internal tool out of public view, not to protect data with real access rules.
- **In-memory throttle on serverless.** The default attempt store lives in the
  process. On Vercel/Lambda-style hosts each instance (and each cold start) has
  its own counter, so a determined attacker gets more than 8 tries per 10 min
  across instances. Plug a shared `store` (Upstash Redis, Neon, …) when that
  matters. The password itself is compared in constant time, and the login
  body is tiny, so the cost of brute force is dominated by your password length.
- **Session key derived from the password.** Convenient (rotation logs
  everyone out), but it means the session HMAC is only as strong as the
  password. Set `ACCESS_GATE_SECRET` to a long random value if you want the
  session key independent of the password.
- **Cookies are bearer tokens.** Anyone holding the cookie is in until it
  expires (8 h by default). There is no server-side session list; logout only
  clears the visitor's own cookie.
- **Compared with Vercel Deployment Protection.** Vercel's built-in password
  protection is enforced at the platform edge before your code runs and cannot
  be misconfigured from inside the app, but it is a paid add-on on Hobby/Pro,
  applies per project, and has a fixed look. `access-gate` is free, runs
  anywhere `Request`/`Response` exist, is fully brandable, and can exempt
  paths (health checks, cron routes, webhooks). If you can use Deployment
  Protection and do not need those, prefer it.
- **`fail closed` is opt-in.** By default a missing password means "gate off"
  so a fresh clone works. In production set `ACCESS_GATE_REQUIRED=1` (or
  `failClosed: true`) so a lost variable yields 503 rather than an open site.

## Rotate the password

Without a logout storm:

1. Set `ACCESS_GATE_PREVIOUS_PASSWORD` to the current value and
   `ACCESS_GATE_PASSWORD` to the new one. Deploy.
   Existing sessions keep working; only the new password is accepted on the
   login form.
2. After one session lifetime (8 h by default, see `ttlSeconds`) remove
   `ACCESS_GATE_PREVIOUS_PASSWORD`. Deploy. Old sessions are now invalid.

Immediate logout of everyone: change `ACCESS_GATE_PASSWORD` without setting the
previous one. If you use `ACCESS_GATE_SECRET`, rotate that instead.

On Vercel:

```bash
vercel env add ACCESS_GATE_PREVIOUS_PASSWORD production   # paste the old value
vercel env rm  ACCESS_GATE_PASSWORD production
vercel env add ACCESS_GATE_PASSWORD production            # paste the new value
```

## Customising the page

```ts
import { createProxy } from "@dgodolias/access-gate/next";
import { paper } from "@dgodolias/access-gate/presets";

export const proxy = createProxy({
  theme: { ...paper, accent: "#0b5fff" },
  texts: { eyebrow: "Acme", heading: "Staging", intro: "Ask the team for the password." },
  lang: "en",
});
```

Presets: `dark` (deep grey panel, blue accent, serif heading) and `paper`
(background `#f4f3ec`, panel `#ffffff`, ink `#3a3c33`, accent `#3f4a2e`, system
sans-serif). Theme values are dropped into inline CSS; keep them to plain CSS
values.

Full control:

```ts
createProxy({
  renderPage: (ctx) => `<!doctype html><html lang="${ctx.lang}"><body>
    <form method="post" action="${ctx.escapeHTML(ctx.accessPath)}">
      <input type="hidden" name="next" value="${ctx.escapeHTML(ctx.nextPath)}">
      <input name="password" type="password" autocomplete="current-password" required>
      <button>${ctx.escapeHTML(ctx.texts.button)}</button>
      ${ctx.error ? `<p role="alert">${ctx.escapeHTML(ctx.error)}</p>` : ""}
    </form>
    <script>${ctx.script}</script>
  </body></html>`,
});
```

The CSP still applies: inline styles are allowed, the only allowed script is
`ctx.script`, and any image or font must be same-origin **and** listed in
`allowPublicAssets`.

## Observability and shared throttle store

```ts
createProxy({
  onEvent: (event) => console.log(JSON.stringify(event)),
  store: {
    get: (key) => redis.get(`gate:${key}`),
    set: (key, value, ttlMs) => redis.set(`gate:${key}`, value, { px: ttlMs }),
    delete: (key) => redis.del(`gate:${key}`),
  },
});
```

Events: `login`, `failed`, `throttled`, `denied` (request rejected for lack of a
session), `bypassed` (exempt path). `ip` is the first hop of
`X-Vercel-Forwarded-For`/`X-Forwarded-For`/`X-Real-IP` or `unknown`.

## Examples and tests

```bash
npm ci
npm test              # build + unit tests (Node 20/22) incl. an Edge-like sandbox run
npm run smoke:next16  # builds examples/next16, starts it, drives the whole flow over HTTP
npm run smoke:next15
npm run smoke:vercel
```

- `examples/next16` – App Router, `src/proxy.ts`.
- `examples/next15-middleware` – App Router, `src/middleware.ts` (Edge runtime).
- `examples/vercel-static` – `public/` + `api/` + `proxy.ts` + `vercel.json`,
  with a tiny local runner (`vercel dev` is the full-fidelity way).

Each smoke run starts the example with the gate on and checks 401 HTML on `/`,
401 on `/_next/static/…`, 401 JSON on `/api/hello`, exempt `/api/health` and
`/api/cron/*`, 8 failures → 429 with `Retry-After`, correct POST → 303 + cookie,
200 afterwards, logout, 405/415/403 edge cases; then restarts it with the gate
off and checks the app is untouched.

## License

MIT © Dimosthenis Gkontolias
