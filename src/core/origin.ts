const HOST_PATTERN = /^[A-Za-z0-9.:[\]-]+$/;

/**
 * Public origin of the request as the browser sees it. Honours
 * X-Forwarded-Host / X-Forwarded-Proto so Vercel deployment URLs behind a
 * custom domain still pass the same-origin check.
 */
export function publicOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const host = forwardedHost.split(",", 1)[0]!.trim();
  if (!host || !HOST_PATTERN.test(host)) return requestUrl.origin;

  const forwardedProtocol = (request.headers.get("x-forwarded-proto") || "").split(",", 1)[0]!.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? `${forwardedProtocol}:` : requestUrl.protocol;
  try {
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

export function isSecureRequest(request: Request): boolean {
  return publicOrigin(request).startsWith("https:");
}

/**
 * Same-origin check for the login POST. `Sec-Fetch-Site` decides when
 * present; otherwise the `Origin` header must match the public or internal
 * origin. Requests with neither are rejected.
 */
export function isSameOriginPost(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return true;
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const originHeader = request.headers.get("origin");
  if (originHeader && originHeader !== "null") {
    try {
      const origin = new URL(originHeader).origin;
      return origin === publicOrigin(request) || origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  return false;
}
