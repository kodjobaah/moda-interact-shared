import { z } from "zod";
import { IdSchema } from "./primitives";

export const CommerceOutreachToolContextSchema = z.strictObject({
  purpose: z.literal("INITIAL_RECOVERY_OUTREACH"),
  checkoutRecoveryId: IdSchema,
  outreachAttemptId: IdSchema,
});

export type CommerceOutreachToolContext =
  z.infer<typeof CommerceOutreachToolContextSchema>;
