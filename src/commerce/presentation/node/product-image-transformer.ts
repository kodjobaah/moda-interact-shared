import sharp from "sharp";
import {
  SHOP_BRAND_MAX_INPUT_PIXELS,
  SHOP_BRAND_MAX_OUTPUT_BYTES,
  ShopBrandMediaError,
  boundedMediaProviderMessage,
  type VerifiedBrandImage,
} from "./contracts.js";
import { assertSelfContainedSvg } from "./image-transformer.js";
import { verifyEncodedBrandImage } from "./metadata-verifier.js";

const WIDTH = 1125;
const HEIGHT = 600;
const QUALITY_STEPS = [86, 76, 66, 56, 46] as const;
const SUPPORTED_SOURCES = new Set(["jpeg", "png", "webp", "avif", "heif", "gif", "svg", "tiff"]);

export type OutreachProductImageTransformer = Readonly<{
  transform(bytes: Buffer, signal?: AbortSignal): Promise<VerifiedBrandImage>;
}>;

/** Standard product preset: preserve the complete product, pad white, and emit only metadata-free JPEG. */
export function createOutreachProductImageTransformer(): OutreachProductImageTransformer {
  return {
    async transform(bytes, signal) {
      if (signal?.aborted) throw new ShopBrandMediaError("SOURCE_TIMEOUT", true);
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ShopBrandMediaError("INVALID_IMAGE");
      try {
        if (bytes.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart().startsWith("<")) {
          assertSelfContainedSvg(bytes);
        }
        const source = sharp(bytes, {
          limitInputPixels: false,
          failOn: "error",
          animated: false,
          pages: 1,
        });
        const cancelSource = () => { source.destroy(); };
        signal?.addEventListener("abort", cancelSource, { once: true });
        let info: Awaited<ReturnType<typeof source.metadata>>;
        try { info = await source.metadata(); } finally { signal?.removeEventListener("abort", cancelSource); }
        if (signal?.aborted) throw new ShopBrandMediaError("SOURCE_TIMEOUT", true);
        if (!info.format || !SUPPORTED_SOURCES.has(info.format) || !info.width || !info.height) {
          throw new ShopBrandMediaError("INVALID_IMAGE");
        }
        if (info.width * info.height > SHOP_BRAND_MAX_INPUT_PIXELS) {
          throw new ShopBrandMediaError("INPUT_PIXELS_EXCEEDED");
        }
        if (info.format === "svg") assertSelfContainedSvg(bytes);

        let output: Buffer | undefined;
        for (const quality of QUALITY_STEPS) {
          if (signal?.aborted) throw new ShopBrandMediaError("SOURCE_TIMEOUT", true);
          const encoder = sharp(bytes, {
            limitInputPixels: SHOP_BRAND_MAX_INPUT_PIXELS,
            failOn: "error",
            animated: false,
            pages: 1,
          })
            .rotate()
            .toColourspace("srgb")
            .resize(WIDTH, HEIGHT, {
              fit: "contain",
              position: "centre",
              background: { r: 255, g: 255, b: 255, alpha: 1 },
              withoutEnlargement: false,
            })
            .flatten({ background: "#ffffff" })
            .removeAlpha()
            .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" });
          const cancelEncoder = () => { encoder.destroy(); };
          signal?.addEventListener("abort", cancelEncoder, { once: true });
          let encoded: Buffer;
          try { encoded = await encoder.toBuffer(); } finally { signal?.removeEventListener("abort", cancelEncoder); }
          if (signal?.aborted) throw new ShopBrandMediaError("SOURCE_TIMEOUT", true);
          if (!output || encoded.length < output.length) output = encoded;
          if (encoded.length <= 1024 * 1024) break;
        }
        if (!output || output.length >= SHOP_BRAND_MAX_OUTPUT_BYTES) {
          throw new ShopBrandMediaError("OUTPUT_TOO_LARGE");
        }
        const verified = await verifyEncodedBrandImage(output, "image/jpeg");
        if (signal?.aborted) throw new ShopBrandMediaError("SOURCE_TIMEOUT", true);
        if (verified.contentType !== "image/jpeg" || verified.width !== WIDTH ||
            verified.height !== HEIGHT || verified.bytes.subarray(0, 2).toString("hex") !== "ffd8") {
          throw new ShopBrandMediaError("OUTPUT_VERIFICATION_FAILED");
        }
        return verified;
      } catch (error) {
        if (error instanceof ShopBrandMediaError) throw error;
        throw new ShopBrandMediaError("INVALID_IMAGE", false, boundedMediaProviderMessage(error));
      }
    },
  };
}
