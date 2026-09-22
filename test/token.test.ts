import { describe, expect, test } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { CLOCK_SKEW_SECONDS, DEFAULT_TTL_SECONDS, clampTtl, constantTimeEqual, createSessionToken, hmacSha256, sha256, verifySessionToken } from "../src/core.js";
import { NOW, PASSWORD } from "./helpers.js";

describe("web crypto primitives", () => {
  test("sha256 and hmac match node:crypto", async () => {
    const digest = Buffer.from(await sha256("hello")).toString("hex");
    expect(digest).toBe(createHash("sha256").update("hello").digest("hex"));
    const mac = Buffer.from(await hmacSha256("key", "payload")).toString("hex");
    expect(mac).toBe(createHmac("sha256", "key").update("payload").digest("hex"));
  });

  test("constantTimeEqual compares digests of equal length", async () => {
    expect(await constantTimeEqual("a", "a")).toBe(true);
    expect(await constantTimeEqual("a", "b")).toBe(false);
    expect(await constantTimeEqual("a", "aa")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
    expect(await constantTimeEqual("ünïcödé", "ünïcödé")).toBe(true);
  });
});

describe("session tokens", () => {
  test("round-trip and structure", async () => {
    const token = await createSessionToken(PASSWORD, DEFAULT_TTL_SECONDS, NOW);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(token.split(".")[1]).toBe(String(Math.floor(NOW / 1000) + DEFAULT_TTL_SECONDS));
    expect(await verifySessionToken(token, [PASSWORD], DEFAULT_TTL_SECONDS, NOW)).toBe(true);
    expect(await verifySessionToken(token, [PASSWORD], DEFAULT_TTL_SECONDS, NOW + (DEFAULT_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(await verifySessionToken(token, [PASSWORD], DEFAULT_TTL_SECONDS, NOW + DEFAULT_TTL_SECONDS * 1000)).toBe(false);
  });

  test("clock skew: slightly future-dated tokens pass, far-future ones fail", async () => {
    const token = await createSessionToken(PASSWORD, DEFAULT_TTL_SECONDS, NOW);
    expect(await verifySessionToken(token, [PASSWORD], DEFAULT_TTL_SECONDS, NOW - (CLOCK_SKEW_SECONDS - 1) * 1000)).toBe(true);
    expect(await verifySessionToken(token, [PASSWORD], DEFAULT_TTL_SECONDS, NOW - (CLOCK_SKEW_SECONDS + 2) * 1000)).toBe(false);
  });

  test("malformed, tampered, wrong-version and wrong-key tokens are rejected", async () => {
    const token = await createSessionToken(PASSWORD, DEFAULT_TTL_SECONDS, NOW);
    const [, exp, sig] = token.split(".");
    const bad = [
      "",
      null,
      undefined,
      "v1",
      "v1.",
      `v1.${exp}`,
      `v2.${exp}.${sig}`,
      `v1.${exp}.${sig}x`,
      `v1.${exp}.${sig!.slice(0, -1)}`,
      `v1.${exp}.${sig!.slice(0, -1)}${sig!.endsWith("A") ? "B" : "A"}`,
      `v1.${exp}x.${sig}`,
      `v1.-${exp}.${sig}`,
      `v1.${exp}.${"A".repeat(43)}`,
      `v1.${exp}.${sig}.${sig}`,
      `v1.${"9".repeat(16)}.${sig}`,
      ` ${token}`,
      `${token}\n`,
      token.toUpperCase(),
    ];
    for (const candidate of bad) {
      expect(await verifySessionToken(candidate, [PASSWORD], DEFAULT_TTL_SECONDS, NOW), String(candidate)).toBe(false);
    }
    expect(await verifySessionToken(token, ["other"], DEFAULT_TTL_SECONDS, NOW)).toBe(false);
    expect(await verifySessionToken(token, [], DEFAULT_TTL_SECONDS, NOW)).toBe(false);
    expect(await verifySessionToken(token, [""], DEFAULT_TTL_SECONDS, NOW)).toBe(false);
    expect(await verifySessionToken(token, ["other", PASSWORD], DEFAULT_TTL_SECONDS, NOW)).toBe(true);
  });

  test("a token minted with a longer TTL than the verifier allows is rejected", async () => {
    const token = await createSessionToken(PASSWORD, 3600, NOW);
    expect(await verifySessionToken(token, [PASSWORD], 600, NOW)).toBe(false);
  });

  test("clampTtl", () => {
    expect(clampTtl(undefined)).toBe(DEFAULT_TTL_SECONDS);
    expect(clampTtl("")).toBe(DEFAULT_TTL_SECONDS);
    expect(clampTtl("abc")).toBe(DEFAULT_TTL_SECONDS);
    expect(clampTtl(-5)).toBe(DEFAULT_TTL_SECONDS);
    expect(clampTtl("60")).toBe(60);
    expect(clampTtl(61.9)).toBe(61);
    expect(clampTtl(10 ** 12)).toBe(30 * 24 * 3600);
  });
});
