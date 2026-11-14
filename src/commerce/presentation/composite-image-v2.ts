import {z} from 'zod';
import {RecoveryCompositeProfileSchema,readRecoveryCompositeProfile,assertRecoveryCompositeProfileSafety,assertRecoveryCompositeTextAllocationV2} from './composite-profile.js';
import {stableJson,type PresentationDigest} from './wrapper-projection.js';
/** Every V2 schema below is structural. Identity, transport and technical safety are explicit functions. */
export const RecoveryCompositeBrandOriginV2Schema=z.strictObject({kind:z.string(),shopId:z.string(),shopDomain:z.string(),role:z.string(),sourceGeneration:z.number(),sourceFingerprint:z.string()});
const Logo=z.strictObject({origin:RecoveryCompositeBrandOriginV2Schema,contentSha256:z.string()});
const Product=z.strictObject({shopId:z.string(),platform:z.string(),productId:z.string(),variantId:z.string().nullable(),contentSha256:z.string()});
export const RecoveryCompositeProvenanceV2Schema=z.strictObject({schemaVersion:z.literal(2),shopId:z.string(),logo:Logo,product:Product.nullable(),headerText:z.string(),commonReferenceHash:z.string(),layoutVersion:z.literal('RECOVERY_COMPOSITE_V2'),rendererVersion:z.literal('RECOVERY_COMPOSITE_V2'),profile:RecoveryCompositeProfileSchema,profileSha256:z.string(),fontResourceSha256:z.string(),runtimeSha256:z.string()});
export type RecoveryCompositeProvenanceV2=z.infer<typeof RecoveryCompositeProvenanceV2Schema>;
export const RecoveryPreparedCompositeImageV2Schema=z.strictObject({schemaVersion:z.literal(2),provenance:RecoveryCompositeProvenanceV2Schema,tenantSha256:z.string(),renderIdentitySha256:z.string(),publicOrigin:z.string(),publicUrl:z.string(),objectKey:z.string(),contentSha256:z.string(),contentType:z.string(),byteLength:z.number(),width:z.number(),height:z.number()});
export type RecoveryPreparedCompositeImageV2=z.infer<typeof RecoveryPreparedCompositeImageV2Schema>;
export const RecoveryCompositeImagePlanV2Schema=z.strictObject({schemaVersion:z.literal(2),kind:z.literal('COMPOSITE_IMAGE'),body:z.string(),logicalBody:z.string(),image:RecoveryPreparedCompositeImageV2Schema,boundarySha256:z.string()});
export type RecoveryCompositeImagePlanV2=z.infer<typeof RecoveryCompositeImagePlanV2Schema>;
const Trusted=z.strictObject({provenance:RecoveryCompositeProvenanceV2Schema,publicOrigin:z.string(),body:z.string(),answerText:z.string(),footerText:z.string(),logicalBody:z.string(),checkoutUrl:z.string(),output:z.strictObject({contentSha256:z.string(),byteLength:z.number(),width:z.number(),height:z.number(),profileSha256:z.string(),renderIdentitySha256:z.string()})});
export type RecoveryCompositeTrustedContextV2=z.infer<typeof Trusted>;
const invalid=():never=>{throw Object.assign(new Error('COMPOSITE_BINDING_INVALID'),{code:'COMPOSITE_BINDING_INVALID'});};
const shaFormat=(v:string)=>{if(!/^[a-f0-9]{64}$/.test(v))invalid();};
const digest=(v:string,sha256:PresentationDigest)=>{const h=sha256(v);shaFormat(h);return h;};
function textSafe(v:string,maxUnits:number):void {
 if(v.length>maxUnits||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||Array.from(v).some(c=>{const n=c.codePointAt(0)!;return n>=0xd800&&n<=0xdfff;}))invalid();
}
function originSafe(v:string):void {try{const u=new URL(v);if(v!==u.origin||u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)invalid();}catch{invalid();}}
export function assertRecoveryCompositeProvenanceIdentityV2(p:RecoveryCompositeProvenanceV2,sha256:PresentationDigest):void {
 readRecoveryCompositeProfile(p.profile,p.profileSha256,sha256);assertRecoveryCompositeTextAllocationV2(p.profile,p.headerText);
 for(const h of [p.logo.contentSha256,p.commonReferenceHash,p.fontResourceSha256,p.runtimeSha256])shaFormat(h);
 const o=p.logo.origin;
 if(!p.shopId||p.shopId.length>256||o.kind!=='SHOP_BRAND'||!['LOGO','SQUARE_LOGO'].includes(o.role)||o.shopId!==p.shopId||!Number.isSafeInteger(o.sourceGeneration)||!/^sha256:[a-f0-9]{64}$/.test(o.sourceFingerprint)||!o.shopDomain||o.shopDomain.length>253||!/^[-A-Za-z0-9._]+$/.test(o.shopDomain)||['.','..'].includes(o.shopDomain))invalid();
 textSafe(p.headerText,4096);
 if(p.product!==null){shaFormat(p.product.contentSha256);if(p.product.shopId!==p.shopId||!['SHOPIFY','WOOCOMMERCE'].includes(p.product.platform)||!p.product.productId||p.product.productId.length>256||p.product.variantId!==null&&p.product.variantId.length>256)invalid();}
}
export function digestRecoveryCompositeRenderIdentityV2(provenance:RecoveryCompositeProvenanceV2,sha256:PresentationDigest):string {
 const p=RecoveryCompositeProvenanceV2Schema.parse(provenance);assertRecoveryCompositeProvenanceIdentityV2(p,sha256);return digest(stableJson(p),sha256);
}
export function assertRecoveryCompositeOutputIdentityV2(image:RecoveryPreparedCompositeImageV2,sha256:PresentationDigest):void {
 const p=image.provenance,profile=p.profile;assertRecoveryCompositeProfileSafety(profile);assertRecoveryCompositeProvenanceIdentityV2(p,sha256);originSafe(image.publicOrigin);
 for(const h of [image.tenantSha256,image.renderIdentitySha256,image.contentSha256])shaFormat(h);
 const key=`conversation-composites/v2/${image.tenantSha256}/${image.renderIdentitySha256}/${image.contentSha256}.jpg`;
 if(image.tenantSha256!==digest(p.shopId,sha256)||image.renderIdentitySha256!==digestRecoveryCompositeRenderIdentityV2(p,sha256)||image.width!==profile.canvasWidth||image.height!==(p.product===null?profile.headerOnlyHeight:profile.withProductHeight)||image.contentType!=='image/jpeg'||!Number.isSafeInteger(image.byteLength)||image.byteLength<=0||image.byteLength>=5*1024*1024||image.objectKey!==key||image.publicUrl!==`${image.publicOrigin}/${key}`)invalid();
}
function boundaries(t:RecoveryCompositeTrustedContextV2,sha256:PresentationDigest) {
 textSafe(t.answerText,4096);textSafe(t.footerText,4096);textSafe(t.logicalBody,4096);
 const body=t.body;textSafe(body,4096);if(Array.from(body).length>1024)invalid();
 return {body,boundarySha256:digest(stableJson({headerText:t.provenance.headerText,answerText:t.answerText,footerText:t.footerText,logicalBody:t.logicalBody,body}),sha256)};
}
export function assertRecoveryCompositeImageBindingV2(plan:RecoveryCompositeImagePlanV2,trusted:RecoveryCompositeTrustedContextV2,sha256:PresentationDigest):void {
 assertRecoveryCompositeOutputIdentityV2(plan.image,sha256);const expected=boundaries(trusted,sha256),image=plan.image;
 const identity=digestRecoveryCompositeRenderIdentityV2(trusted.provenance,sha256);
 if(plan.body!==expected.body||plan.logicalBody!==trusted.logicalBody||plan.boundarySha256!==expected.boundarySha256||stableJson(image.provenance)!==stableJson(trusted.provenance)||image.publicOrigin!==trusted.publicOrigin||image.renderIdentitySha256!==identity||image.contentSha256!==trusted.output.contentSha256||image.byteLength!==trusted.output.byteLength||image.width!==trusted.output.width||image.height!==trusted.output.height||image.provenance.profileSha256!==trusted.output.profileSha256||identity!==trusted.output.renderIdentitySha256)invalid();
}
export function parseRecoveryCompositeImagePlanV2(raw:unknown,trustedInput:RecoveryCompositeTrustedContextV2,sha256:PresentationDigest):RecoveryCompositeImagePlanV2 {
 const trusted=Trusted.parse(trustedInput),plan=RecoveryCompositeImagePlanV2Schema.parse(raw);assertRecoveryCompositeImageBindingV2(plan,trusted,sha256);return plan;
}
export function buildRecoveryCompositeImagePlanV2(input:{image:unknown;trusted:RecoveryCompositeTrustedContextV2},sha256:PresentationDigest):RecoveryCompositeImagePlanV2 {
 const trusted=Trusted.parse(input.trusted),expected=boundaries(trusted,sha256);return parseRecoveryCompositeImagePlanV2({schemaVersion:2,kind:'COMPOSITE_IMAGE',...expected,logicalBody:trusted.logicalBody,image:input.image},trusted,sha256);
}
export function digestRecoveryCompositeImagePlanV2(plan:RecoveryCompositeImagePlanV2,sha256:PresentationDigest):string {
 const p=RecoveryCompositeImagePlanV2Schema.parse(plan);assertRecoveryCompositeOutputIdentityV2(p.image,sha256);return digest(stableJson(p),sha256);
}
