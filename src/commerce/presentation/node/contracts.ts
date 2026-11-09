/** ARCH-049-BACKGROUND-001: one untrusted source in, one verified immutable image out. */
export const SHOP_BRAND_CANVAS = Object.freeze({ width: 1125, height: 600 });
export const SHOP_BRAND_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const SHOP_BRAND_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
export const SHOP_BRAND_TARGET_OUTPUT_BYTES = 1024 * 1024;
export const SHOP_BRAND_MAX_INPUT_PIXELS = 40_000_000;

export type ShopBrandImageRole = "LOGO" | "SQUARE_LOGO" | "COVER_IMAGE";
export type ShopBrandImageMime = "image/jpeg" | "image/png";

export type ShopBrandMediaErrorCode =
  | "INVALID_INPUT" | "UNSAFE_SOURCE" | "DNS_FAILURE" | "DNS_TEMPORARY_FAILURE"
  | "SOURCE_TIMEOUT" | "SOURCE_HTTP_FAILURE" | "SOURCE_UNAVAILABLE"
  | "SOURCE_TOO_LARGE" | "UNSUPPORTED_ENCODING" | "INVALID_IMAGE"
  | "INPUT_PIXELS_EXCEEDED" | "OUTPUT_TOO_LARGE" | "OUTPUT_VERIFICATION_FAILED"
  | "R2_CONFIGURATION_INVALID" | "R2_UNAVAILABLE" | "R2_OBJECT_MISMATCH"
  | "PUBLIC_MEDIA_UNAVAILABLE" | "PUBLIC_MEDIA_MISMATCH"
  | "UNEXPECTED_FAILURE";

/** The message is a bounded code, not a provider exception or a URL containing credentials. */
export class ShopBrandMediaError extends Error {
  constructor(readonly code: ShopBrandMediaErrorCode, readonly retryable = false,
    readonly providerMessage?: string) {
    super(code);
    this.name = "ShopBrandMediaError";
  }
}

/** Bounded diagnostic provenance for provider/library failures; never retain a source URL or common secrets. */
export function boundedMediaProviderMessage(error: unknown): string | undefined {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (!raw) return undefined;
  const message = [...raw].map((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("")
    .replace(/\bhttps?:\/\/[^\s,;]+/gi, "[URL REDACTED]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/((?:access.?key(?:.?id)?|secret.?key|session.?token|security.?token|token|password|signature|credential|api.?key)\s*[:=]\s*)[^\s,;&"'<>]+/gi, "$1[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[EMAIL REDACTED]")
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, "[PHONE REDACTED]")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  return message || undefined;
}

export interface VerifiedBrandImage {
  bytes: Buffer;
  contentType: ShopBrandImageMime;
  width: number;
  height: number;
  sizeBytes: number;
  contentSha256: string;
}


export interface FetchedBrandSource {
  bytes: Buffer;
  /** The response's declared type; never trusted for decoding. */
  declaredContentType: string | null;
}

export interface SafeFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<FetchedBrandSource>;
}

export interface ImageTransformer {
  transform(bytes: Buffer, role: ShopBrandImageRole): Promise<VerifiedBrandImage>;
}


export interface PublicMediaProbe {
  verify(input: { url: string; image: VerifiedBrandImage }, signal?: AbortSignal): Promise<void>;
}


/** Host-supplied validated credentials; Shared performs no configuration lookup. */
export type ShopBrandR2Credentials = Readonly<{ endpoint: string; accessKeyId: string; secretAccessKey: string }>;
