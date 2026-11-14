import {z} from 'zod';
import {RecoveryCompositeBrandOriginV2Schema} from '../composite-image-v2.js';
import type {ConversationPreparedBrandImage} from '../brand-image.js';
import type {ConversationPreparedProductImage} from '../product-image.js';
/** Structural decode only; artifact identity/resource checks below are explicit. */
const brand=z.strictObject({schemaVersion:z.literal(1),origin:RecoveryCompositeBrandOriginV2Schema,status:z.string(),kind:z.string(),publicOrigin:z.string(),publicUrl:z.string(),objectKey:z.string(),contentSha256:z.string(),contentType:z.string(),sizeBytes:z.number(),width:z.number(),height:z.number(),verifiedAt:z.string()});
const product=z.strictObject({schemaVersion:z.literal(1),shopId:z.string(),productId:z.string(),variantId:z.string().nullable(),publicUrl:z.string(),objectKey:z.string(),contentSha256:z.string(),contentType:z.string(),byteLength:z.number(),width:z.number(),height:z.number()});
const invalid=():never=>{throw new Error('COMPOSITE_SOURCE_IDENTITY_INVALID');};
function resource(v:{contentSha256:string;contentType:string;width:number;height:number},bytes:number){
 if(!/^[a-f0-9]{64}$/.test(v.contentSha256)||!['image/jpeg','image/png'].includes(v.contentType)||!Number.isSafeInteger(bytes)||bytes<=0||bytes>=5*1024*1024||v.width!==1125||v.height!==600)invalid();
}
export function readCompositeBrandSourceV2(raw:unknown):ConversationPreparedBrandImage {
 const b=brand.parse(raw);resource(b,b.sizeBytes);const o=b.origin;
 if(b.status!=='READY'||b.kind!=='R2_DERIVATIVE'||o.kind!=='SHOP_BRAND'||!['LOGO','SQUARE_LOGO'].includes(o.role)||!Number.isSafeInteger(o.sourceGeneration)||!/^sha256:[a-f0-9]{64}$/.test(o.sourceFingerprint)||!/^[-A-Za-z0-9._]+$/.test(o.shopDomain)||['.','..'].includes(o.shopDomain))invalid();
 const ext=b.contentType==='image/jpeg'?'jpg':'png',key=`shop-brands/${o.shopDomain}/${o.role.toLowerCase()}/sha256-${b.contentSha256}.${ext}`;
 if(b.objectKey!==key||b.publicUrl!==`${b.publicOrigin}/${key}`)invalid();
 return b as ConversationPreparedBrandImage;
}
export function readCompositeProductSourceV2(raw:unknown):ConversationPreparedProductImage {
 const p=product.parse(raw);resource(p,p.byteLength);if(p.contentType!=='image/jpeg')invalid();return p as ConversationPreparedProductImage;
}
