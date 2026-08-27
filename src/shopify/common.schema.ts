import { z } from "zod";

/**
 * Reasonable upper bounds for externally controlled (Shopify-originated) strings.
 * These exist to keep queue messages small and predictable, not to validate business rules.
 */
const MAX_ID_LENGTH = 100;
const MAX_SHORT_TEXT_LENGTH = 320;
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_LINE_ITEMS = 250;

const decimalStringPattern = /^-?\d+(\.\d+)?$/;

/** Decimal amount encoded as a string; never a JS number to avoid float precision loss. */
const DecimalStringSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(decimalStringPattern, "must be a decimal string, e.g. \"12.34\"");

export const ShopifyTenantSchema = z
  .object({
    shopId: z.string().min(1).max(MAX_ID_LENGTH),
    shopDomain: z
      .string()
      .min(1)
      .max(MAX_SHORT_TEXT_LENGTH)
      .toLowerCase()
      .trim(),
  })
  .strict();

export type ShopifyTenant = z.infer<typeof ShopifyTenantSchema>;

export const ShopifyCustomerReferenceSchema = z
  .object({
    shopifyCustomerId: z.string().min(1).max(MAX_ID_LENGTH).nullable(),
    email: z.string().email().max(MAX_SHORT_TEXT_LENGTH).nullable(),
    phone: z.string().min(1).max(64).nullable(),
    firstName: z.string().min(1).max(MAX_TITLE_LENGTH).nullable(),
    lastName: z.string().min(1).max(MAX_TITLE_LENGTH).nullable(),
  })
  .strict();

export type ShopifyCustomerReference = z.infer<typeof ShopifyCustomerReferenceSchema>;

export const ShopifyMoneySchema = z
  .object({
    amount: DecimalStringSchema,
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/, "must be an uppercase three-letter currency code"),
  })
  .strict();

export type ShopifyMoney = z.infer<typeof ShopifyMoneySchema>;

/**
 * Fields limited to what checkout recovery and customer-facing basket context require.
 * Line-item arrays are bounded (see MAX_LINE_ITEMS) to prevent unexpectedly large queue messages.
 */
export const ShopifyCheckoutLineItemSchema = z
  .object({
    lineItemId: z.string().min(1).max(MAX_ID_LENGTH).nullable(),
    variantId: z.string().min(1).max(MAX_ID_LENGTH).nullable(),
    productId: z.string().min(1).max(MAX_ID_LENGTH).nullable(),
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    variantTitle: z.string().min(1).max(MAX_TITLE_LENGTH).nullable(),
    quantity: z.number().int().positive(),
    unitPrice: DecimalStringSchema.nullable(),
    sku: z.string().min(1).max(MAX_ID_LENGTH).nullable(),
  })
  .strict();

export type ShopifyCheckoutLineItem = z.infer<typeof ShopifyCheckoutLineItemSchema>;

export const ShopifyCheckoutLineItemsSchema = z
  .array(ShopifyCheckoutLineItemSchema)
  .max(MAX_LINE_ITEMS);

export { MAX_URL_LENGTH, MAX_LINE_ITEMS };
