import { createGate } from "./core/gate.js";
import type { Gate, GateOptions } from "./core/types.js";

export type { GateOptions, GateEvent, GateStore, GateTexts, GateTheme, RenderContext } from "./core/types.js";
export { createGate };

/**
 * Signature shared by Next.js `proxy.ts` (Next 16, Node runtime) and
 * `middleware.ts` (Next 13–15, Edge runtime). `NextRequest` extends `Request`,
 * so this type is assignable wherever Next expects a proxy/middleware.
 */
export type NextProxy = (request: Request) => Promise<Response>;

/**
 * Equivalent of `NextResponse.next()`: an empty response carrying the
 * `x-middleware-next: 1` header that tells Next (and Vercel's routing layer)
 * to continue to the app. Built by hand so this entry has no runtime import of
 * `next/server` and the same bundle works on every Next version and runtime.
 */
function passThrough(): Response {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

/** Builds a proxy/middleware function with explicit options (explicit option > env var > default). */
export function createProxy(options: GateOptions = {}): NextProxy {
  const gate = createGate(options);
  return (request) => gate.handle(request, passThrough);
}

let defaultGate: Gate | undefined;

/**
 * Zero-config proxy. Reads everything from environment variables.
 *
 * ```ts
 * // src/proxy.ts (Next 16, Node runtime)
 * export { proxy } from "@dgodolias/access-gate/next";
 * // src/middleware.ts (Next 13–15, Edge runtime)
 * export { middleware } from "@dgodolias/access-gate/next";
 * ```
 *
 * Next validates the file statically and only accepts a `default` declaration
 * or a named `proxy`/`middleware` export, so use the named re-export form.
 */
export const proxy: NextProxy = (request) => {
  defaultGate ??= createGate();
  return defaultGate.handle(request, passThrough);
};

/** Alias for projects that prefer the `middleware` name. */
export const middleware: NextProxy = proxy;

/**
 * Optional matcher covering every path. Next already runs proxy/middleware on
 * all routes when no `config` is exported, which is what the one-line quick
 * start relies on. Copy it into your file only if you want it explicit (Next
 * reads `config` statically, so a re-export is not picked up).
 */
export const config = { matcher: ["/:path*"] };
