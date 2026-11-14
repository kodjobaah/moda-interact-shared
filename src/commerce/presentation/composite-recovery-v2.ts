import {z} from 'zod';
import {RecoveryMultipartDeliveryPlanSchema,parseRecoveryMultipartDeliveryPlan} from './recovery-multipart.js';
import {RecoveryCompositeImagePlanV2Schema,parseRecoveryCompositeImagePlanV2,type RecoveryCompositeImagePlanV2,type RecoveryCompositeTrustedContextV2} from './composite-image-v2.js';
import {stableJson,type PresentationDigest} from './wrapper-projection.js';
export const RecoveryCompositeMultipartDeliveryPlanV2Schema=z.union([RecoveryMultipartDeliveryPlanSchema,
 z.strictObject({schemaVersion:z.literal(1),kind:z.literal('RECOVERY_MULTIPART'),parts:z.tuple([z.strictObject({role:z.literal('HEADER'),plan:RecoveryCompositeImagePlanV2Schema})])}),
]);
export type RecoveryCompositeMultipartDeliveryPlanV2=z.infer<typeof RecoveryCompositeMultipartDeliveryPlanV2Schema>;
export type RecoveryCompositeMultipartTrustedContextV2={checkoutUrl:string;compositeV2:RecoveryCompositeTrustedContextV2|null};
export function parseRecoveryCompositeMultipartDeliveryPlanV2(raw:unknown,trusted:RecoveryCompositeMultipartTrustedContextV2,sha256:PresentationDigest):RecoveryCompositeMultipartDeliveryPlanV2 {
 const carrier=RecoveryCompositeMultipartDeliveryPlanV2Schema.parse(raw),only=carrier.parts[0];
 if(only?.plan.kind==='COMPOSITE_IMAGE'&&only.plan.schemaVersion===2){
  if(!trusted.compositeV2)throw Object.assign(new Error('COMPOSITE_BINDING_INVALID'),{code:'COMPOSITE_BINDING_INVALID'});
  parseRecoveryCompositeImagePlanV2(only.plan,trusted.compositeV2,sha256);return carrier;
 }
 return parseRecoveryMultipartDeliveryPlan(carrier,trusted.checkoutUrl);
}
export function buildRecoveryCompositeMultipartDeliveryPlanV2(input:{plan:RecoveryCompositeImagePlanV2;trusted:RecoveryCompositeTrustedContextV2},sha256:PresentationDigest):RecoveryCompositeMultipartDeliveryPlanV2 {
 return parseRecoveryCompositeMultipartDeliveryPlanV2({schemaVersion:1,kind:'RECOVERY_MULTIPART',parts:[{role:'HEADER',plan:input.plan}]},{checkoutUrl:input.trusted.checkoutUrl,compositeV2:input.trusted},sha256);
}
export function digestRecoveryCompositeMultipartDeliveryPlanV2(plan:RecoveryCompositeMultipartDeliveryPlanV2,sha256:PresentationDigest):string {
 return sha256(stableJson(RecoveryCompositeMultipartDeliveryPlanV2Schema.parse(plan)));
}
