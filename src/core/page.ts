import { base64, sha256 } from "./crypto.js";
import type { GateTexts, GateTheme, PartialTexts, RenderContext } from "./types.js";

/** Preserves `location.hash` in the `next` field so `/#section` survives the login round-trip. */
export const HASH_FRAGMENT_SCRIPT =
  "(()=>{const n=document.getElementById('access-next');if(n&&location.hash&&!n.value.includes('#'))n.value+=location.hash;})();";

let scriptDigest: Promise<string> | undefined;

/** Base64 sha256 of {@link HASH_FRAGMENT_SCRIPT}, for the CSP `script-src` directive. */
export function hashFragmentScriptDigest(): Promise<string> {
  if (!scriptDigest) {
    scriptDigest = sha256(HASH_FRAGMENT_SCRIPT).then(base64);
    scriptDigest.catch(() => {
      scriptDigest = undefined;
    });
  }
  return scriptDigest;
}

export const DEFAULT_TEXTS: GateTexts = {
  title: "Restricted access",
  eyebrow: "Private preview",
  heading: "Restricted access",
  intro: "Enter the password to continue.",
  label: "Password",
  button: "Continue",
  hint: "Use the shared access password.",
  errors: {
    incorrect: "Incorrect password.",
    throttled: "Too many attempts. Please wait and try again.",
    tooLarge: "The request is too large.",
    unsupported: "The request format is not supported.",
    unreadable: "The request could not be read. Please try again.",
    verify: "The request could not be verified. Please try again.",
    unauthenticated: "Authentication required.",
    unavailable: "Access is temporarily unavailable.",
    notConfigured: "The access gate is not configured.",
    loggedOut: "You have been signed out.",
  },
};

export function mergeTexts(base: GateTexts, override: PartialTexts | undefined): GateTexts {
  if (!override) return base;
  const { errors, ...rest } = override;
  const merged: GateTexts = { ...base, ...stripUndefined(rest), errors: { ...base.errors, ...stripUndefined(errors ?? {}) } };
  return merged;
}

export function mergeTheme(base: GateTheme, override: Partial<GateTheme> | undefined): GateTheme {
  if (!override) return base;
  return { ...base, ...stripUndefined(override) };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

export function escapeHTML(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow a conservative subset of CSS characters in theme values. */
function cssValue(value: string): string {
  return String(value ?? "").replace(/[<>{};]/g, "");
}

function langAttribute(value: string): string {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value) ? value : "en";
}

export function renderDefaultPage(ctx: RenderContext): string {
  const { texts, theme } = ctx;
  const t = (value: string) => cssValue(value);
  const message = ctx.error
    ? `<p class="error" id="access-error" role="alert">${escapeHTML(ctx.error)}</p>`
    : `<p class="hint" id="access-hint">${escapeHTML(ctx.notice || texts.hint)}</p>`;
  const describedBy = ctx.error ? "access-error" : "access-hint";
  const eyebrow = texts.eyebrow ? `<p class="eyebrow">${escapeHTML(texts.eyebrow)}</p>` : "";
  const glow = theme.glow ? `body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: ${t(theme.glow)}; }` : "";

  return `<!doctype html>
<html lang="${escapeHTML(langAttribute(ctx.lang))}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="${theme.colorScheme === "light" ? "light" : "dark"}">
  <title>${escapeHTML(texts.title)}</title>
  <style>
    :root { color-scheme: ${theme.colorScheme === "light" ? "light" : "dark"}; font-family: ${t(theme.font)}; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: ${t(theme.text)}; background: ${t(theme.background)}; }
    ${glow}
    main { position: relative; width: min(100%, 430px); padding: clamp(28px, 7vw, 42px); border: 1px solid ${t(theme.border)}; border-radius: ${t(theme.radius)}; background: ${t(theme.panel)}; box-shadow: 0 28px 80px rgba(0, 0, 0, ${theme.colorScheme === "light" ? ".08" : ".42"}); }
    .eyebrow { margin: 0 0 18px; color: ${t(theme.accent)}; font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-family: ${t(theme.headingFont)}; font-size: clamp(30px, 8vw, 42px); font-weight: 600; letter-spacing: -.025em; line-height: 1.02; }
    .intro { margin: 16px 0 28px; color: ${t(theme.muted)}; font-size: 15px; line-height: 1.6; }
    label { display: block; margin-bottom: 9px; font-size: 14px; font-weight: 650; }
    input { width: 100%; min-height: 48px; padding: 0 14px; border: 1px solid ${t(theme.border)}; border-radius: 10px; outline: none; color: inherit; background: ${t(theme.inputBackground)}; font: inherit; transition: border-color .15s, box-shadow .15s; }
    input:focus { border-color: ${t(theme.accent)}; box-shadow: 0 0 0 3px color-mix(in srgb, ${t(theme.accent)} 22%, transparent); }
    button { width: 100%; min-height: 48px; margin-top: 14px; border: 0; border-radius: 10px; color: ${t(theme.accentText)}; background: ${t(theme.accent)}; font: inherit; font-weight: 800; cursor: pointer; transition: filter .15s, transform .15s; }
    button:hover { filter: brightness(1.12); }
    button:active { transform: translateY(1px); }
    .hint, .error { min-height: 20px; margin: 10px 0 0; font-size: 13px; line-height: 1.5; }
    .hint { color: ${t(theme.muted)}; }
    .error { color: ${t(theme.error)}; }
    @media (prefers-reduced-motion: reduce) { input, button { transition: none; } }
  </style>
</head>
<body>
  <main>
    ${eyebrow}
    <h1>${escapeHTML(texts.heading)}</h1>
    <p class="intro">${escapeHTML(texts.intro)}</p>
    <form method="post" action="${escapeHTML(ctx.accessPath)}">
      <input id="access-next" type="hidden" name="next" value="${escapeHTML(ctx.nextPath)}">
      <label for="access-password">${escapeHTML(texts.label)}</label>
      <input id="access-password" name="password" type="password" autocomplete="current-password" required autofocus aria-describedby="${describedBy}">
      <button type="submit">${escapeHTML(texts.button)}</button>
      ${message}
    </form>
  </main>
  <script>${ctx.script}</script>
</body>
</html>`;
}

export function renderUnavailablePage(texts: GateTexts, lang: string): string {
  return `<!doctype html><html lang="${escapeHTML(langAttribute(lang))}"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>${escapeHTML(texts.errors.unavailable)}</title></head><body><h1>${escapeHTML(texts.errors.unavailable)}</h1><p>${escapeHTML(texts.errors.notConfigured)}</p></body></html>`;
}
