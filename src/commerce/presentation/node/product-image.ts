import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { ConversationPreparedProductImageSchema, ConversationProductImageSourceSchema, type ConversationPreparedProductImage, type ConversationProductImageSource } from '../product-image.js';
import { stableJson } from '../wrapper-projection.js';
import { type SafeFetcher, type PublicMediaProbe, type VerifiedBrandImage, type ShopBrandR2Credentials, ShopBrandMediaError } from './contracts.js';
import { createSafeImageFetcher } from './safe-fetch.js';
import { createOutreachProductImageTransformer } from './product-image-transformer.js';
import { createBrandR2S3Transport, putGuardedImmutableR2Object, type BrandR2Transport, isValidMediaBucket } from './r2-writer.js';
import { createShopBrandPublicMediaProbe } from './public-probe.js';
import { isPublicIpAddress } from './network-policy.js';

export type ConversationProductImageOmission = 'CONFIGURATION_UNAVAILABLE' | 'UNSAFE_IMAGE_SOURCE' | 'SOURCE_UNAVAILABLE' | 'IMAGE_TRANSFORM_FAILED' | 'R2_UNAVAILABLE' | 'PUBLIC_IMAGE_UNAVAILABLE' | 'MEDIA_DEADLINE';
export type ConversationProductImageStage = 'CONFIGURATION' | 'SOURCE' | 'TRANSFORM' | 'R2' | 'PUBLIC_PROBE' | 'READY';
export type ConversationProductImagePreparation = { kind: 'READY'; image: ConversationPreparedProductImage; stage: 'READY'; durationMs: number }
 | { kind: 'OMITTED'; reason: ConversationProductImageOmission; stage: ConversationProductImageStage; durationMs: number };
