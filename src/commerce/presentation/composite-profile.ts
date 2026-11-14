import {z} from 'zod';
import {stableJson,type PresentationDigest} from './wrapper-projection.js';
/** Structural wire parsing only. No operational ranges, defaults, ordering or readability policy. */
export const RecoveryCompositeProfileSchema=z.strictObject({
 schemaVersion:z.literal(1),fontId:z.literal('DEJAVU_SANS_2_37'),
 canvasWidth:z.number(),headerOnlyHeight:z.number(),withProductHeight:z.number(),
 logoLeft:z.number(),logoTop:z.number(),logoWidth:z.number(),logoHeight:z.number(),
 textLeft:z.number(),textTop:z.number(),textWidth:z.number(),textHeight:z.number(),fontSize:z.number(),textLineSpacingPt:z.number(),
 productLeft:z.number(),productTop:z.number(),productWidth:z.number(),productHeight:z.number(),
});
export type RecoveryCompositeProfile=Readonly<z.infer<typeof RecoveryCompositeProfileSchema>>;
const invalid=():never=>{throw Object.assign(new Error('COMPOSITE_PROFILE_SAFETY_INVALID'),{code:'COMPOSITE_PROFILE_SAFETY_INVALID'});};
/** Backend allocation/containment safety, not permission to activate a visual profile. */
export function assertRecoveryCompositeProfileSafety(p:RecoveryCompositeProfile):void {
 const dimensions=[p.canvasWidth,p.headerOnlyHeight,p.withProductHeight,p.logoWidth,p.logoHeight,p.textWidth,p.textHeight,p.productWidth,p.productHeight,p.fontSize];
 const positions=[p.logoLeft,p.logoTop,p.textLeft,p.textTop,p.productLeft,p.productTop,p.textLineSpacingPt];
 if(dimensions.some(n=>!Number.isSafeInteger(n)||n<=0)||positions.some(n=>!Number.isSafeInteger(n)||n<0)||
    p.canvasWidth*p.headerOnlyHeight>2_000_000||p.canvasWidth*p.withProductHeight>2_000_000)invalid();
 const headerLimit=Math.min(p.headerOnlyHeight,p.withProductHeight);
 if(p.logoLeft+p.logoWidth>p.canvasWidth||p.logoTop+p.logoHeight>headerLimit||p.textLeft+p.textWidth>p.canvasWidth||p.textTop+p.textHeight>headerLimit||
    p.productLeft+p.productWidth>p.canvasWidth||p.productTop+p.productHeight>p.withProductHeight)invalid();
}
export function digestRecoveryCompositeProfile(profile:RecoveryCompositeProfile,sha256:PresentationDigest):string {
 const p=RecoveryCompositeProfileSchema.parse(profile);assertRecoveryCompositeProfileSafety(p);
 const hash=sha256(stableJson(p));if(!/^[a-f0-9]{64}$/.test(hash))invalid();return hash;
}
export function readRecoveryCompositeProfile(raw:unknown,expectedProfileSha256:string,sha256:PresentationDigest):RecoveryCompositeProfile {
 const profile=RecoveryCompositeProfileSchema.parse(raw);assertRecoveryCompositeProfileSafety(profile);
 if(!/^[a-f0-9]{64}$/.test(expectedProfileSha256)||digestRecoveryCompositeProfile(profile,sha256)!==expectedProfileSha256)
  throw Object.assign(new Error('COMPOSITE_PROFILE_BINDING_INVALID'),{code:'COMPOSITE_PROFILE_BINDING_INVALID'});
 return Object.freeze(profile);
}
/** Conservative text work budget before Pango/Sharp can allocate an unbounded raster. */
export function assertRecoveryCompositeTextAllocationV2(profile:RecoveryCompositeProfile,headerText:string):void {
 assertRecoveryCompositeProfileSafety(profile);
 const count=Array.from(headerText).length;
 if(new TextEncoder().encode(headerText).byteLength>16384||count*profile.fontSize*profile.fontSize*16+count*profile.textWidth*profile.textLineSpacingPt>16_000_000)
  throw Object.assign(new Error('COMPOSITE_TEXT_ALLOCATION_INVALID'),{code:'COMPOSITE_TEXT_ALLOCATION_INVALID'});
}
