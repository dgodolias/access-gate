# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-22

### Added

- Core gate (`@dgodolias/access-gate/core`): `createGate(options).handle(request, next)`.
- Next.js entry (`/next`): one-line `proxy.ts` (Next 16, Node runtime) or `middleware.ts` (Next 13–15, Edge runtime).
- Vercel entry (`/vercel`): default `proxy(request)` built on `@vercel/functions`' `next()`.
- Presets entry (`/presets`): `dark` and `paper` themes.
- HMAC-SHA256 signed, expiring, versioned session cookie (`__Host-` on HTTPS), Web Crypto only.
- Password rotation with `ACCESS_GATE_PREVIOUS_PASSWORD`; optional independent `ACCESS_GATE_SECRET`.
- In-memory per-client throttling with pluggable `store`.
- Exempt paths (strings, globs, RegExps, functions, env list), `allowPublicAssets`.
- Environment gating (`VERCEL_ENV`, `NODE_ENV` fallback, `ACCESS_GATE_ENVIRONMENTS`, `ACCESS_GATE_ALWAYS`) and a master switch (`enabled`, `ACCESS_GATE_ENABLED=false`).
- Fail-closed mode (`failClosed`, `ACCESS_GATE_REQUIRED=1` in production).
- `onEvent` observability hook, `?logout=1`, configurable texts/theme/lang, custom `renderPage`.
- Test suite (unit, fuzz, Edge-like sandbox) and example smoke tests.
