import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {digestRecoveryCompositeProfile,type RecoveryCompositeProfile} from '../composite-profile.js';
import type {RecoveryCompositeProvenanceV2} from '../composite-image-v2.js';
import {getRecoveryCompositeRuntimeIdentityV2} from './composite-renderer-v2.js';
/** Consumer-owned TEST inputs, never operational Shared defaults or exported by a package entrypoint. */
export const consumerProfileA:RecoveryCompositeProfile={schemaVersion:1,fontId:'DEJAVU_SANS_2_37',canvasWidth:1125,headerOnlyHeight:300,withProductHeight:900,logoLeft:48,logoTop:60,logoWidth:180,logoHeight:180,textLeft:264,textTop:24,textWidth:813,textHeight:252,fontSize:44,textLineSpacingPt:0,productLeft:0,productTop:300,productWidth:1125,productHeight:600};
export const consumerProfileB:RecoveryCompositeProfile={schemaVersion:1,fontId:'DEJAVU_SANS_2_37',canvasWidth:1125,headerOnlyHeight:640,withProductHeight:1280,logoLeft:472,logoTop:24,logoWidth:180,logoHeight:180,textLeft:90,textTop:250,textWidth:945,textHeight:360,fontSize:40,textLineSpacingPt:48,productLeft:24,productTop:680,productWidth:1077,productHeight:576};
export const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export async function fixtureV2(profile=consumerProfileA,product=true){
 const logoBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#e00000'}}).jpeg().toBuffer();
 const productBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#00b020'}}).jpeg().toBuffer();
 const profileSha256=digestRecoveryCompositeProfile(profile,hash),identity=getRecoveryCompositeRuntimeIdentityV2({profile,profileSha256});
 const provenance:RecoveryCompositeProvenanceV2={schemaVersion:2,shopId:'shop-1',logo:{origin:{kind:'SHOP_BRAND',shopId:'shop-1',shopDomain:'shop.example',role:'LOGO',sourceGeneration:1,sourceFingerprint:'sha256:'+hash(logoBytes)},contentSha256:hash(logoBytes)},product:product?{shopId:'shop-1',platform:'SHOPIFY',productId:'30',variantId:null,contentSha256:hash(productBytes)}:null,headerText:'Shop: Example\nWebsite: https://shop.example\n──────────\n',commonReferenceHash:'a'.repeat(64),layoutVersion:'RECOVERY_COMPOSITE_V2',rendererVersion:'RECOVERY_COMPOSITE_V2',profile,profileSha256,fontResourceSha256:identity.fontResourceSha256,runtimeSha256:identity.runtimeSha256};
 return {profile,profileSha256,identity,provenance,logoBytes,productBytes:product?productBytes:null};
}
