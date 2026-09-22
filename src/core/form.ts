export const DEFAULT_MAX_FORM_BYTES = 4096;
export const MAX_PASSWORD_LENGTH = 1024;

export type FormErrorCode = "UNSUPPORTED_MEDIA_TYPE" | "FORM_TOO_LARGE" | "UNREADABLE";

export class FormError extends Error {
  constructor(public readonly code: FormErrorCode) {
    super(code);
    this.name = "FormError";
  }
}

/**
 * Reads an `application/x-www-form-urlencoded` body, enforcing the size cap on
 * the bytes actually streamed (not only on Content-Length).
 */
export async function limitedForm(request: Request, maxBytes: number = DEFAULT_MAX_FORM_BYTES): Promise<URLSearchParams> {
  const contentType = (request.headers.get("content-type") || "").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw new FormError("UNSUPPORTED_MEDIA_TYPE");

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new FormError("FORM_TOO_LARGE");

  if (!request.body) return new URLSearchParams();

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FormError("FORM_TOO_LARGE");
      }
      body += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof FormError) throw error;
    throw new FormError("UNREADABLE");
  }
  body += decoder.decode();
  return new URLSearchParams(body);
}
