import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp, {type Sharp, type OverlayOptions} from 'sharp';
import { RecoveryCompositeProvenanceSchema, RECOVERY_COMPOSITE_LAYOUT_V1 as layout, type RecoveryCompositeProvenance } from '../composite-image.js';
import { stableJson } from '../wrapper-projection.js';
import { verifyEncodedBrandImage } from './metadata-verifier.js';
import { SHOP_BRAND_MAX_SOURCE_BYTES, type VerifiedBrandImage } from './contracts.js';

export const RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256 = '9213e2b12cdc77c7de70ed5b738e1894efeae4b54657a31373236d2642065b02';
/** Freeze this receipt with the plan; replay never substitutes the current runtime identity. */
export const RECOVERY_COMPOSITE_RENDER_PROFILE = Object.freeze({
  schemaVersion:1, platform:process.platform, architecture:process.arch, node:process.versions.node,
  libraries:Object.freeze({...sharp.versions}), fontSize:44, dpi:72, rgba:true, wrap:'word',
  autoFit:false, trim:false, normalization:'NONE', background:'#ffffff',
  jpeg:Object.freeze({quality:86,mozjpeg:true,chromaSubsampling:'4:2:0'}),
});
export const RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256 = createHash('sha256').update(stableJson({
  assetManifestSha256:RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256,profile:RECOVERY_COMPOSITE_RENDER_PROFILE,
})).digest('hex');
const fontSha = '7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954';
const licenseSha = '7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93';
export type RecoveryCompositeRenderFailure = 'FONT_UNAVAILABLE' | 'UNSUPPORTED_HEADER' | 'HEADER_OVERFLOW' | 'SOURCE_IDENTITY_INVALID' | 'IMAGE_TRANSFORM_FAILED' | 'MEDIA_DEADLINE';
export class RecoveryCompositeRenderError extends Error {
  constructor(readonly code: RecoveryCompositeRenderFailure) { super(code); this.name = 'RecoveryCompositeRenderError'; }
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (code: RecoveryCompositeRenderFailure): never => { throw new RecoveryCompositeRenderError(code); };
const check = (signal?: AbortSignal) => { if (signal?.aborted) fail('MEDIA_DEADLINE'); };
/** Bounded resolution works from source and from split bundled chunks; no host-font search. */
async function assetsDirectory(): Promise<URL> {
  let directory = new URL('.', import.meta.url);
  for (let depth = 0; depth < 6; depth++) {
    try {
      const metadata = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
      if (metadata.name === '@modainteract/moda-interact-shared') return new URL('assets/recovery-composite/', directory);
    } catch { /* Only the bounded package ancestor chain is inspected. */ }
    directory = new URL('../', directory);
  }
  return fail('FONT_UNAVAILABLE');
}
async function loadAssets(directory?: URL) {
  try {
    const root = directory ?? await assetsDirectory();
    const [font, license, coverageBytes, manifestBytes] = await Promise.all([
      readFile(new URL('DejaVuSans.ttf', root)), readFile(new URL('LICENSE.txt', root)),
      readFile(new URL('coverage.json', root)), readFile(new URL('manifest.json', root)),
    ]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (hash(font) !== fontSha || hash(license) !== licenseSha ||
        hash(stableJson(manifest)) !== RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256 || hash(coverageBytes) !== manifest.coverageSha256) return fail('FONT_UNAVAILABLE');
    const coverage: unknown = JSON.parse(coverageBytes.toString('utf8'));
    if (!Array.isArray(coverage) || coverage.length !== 5918 || !coverage.every(cp => Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff)) return fail('FONT_UNAVAILABLE');
    return { fontfile: fileURLToPath(new URL('DejaVuSans.ttf', root)), coverage: new Set<number>(coverage), manifest };
  } catch { return fail('FONT_UNAVAILABLE'); }
}
async function imageOperation(pipeline: Sharp, signal?: AbortSignal): Promise<Buffer> {
  check(signal); const abort = () => pipeline.destroy(); signal?.addEventListener('abort', abort, {once: true});
  try { const bytes = await pipeline.toBuffer(); check(signal); return bytes; }
  finally { signal?.removeEventListener('abort', abort); }
}
export type RecoveryCompositeRenderInput = {provenance: RecoveryCompositeProvenance; logoBytes: Buffer; productBytes?: Buffer | null; signal?: AbortSignal};
export type RecoveryCompositeRenderedImage = {image: VerifiedBrandImage; textBounds: Readonly<{width: number; height: number}>; fontAssetSha256: string};
/** Fixed licensed font, fixed geometry/encoding; caller-owned actual source bytes remain untouched. */
export function createRecoveryCompositeImageRenderer(options: {assetsDirectory?: URL} = {}) {
  let assets: ReturnType<typeof loadAssets> | undefined;
  return { async render(input: RecoveryCompositeRenderInput): Promise<RecoveryCompositeRenderedImage> {
    try {
      check(input.signal);
      const provenance = RecoveryCompositeProvenanceSchema.parse(input.provenance);
      if (provenance.fontAssetSha256 !== RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256) return fail('FONT_UNAVAILABLE');
      if (!Buffer.isBuffer(input.logoBytes) || !input.logoBytes.length || input.logoBytes.length > SHOP_BRAND_MAX_SOURCE_BYTES || hash(input.logoBytes) !== provenance.logo.contentSha256 ||
          (provenance.product === null ? input.productBytes != null : !Buffer.isBuffer(input.productBytes) || !input.productBytes.length || input.productBytes.length > SHOP_BRAND_MAX_SOURCE_BYTES || hash(input.productBytes) !== provenance.product.contentSha256)) return fail('SOURCE_IDENTITY_INVALID');
      const font = await (assets ??= loadAssets(options.assetsDirectory)); check(input.signal);
      if (Array.from(provenance.headerText).some(character => !['\n','\r','\t'].includes(character) && !font.coverage.has(character.codePointAt(0)!))) return fail('UNSUPPORTED_HEADER');
      // Prepared input images are already metadata-free 1125x600 derivatives; verify before decoding/compositing.
      const logoType = input.logoBytes.subarray(0, 2).toString('hex') === 'ffd8' ? 'image/jpeg' : input.logoBytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : null;
      if (!logoType || input.productBytes && input.productBytes.subarray(0,2).toString('hex') !== 'ffd8') return fail('SOURCE_IDENTITY_INVALID');
      await verifyEncodedBrandImage(input.logoBytes, logoType); check(input.signal);
      if (input.productBytes) { await verifyEncodedBrandImage(input.productBytes, 'image/jpeg'); check(input.signal); }
      const escaped = provenance.headerText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
      const text = await imageOperation(sharp({text: {text: escaped, font: `DejaVu Sans ${RECOVERY_COMPOSITE_RENDER_PROFILE.fontSize}`, fontfile: font.fontfile, width: layout.textWidth, dpi: RECOVERY_COMPOSITE_RENDER_PROFILE.dpi, rgba: RECOVERY_COMPOSITE_RENDER_PROFILE.rgba}}).png(), input.signal);
      const bounds = await sharp(text).metadata(); check(input.signal);
      if (!bounds.width || !bounds.height || bounds.width > layout.textWidth || bounds.height > layout.textHeight) return fail('HEADER_OVERFLOW');
      const logo = await imageOperation(sharp(input.logoBytes, {limitInputPixels: 40_000_000, failOn: 'error'}).resize(layout.logoWidth, layout.logoHeight, {fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png(), input.signal);
      const overlays: OverlayOptions[] = [{input: logo,left:layout.logoLeft,top:layout.logoTop},{input:text,left:layout.textLeft,top:layout.textTop}];
      if (input.productBytes) {
        const product = await imageOperation(sharp(input.productBytes, {limitInputPixels:40_000_000,failOn:'error'}).resize(layout.productWidth,layout.productHeight,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png(), input.signal);
        overlays.push({input:product,left:layout.productLeft,top:layout.productTop});
      }
      const height = provenance.product === null ? layout.headerHeight : layout.headerHeight + layout.productHeight;
      const encoded = await imageOperation(sharp({create:{width:layout.width,height,channels:3,background:'#ffffff'}}).composite(overlays).removeAlpha().jpeg(RECOVERY_COMPOSITE_RENDER_PROFILE.jpeg), input.signal);
      const image = await verifyEncodedBrandImage(encoded,'image/jpeg',{width:layout.width,height}); check(input.signal);
      return {image,textBounds:{width:bounds.width,height:bounds.height},fontAssetSha256:RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256};
    } catch (error) {
      if (input.signal?.aborted) return fail('MEDIA_DEADLINE');
      if (error instanceof RecoveryCompositeRenderError) throw error;
      return fail('IMAGE_TRANSFORM_FAILED');
    }
  }};
}
