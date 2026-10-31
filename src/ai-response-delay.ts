import { z } from "zod";

/** Version shared by hosted Woo API and Shopify response-delay settings. */
export const AI_RESPONSE_DELAY_SCHEMA_VERSION = 1 as const;

/** Merchant-selected additional wait before an AI reply; human replies are not delayed. */
export const AiResponseDelayMinutesSchema = z.number().int().min(0).max(30);

/** Wire revision shape. Consumers must also validate that timestamp values parse as real dates. */
export const AiResponseDelayRevisionSchema = z.union([
  z.literal("UNCONFIGURED"),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
]);

/** Canonical GET and successful PUT response shared by hosted Woo API and Shopify. */
export const MerchantAiResponseDelayReadV1Schema = z.strictObject({
  schemaVersion: z.literal(AI_RESPONSE_DELAY_SCHEMA_VERSION),
  revision: AiResponseDelayRevisionSchema,
  aiResponseDelayMinutes: AiResponseDelayMinutesSchema,
});

/** Canonical optimistic-concurrency PUT request shared by hosted Woo API and Shopify. */
export const MerchantAiResponseDelayWriteV1Schema = z.strictObject({
  schemaVersion: z.literal(AI_RESPONSE_DELAY_SCHEMA_VERSION),
  expectedRevision: AiResponseDelayRevisionSchema,
  aiResponseDelayMinutes: AiResponseDelayMinutesSchema,
});

export type AiResponseDelayMinutes =
  z.infer<typeof AiResponseDelayMinutesSchema>;
export type AiResponseDelayRevision =
  z.infer<typeof AiResponseDelayRevisionSchema>;
export type MerchantAiResponseDelayReadV1 =
  z.infer<typeof MerchantAiResponseDelayReadV1Schema>;
export type MerchantAiResponseDelayWriteV1 =
  z.infer<typeof MerchantAiResponseDelayWriteV1Schema>;
