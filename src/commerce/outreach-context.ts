import { z } from "zod";

export const CommerceOutreachToolContextSchema = z.strictObject({
  purpose: z.literal("INITIAL_RECOVERY_OUTREACH"),
});

export type CommerceOutreachToolContext =
  z.infer<typeof CommerceOutreachToolContextSchema>;
