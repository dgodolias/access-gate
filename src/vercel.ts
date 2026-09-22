import { next } from "@vercel/functions";
import { createGate } from "./core/gate.js";
import type { Gate, GateOptions } from "./core/types.js";

export type { GateOptions, GateEvent, GateStore, GateTexts, GateTheme, RenderContext } from "./core/types.js";
export { createGate };

/** Signature of a Vercel routing proxy (`"proxy": { "entrypoint": "proxy.ts" }` in vercel.json). */
export type VercelProxy = (request: Request) => Promise<Response>;

function passThrough(): Response {
  return next();
}

/** Builds a proxy with explicit options (explicit option > env var > default). */
export function createProxy(options: GateOptions = {}): VercelProxy {
  const gate = createGate(options);
  return (request) => gate.handle(request, passThrough);
}

let defaultGate: Gate | undefined;

/**
 * Zero-config proxy for plain Vercel projects (static site + functions).
 *
 * ```ts
 * // proxy.ts
 * export { default } from "@dgodolias/access-gate/vercel";
 * ```
 */
export const proxy: VercelProxy = (request) => {
  defaultGate ??= createGate();
  return defaultGate.handle(request, passThrough);
};

export default proxy;
