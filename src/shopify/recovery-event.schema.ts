import { z } from "zod";
import {
  ShopifyRecoveryEventV2Schema,
  type ShopifyRecoveryEventV2,
} from "./v2/recovery-event.schema.js";
import {
  ShopifyCheckoutUpdatedEventV3Schema,
  type ShopifyCheckoutUpdatedEventV3,
} from "./v3/recovery-event.schema.js";

export const ShopifyRecoveryEventSchema = z.union([
  ShopifyRecoveryEventV2Schema,
  ShopifyCheckoutUpdatedEventV3Schema,
]);

export type ShopifyRecoveryEvent =
  | ShopifyRecoveryEventV2
  | ShopifyCheckoutUpdatedEventV3;

export function parseShopifyRecoveryEvent(input: unknown): ShopifyRecoveryEvent {
  return ShopifyRecoveryEventSchema.parse(input);
}

export function safeParseShopifyRecoveryEvent(input: unknown) {
  return ShopifyRecoveryEventSchema.safeParse(input);
}