export type ConversationProductImagePreparationInput = {
 source: ConversationProductImageSource;
 publicOrigin: string; bucketName: string; r2: ShopBrandR2Credentials;
 signal?: AbortSignal;
 /** Original turn deadline in epoch milliseconds. A caller may instead supply an already bounded child signal. */
 deadlineAt?: number;
};
export type ConversationProductImagePreparationDependencies = {
 fetcher?: SafeFetcher;
 transformer?: { transform(bytes: Buffer, signal?: AbortSignal): Promise<VerifiedBrandImage> };
 transportFactory?: (credentials: ShopBrandR2Credentials) => BrandR2Transport;
 probe?: PublicMediaProbe;
 now?: () => number;
};
const KEY = /^conversation-products\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.jpg$/;
export const isConversationProductObjectKey = (key: string): boolean => KEY.test(key);
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export function conversationProductObjectKey(source: ConversationProductImageSource, contentSha256: string): string {
 const parsed = ConversationProductImageSourceSchema.parse(source);
 if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new ShopBrandMediaError('OUTPUT_VERIFICATION_FAILED');
 return `conversation-products/v1/${sha256(parsed.shopId)}/${sha256(stableJson({ productId: parsed.productId, variantId: parsed.variantId }))}/${contentSha256}.jpg`;
}
function publicOrigin(value: string): string | null {
 try {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      (value !== url.origin && value !== url.origin + '/') || host === 'localhost' || host.endsWith('.localhost') ||
      (isIP(host) && !isPublicIpAddress(host))) return null;
  return url.origin;
 } catch { return null; }
}
class MediaDeadline extends Error {}
function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
 if (signal.aborted) return Promise.reject(new MediaDeadline());
 return new Promise((resolve, reject) => {
  const abort = () => reject(new MediaDeadline());
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve().then(() => { if (signal.aborted) throw new MediaDeadline(); return operation(); }).then(
   value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(new MediaDeadline()); else resolve(value); },
   error => { signal.removeEventListener('abort', abort); reject(error); },
  );
 });
}
/** One optional preparation, no host authorization/config reads, provider sends or logs. */
export async function prepareConversationProductImage(input: ConversationProductImagePreparationInput, deps: ConversationProductImagePreparationDependencies = {}): Promise<ConversationProductImagePreparation> {
 const now = deps.now ?? Date.now, start = now();
 const duration = () => { const elapsed = now() - start; return Number.isFinite(elapsed) ? Math.max(0, Math.min(5000, elapsed)) : 0; };
 let stage: ConversationProductImageStage = 'CONFIGURATION';
 const omitted = (reason: ConversationProductImageOmission): ConversationProductImagePreparation => ({ kind: 'OMITTED', reason, stage, durationMs: duration() });
 const budget = input.deadlineAt === undefined ? 5000 : Math.min(5000, input.deadlineAt - start - 1000);
 if (!Number.isFinite(start) || !Number.isFinite(budget) || budget <= 0 || input.signal?.aborted) return omitted('MEDIA_DEADLINE');
 const source = ConversationProductImageSourceSchema.safeParse(input.source);
 if (!source.success) return omitted('UNSAFE_IMAGE_SOURCE');
 const origin = publicOrigin(input.publicOrigin);
 if (!origin || typeof input.bucketName !== 'string' || !isValidMediaBucket(input.bucketName) || typeof input.r2?.accessKeyId !== 'string' || !input.r2.accessKeyId || typeof input.r2.secretAccessKey !== 'string' || !input.r2.secretAccessKey) return omitted('CONFIGURATION_UNAVAILABLE');
 try { const endpoint = new URL(input.r2.endpoint); if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return omitted('CONFIGURATION_UNAVAILABLE'); }
 catch { return omitted('CONFIGURATION_UNAVAILABLE'); }
 const controller = new AbortController();
 const abort = () => controller.abort();
 input.signal?.addEventListener('abort', abort, { once: true });
 if (input.signal?.aborted) abort();
 const timer = setTimeout(abort, budget);
 const checkDeadline = () => { if (now() >= start + budget) abort(); if (controller.signal.aborted) throw new MediaDeadline(); };
 let transport: BrandR2Transport | undefined;
 try {
  checkDeadline();
  stage = 'SOURCE';
  const fetched = await bounded(() => (deps.fetcher ?? createSafeImageFetcher()).fetch(source.data.sourceUrl, controller.signal), controller.signal);
  checkDeadline();
  stage = 'TRANSFORM';
  const image = await bounded(() => (deps.transformer ?? createOutreachProductImageTransformer()).transform(fetched.bytes, controller.signal), controller.signal);
  checkDeadline();
  const objectKey = conversationProductObjectKey(source.data, image.contentSha256);
  const prepared = ConversationPreparedProductImageSchema.parse({ schemaVersion: 1, shopId: source.data.shopId, productId: source.data.productId, variantId: source.data.variantId,
   publicUrl: `${origin}/${objectKey}`, objectKey, contentSha256: image.contentSha256, contentType: image.contentType, byteLength: image.sizeBytes, width: image.width, height: image.height });
  stage = 'R2';
  if (controller.signal.aborted) throw new MediaDeadline();
  transport = (deps.transportFactory ?? createBrandR2S3Transport)(input.r2);
  checkDeadline();
  await bounded(() => putGuardedImmutableR2Object({ transportOrFactory: transport!, bucket: input.bucketName, objectKey, image,
   acceptsKey: key => isConversationProductObjectKey(key) && key === objectKey, signal: controller.signal }), controller.signal);
  checkDeadline();
  stage = 'PUBLIC_PROBE';
  const probe = deps.probe ?? createShopBrandPublicMediaProbe(createSafeImageFetcher({ maxRedirects: 0, maxBytes: 5 * 1024 * 1024 - 1 }));
  await bounded(() => probe.verify({ url: prepared.publicUrl, image }, controller.signal), controller.signal);
  checkDeadline();
  stage = 'READY';
  return { kind: 'READY', image: prepared, stage, durationMs: duration() };
 } catch (error) {
  if (controller.signal.aborted || error instanceof MediaDeadline || now() >= start + budget) return omitted('MEDIA_DEADLINE');
  if (stage === 'SOURCE') return omitted(error instanceof ShopBrandMediaError && error.code === 'UNSAFE_SOURCE' ? 'UNSAFE_IMAGE_SOURCE' : 'SOURCE_UNAVAILABLE');
  if (stage === 'TRANSFORM') return omitted('IMAGE_TRANSFORM_FAILED');
  return omitted(stage === 'PUBLIC_PROBE' ? 'PUBLIC_IMAGE_UNAVAILABLE' : 'R2_UNAVAILABLE');
 } finally {
  clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
  try { transport?.close?.(); } catch { /* Closing an owned transport cannot change the bounded outcome. */ }
 }
}
