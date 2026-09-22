import type { AttemptRecord, GateStore } from "./types.js";

export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 1000;

interface Entry {
  value: AttemptRecord;
  expiresAt: number;
}

/**
 * In-memory attempt store. Per process instance, so on serverless platforms a
 * cold start or a different instance resets the counter. Good enough as a
 * default; swap in a shared store for multi-instance correctness.
 */
export class MemoryStore implements GateStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get(key: string): AttemptRecord | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: AttemptRecord, ttlMs: number): void {
    const nowMs = this.now();
    this.entries.set(key, { value, expiresAt: nowMs + Math.max(0, ttlMs) });
    if (this.entries.size > MAX_ENTRIES) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.expiresAt <= nowMs || this.entries.size > MAX_ENTRIES) this.entries.delete(entryKey);
      }
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

export function clientKey(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return String(forwarded).split(",", 1)[0]!.trim().slice(0, 128) || "unknown";
}

export interface ActiveAttempt extends AttemptRecord {
  key: string;
}

export async function activeAttempt(store: GateStore, key: string, nowMs: number, windowMs: number): Promise<ActiveAttempt> {
  const current = await store.get(key);
  if (!current) return { key, count: 0, resetAt: nowMs + windowMs };
  if (current.resetAt <= nowMs) {
    await store.delete(key);
    return { key, count: 0, resetAt: nowMs + windowMs };
  }
  return { key, count: current.count, resetAt: current.resetAt };
}

export async function recordFailedAttempt(store: GateStore, key: string, nowMs: number, windowMs: number): Promise<ActiveAttempt> {
  const attempt = await activeAttempt(store, key, nowMs, windowMs);
  const updated: AttemptRecord = { count: attempt.count + 1, resetAt: attempt.resetAt };
  await store.set(key, updated, Math.max(1, attempt.resetAt - nowMs));
  return { key, ...updated };
}

export function retryAfterSeconds(attempt: AttemptRecord, nowMs: number): number {
  return Math.max(1, Math.ceil((attempt.resetAt - nowMs) / 1000));
}
