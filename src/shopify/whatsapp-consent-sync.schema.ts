import { z } from "zod";
import { isShopifyCustomerNumericId } from "../identity/shopify-customer.js";

export const SHOPIFY_WHATSAPP_CONSENT_SYNC_SCHEMA_VERSION = 1 as const;
export const SHOPIFY_WHATSAPP_CONSENT_SYNC_TOPIC =
  "customers_whats_app_marketing_consent/update" as const;

/**
 * A webhook notification to re-read CURRENT Shopify consent in Background.
 * These fields contain no consent decision, phone, checkout or recovery data;
 * parsing this job never authorises a recovery or an outbound message.
 */
export const ShopifyWhatsAppConsentSyncJobV1Schema = z
  .object({
    schemaVersion: z.literal(SHOPIFY_WHATSAPP_CONSENT_SYNC_SCHEMA_VERSION),
    shopId: z.string().min(1).max(128).regex(/^\S+$/),
    shopifyCustomerId: z.string().refine(isShopifyCustomerNumericId, {
      message: "Must be a canonical Shopify numeric Customer ID",
    }),
    deliveryId: z.string().min(1).max(256).regex(/^\S+$/),
    triggeredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ShopifyWhatsAppConsentSyncJobV1 =
  z.infer<typeof ShopifyWhatsAppConsentSyncJobV1Schema>;

export function parseShopifyWhatsAppConsentSyncJobV1(
  input: unknown,
): ShopifyWhatsAppConsentSyncJobV1 {
  return ShopifyWhatsAppConsentSyncJobV1Schema.parse(input);
}

export function safeParseShopifyWhatsAppConsentSyncJobV1(input: unknown) {
  return ShopifyWhatsAppConsentSyncJobV1Schema.safeParse(input);
}
