import { NextResponse, type NextRequest } from "next/server";
import { createGate } from "./core/gate.js";
import type { Gate, GateOptions } from "./core/types.js";

export type { GateOptions, GateEvent, GateStore, GateTexts, GateTheme, RenderContext } from "./core/types.js";
export { createGate };

/** Signature shared by Next.js `proxy.ts` (Next 16, Node runtime) and `middleware.ts` (Next 13–15, Edge runtime). */
export type NextProxy = (request: NextRequest) => Promise<Response>;

function passThrough(): Response {
  return NextResponse.next();
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
 * // src/proxy.ts (Next 16) — or middleware.ts on Next ≤ 15
 * export { proxy as default } from "@dgodolias/access-gate/next";
 * ```
 */
export const proxy: NextProxy = (request) => {
  defaultGate ??= createGate();
  return defaultGate.handle(request, passThrough);
};

/** Alias for projects that prefer the `middleware` name. */
export const middleware: NextProxy = proxy;

/**
 * Optional matcher covering every path (Next already runs proxy/middleware on
 * all routes when no `config` is exported, which is what the one-line quick
 * start relies on). Re-export it only if you also want to declare it explicitly.
 */
export const config = { matcher: ["/:path*"] };
