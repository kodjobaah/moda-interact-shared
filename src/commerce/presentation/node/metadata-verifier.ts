import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  SHOP_BRAND_CANVAS, SHOP_BRAND_MAX_OUTPUT_BYTES, ShopBrandMediaError,
  type ShopBrandImageMime, type VerifiedBrandImage,
} from "./contracts.js";

/** Independently re-decode the final *encoded* bytes; neither extensions nor encoder claims suffice. */
export async function verifyEncodedBrandImage(
  bytes: Buffer, contentType: ShopBrandImageMime,
  dimensions: Readonly<{width: number; height: number}> = SHOP_BRAND_CANVAS,
): Promise<VerifiedBrandImage> {
  if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) ||
      dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width * dimensions.height > 40_000_000 || !bytes.length || bytes.length >= SHOP_BRAND_MAX_OUTPUT_BYTES ||
      (contentType !== "image/jpeg" && contentType !== "image/png")) {
    throw new ShopBrandMediaError("OUTPUT_TOO_LARGE");
  }
  try {
    const actual = await sharp(bytes, { limitInputPixels: dimensions.width * dimensions.height + 1,
      failOn: "error", animated: false }).metadata();
    const format = contentType === "image/jpeg" ? "jpeg" : "png";
    if (actual.format !== format || actual.width !== dimensions.width ||
        actual.height !== dimensions.height || (actual.pages ?? 1) !== 1 ||
        actual.exif || actual.xmp || actual.iptc || actual.icc || actual.orientation && actual.orientation !== 1) {
      throw new ShopBrandMediaError("OUTPUT_VERIFICATION_FAILED");
    }
    return {
      bytes, contentType, width: actual.width, height: actual.height,
      sizeBytes: bytes.length,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    throw new ShopBrandMediaError("OUTPUT_VERIFICATION_FAILED");
  }
}
