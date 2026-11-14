import { z } from 'zod';
import { RecoveryMultipartDeliveryPlanSchema, parseRecoveryMultipartDeliveryPlan } from './recovery-multipart.js';
import { RecoveryCompositeImagePlanSchema, parseRecoveryCompositeImagePlan, type RecoveryCompositeImagePlan, type RecoveryCompositeTrustedContext } from './composite-image.js';
import { stableJson, type PresentationDigest } from './wrapper-projection.js';

/** Opt-in migration reader only: composite is one physical HEADER, never mixed with other parts. */
export const RecoveryCompositeMultipartDeliveryPlanSchema = z.union([
  RecoveryMultipartDeliveryPlanSchema,
  z.strictObject({schemaVersion:z.literal(1),kind:z.literal('RECOVERY_MULTIPART'),
    parts:z.tuple([z.strictObject({role:z.literal('HEADER'),plan:RecoveryCompositeImagePlanSchema})])}),
]);
export type RecoveryCompositeMultipartDeliveryPlan = z.infer<typeof RecoveryCompositeMultipartDeliveryPlanSchema>;
export type RecoveryCompositeMultipartTrustedContext = {checkoutUrl:string; composite:RecoveryCompositeTrustedContext | null};
/** Stored structure cannot supply its own authority. Composite readers require original host context. */
export function parseRecoveryCompositeMultipartDeliveryPlan(raw:unknown,trusted:RecoveryCompositeMultipartTrustedContext,sha256:PresentationDigest):RecoveryCompositeMultipartDeliveryPlan {
  const plan=RecoveryCompositeMultipartDeliveryPlanSchema.parse(raw);
  const only=plan.parts[0];
  if(only?.plan.kind==='COMPOSITE_IMAGE') {
    if(!trusted.composite || trusted.composite.checkoutUrl!==trusted.checkoutUrl)
      throw Object.assign(new Error('COMPOSITE_BINDING_INVALID'),{code:'COMPOSITE_BINDING_INVALID'});
    parseRecoveryCompositeImagePlan(only.plan,trusted.composite,sha256);
    return plan;
  }
  return parseRecoveryMultipartDeliveryPlan(plan,trusted.checkoutUrl);
}
export function buildRecoveryCompositeMultipartDeliveryPlan(input:{plan:RecoveryCompositeImagePlan;trusted:RecoveryCompositeTrustedContext},sha256:PresentationDigest):RecoveryCompositeMultipartDeliveryPlan {
  return parseRecoveryCompositeMultipartDeliveryPlan({schemaVersion:1,kind:'RECOVERY_MULTIPART',parts:[{role:'HEADER',plan:input.plan}]},
    {checkoutUrl:input.trusted.checkoutUrl,composite:input.trusted},sha256);
}
/** Identical stable serialization to legacy digest for every old plan; no authority inference. */
export function digestRecoveryCompositeMultipartDeliveryPlan(plan:RecoveryCompositeMultipartDeliveryPlan,sha256:PresentationDigest):string {
  return sha256(stableJson(RecoveryCompositeMultipartDeliveryPlanSchema.parse(plan)));
}
