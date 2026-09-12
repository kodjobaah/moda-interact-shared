import { z } from "zod";

export const ARCH007_BILLING_CONTRACT_SCHEMA_VERSION = 1 as const;
export const WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION = 2 as const;
export const BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION = 1 as const;
export const BILLING_SUBSCRIPTION_RECONCILE_QUEUE_NAME = "billing-subscription-reconcile";
export const BILLING_SUBSCRIPTION_RECONCILE_JOB_NAME = "reconcile-subscription";
export const APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS = 300000 as const;

export const BILLING_PLAN_KINDS = ["FREE", "PAID_METERED"] as const;
export const BillingPlanKindSchema = z.enum(BILLING_PLAN_KINDS);
export type BillingPlanKind = z.infer<typeof BillingPlanKindSchema>;

export const BILLING_USAGE_METRICS = [
  "RECOVERY_CONVERSATION",
  "OUTBOUND_AUTOMATED_MESSAGE",
  "DELIVERED_WHATSAPP_MESSAGE",
  "RECOVERY_CREDIT_PACK_PURCHASE",
] as const;
export const BillingUsageMetricSchema = z.enum(BILLING_USAGE_METRICS);
export type BillingUsageMetric = z.infer<typeof BillingUsageMetricSchema>;

export const BILLING_SYSTEM_MESSAGE_CODES = {
  FREE_ALLOWANCE_WARNING: "BILLING_FREE_ALLOWANCE_WARNING",
  RECOVERY_CAPACITY_EXHAUSTED: "BILLING_RECOVERY_CAPACITY_EXHAUSTED",
  PLAN_UPGRADED: "BILLING_PLAN_UPGRADED",
  PLAN_DOWNGRADE_SCHEDULED: "BILLING_PLAN_DOWNGRADE_SCHEDULED",
  SUBSCRIPTION_ENDED: "BILLING_SUBSCRIPTION_ENDED",
  SAFETY_LIMIT_REACHED: "BILLING_SAFETY_LIMIT_REACHED",
  REFUND_REQUEST_RECEIVED: "BILLING_REFUND_REQUEST_RECEIVED",
  REFUND_COMPLETED: "BILLING_REFUND_COMPLETED",
  REFUND_REJECTED: "BILLING_REFUND_REJECTED",
} as const;

const BILLING_SYSTEM_MESSAGE_CODE_VALUES = [
  BILLING_SYSTEM_MESSAGE_CODES.FREE_ALLOWANCE_WARNING,
  BILLING_SYSTEM_MESSAGE_CODES.RECOVERY_CAPACITY_EXHAUSTED,
  BILLING_SYSTEM_MESSAGE_CODES.PLAN_UPGRADED,
  BILLING_SYSTEM_MESSAGE_CODES.PLAN_DOWNGRADE_SCHEDULED,
  BILLING_SYSTEM_MESSAGE_CODES.SUBSCRIPTION_ENDED,
  BILLING_SYSTEM_MESSAGE_CODES.SAFETY_LIMIT_REACHED,
  BILLING_SYSTEM_MESSAGE_CODES.REFUND_REQUEST_RECEIVED,
  BILLING_SYSTEM_MESSAGE_CODES.REFUND_COMPLETED,
  BILLING_SYSTEM_MESSAGE_CODES.REFUND_REJECTED,
] as const;

export const BillingSystemMessageCodeSchema = z.enum(BILLING_SYSTEM_MESSAGE_CODE_VALUES);
export type BillingSystemMessageCode = z.infer<typeof BillingSystemMessageCodeSchema>;

export type PurchasedRecoveryCreditCounterSnapshot = Readonly<{
  grantedQuantity: number;
  committedQuantity: number;
  reservedQuantity: number;
  refundingQuantity: number;
}>;

export function availablePurchasedRecoveryCredits(
  counter: PurchasedRecoveryCreditCounterSnapshot,
): number {
  for (const [name, value] of Object.entries(counter)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }

  return Math.max(
    counter.grantedQuantity
      - counter.committedQuantity
      - counter.reservedQuantity
      - counter.refundingQuantity,
    0,
  );
}

