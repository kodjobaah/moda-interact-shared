import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {stableJson} from '../wrapper-projection.js';
import {RecoveryCompositeRenderError} from './composite-render-errors.js';
const fontSha='7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954';
const licenseSha='7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const fail=(_code:'FONT_UNAVAILABLE'):never=>{throw new RecoveryCompositeRenderError('FONT_UNAVAILABLE');};
/** Geometry-free V2 catalog. Pinned font resources contain no layout geometry. */
export const COMPOSITE_FONT_RESOURCE_V2=Object.freeze({schemaVersion:1,fontId:'DEJAVU_SANS_2_37',fontSha256:fontSha,licenseSha256:licenseSha,coverageSha256:'4f7b61ab9a530ba988efa8b6e87cfed72b7e06a08d0f3422eed89094c7a3e8ed'});
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
export async function loadCompositeFontAssets(directory?: URL) {
  try {
    const root = directory ?? await assetsDirectory();
    const [font, license, coverageBytes, manifestBytes] = await Promise.all([
      readFile(new URL('DejaVuSans.ttf', root)), readFile(new URL('LICENSE.txt', root)),
      readFile(new URL('coverage.json', root)), readFile(new URL('manifest.json', root)),
    ]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (hash(font) !== fontSha || hash(license) !== licenseSha ||
        stableJson(manifest) !== stableJson(COMPOSITE_FONT_RESOURCE_V2) || hash(coverageBytes) !== manifest.coverageSha256) return fail('FONT_UNAVAILABLE');
    const coverage: unknown = JSON.parse(coverageBytes.toString('utf8'));
    if (!Array.isArray(coverage) || coverage.length !== 5918 || !coverage.every(cp => Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff)) return fail('FONT_UNAVAILABLE');
    return { fontfile: fileURLToPath(new URL('DejaVuSans.ttf', root)), coverage: new Set<number>(coverage), manifest };
  } catch { return fail('FONT_UNAVAILABLE'); }
}