export const WHATSAPP_PROVIDER_STATUSES = [
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
] as const;
export const WhatsAppProviderStatusSchema = z.enum(WHATSAPP_PROVIDER_STATUSES);
export type WhatsAppProviderStatus = z.infer<typeof WhatsAppProviderStatusSchema>;

const MAX_ID_LENGTH = 128;
const MAX_SHORT_TEXT_LENGTH = 128;

export const BillingSubscriptionReconcileJobSchema = z
  .object({
    schemaVersion: z.literal(BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION),
    shopId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    subscriptionId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    expectedNextReconcileAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BillingSubscriptionReconcileJob = z.infer<
  typeof BillingSubscriptionReconcileJobSchema
>;

export function parseBillingSubscriptionReconcileJob(
  input: unknown,
): BillingSubscriptionReconcileJob {
  return BillingSubscriptionReconcileJobSchema.parse(input);
}

export function safeParseBillingSubscriptionReconcileJob(input: unknown) {
  return BillingSubscriptionReconcileJobSchema.safeParse(input);
}

export const WhatsAppProviderPricingMetadataSchema = z
  .object({
    billable: z.boolean().optional(),
    category: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH).optional(),
    model: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "pricing metadata must not be empty");

export type WhatsAppProviderPricingMetadata = z.infer<
  typeof WhatsAppProviderPricingMetadataSchema
>;

export const NormalizedWhatsAppStatusSchema = z
  .object({
    schemaVersion: z.literal(WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION),
    providerAccountId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    providerPhoneNumberId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    providerMessageId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    status: WhatsAppProviderStatusSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    pricing: WhatsAppProviderPricingMetadataSchema.optional(),
  })
  .strict();

export type NormalizedWhatsAppStatus = z.infer<typeof NormalizedWhatsAppStatusSchema>;

export function parseNormalizedWhatsAppStatus(input: unknown): NormalizedWhatsAppStatus {
  return NormalizedWhatsAppStatusSchema.parse(input);
}

export function safeParseNormalizedWhatsAppStatus(input: unknown) {
  return NormalizedWhatsAppStatusSchema.safeParse(input);
}

function assertKeyPart(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createBillingSubscriptionReconcileJobId(
  subscriptionId: string,
  expectedNextReconcileAt: string,
): string {
  assertKeyPart("subscriptionId", subscriptionId);
  if (subscriptionId.trim().length > MAX_ID_LENGTH) {
    throw new Error(`subscriptionId must be at most ${MAX_ID_LENGTH} characters`);
  }
  z.iso.datetime({ offset: true }).parse(expectedNextReconcileAt);
  return `billing-subscription-reconcile-${fnv1a64(`${subscriptionId.trim()}\u0000${expectedNextReconcileAt}`)}`;
}

function boundedKey(prefix: string, parts: string[], maxLength: number): string {
  const canonical = parts.map((part) => part.trim()).join(":");
  const readable = `${prefix}:${canonical}`;
  if (readable.length <= maxLength) return readable;
  return `${prefix}:h${fnv1a64(canonical)}`;
}

export function createMerchantBillingSystemSourceKey(
  shopId: string,
  code: BillingSystemMessageCode,
  eventIdentity: string,
  version = 1,
): string {
  assertKeyPart("shopId", shopId);
  assertKeyPart("code", code);
  assertKeyPart("eventIdentity", eventIdentity);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("version must be a positive integer");
  }
  return boundedKey("billing-system", [shopId, code, eventIdentity, String(version)], 255);
}

export function createRecoveryIdempotencyKey(shopId: string, recoveryId: string): string {
  assertKeyPart("shopId", shopId);
  assertKeyPart("recoveryId", recoveryId);
  return boundedKey("recovery", [shopId, recoveryId], 255);
}

export function createShopifyUsageIdempotencyKey(
  shopId: string,
  usageEventId: string,
): string {
  assertKeyPart("shopId", shopId);
  assertKeyPart("usageEventId", usageEventId);
  return boundedKey("shopify", [shopId, usageEventId], 64);
}