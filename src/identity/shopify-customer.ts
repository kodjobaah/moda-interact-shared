/** Shopify's numeric customer IDs are decimal strings, not JavaScript numbers.
 * The signed 64-bit bound avoids accidentally accepting out-of-range IDs in
 * consumers that persist or compare them with PostgreSQL BIGINT values.
 */
const SHOPIFY_CUSTOMER_ID_MAX = 9_223_372_036_854_775_807n;
const CUSTOMER_GID_PREFIX = "gid://shopify/Customer/";
const CANONICAL_DECIMAL_ID = /^[1-9][0-9]*$/;

export type ShopifyCustomerIdentityErrorCode =
  | "INVALID_CUSTOMER_ID"
  | "CUSTOMER_ID_OUT_OF_RANGE"
  | "INVALID_SHOP_ID";

/** Never echo an untrusted customer identifier in an error message. */
export class ShopifyCustomerIdentityError extends Error {
  constructor(readonly code: ShopifyCustomerIdentityErrorCode) {
    super(code);
    this.name = "ShopifyCustomerIdentityError";
  }
}

export type ShopifyCustomerIdentity = Readonly<{
  numericId: string;
  gid: string;
}>;

/**
 * Accept exact numeric webhook IDs or exact GraphQL Customer GIDs. A JSON
 * number is accepted only if JS can represent it without precision loss.
 */
export function parseShopifyCustomerIdentity(input: unknown): ShopifyCustomerIdentity {
  const identifier = typeof input === "number"
    ? Number.isSafeInteger(input) && input > 0
      ? String(input)
      : ""
    : typeof input === "string"
      ? input.startsWith(CUSTOMER_GID_PREFIX)
        ? input.slice(CUSTOMER_GID_PREFIX.length)
        : input
      : "";

  if (!CANONICAL_DECIMAL_ID.test(identifier)) {
    throw new ShopifyCustomerIdentityError("INVALID_CUSTOMER_ID");
  }

  // Guard length before BigInt parsing of any externally controlled string.
  if (identifier.length > 19 || BigInt(identifier) > SHOPIFY_CUSTOMER_ID_MAX) {
    throw new ShopifyCustomerIdentityError("CUSTOMER_ID_OUT_OF_RANGE");
  }

  return Object.freeze({ numericId: identifier, gid: `${CUSTOMER_GID_PREFIX}${identifier}` });
}

export function toShopifyCustomerGid(input: unknown): string {
  return parseShopifyCustomerIdentity(input).gid;
}

export function toShopifyCustomerNumericId(input: unknown): string {
  return parseShopifyCustomerIdentity(input).numericId;
}

/** Used by event schemas, which require the canonical decimal string form. */
export function isShopifyCustomerNumericId(input: unknown): input is string {
  if (typeof input !== "string") return false;
  try {
    return parseShopifyCustomerIdentity(input).numericId === input;
  } catch {
    return false;
  }
}

/**
 * Identity comparison is always scoped to a shop. It does NOT authenticate
 * either shop or establish that the caller may access either customer.
 */
export function areSameShopifyCustomerWithinShop(
  first: { shopId: string; customerId: unknown },
  second: { shopId: string; customerId: unknown },
): boolean {
  for (const shopId of [first.shopId, second.shopId]) {
    if (typeof shopId !== "string" || shopId.length === 0 || shopId.length > 128 ||
        shopId.trim() !== shopId || /\s/.test(shopId)) {
      throw new ShopifyCustomerIdentityError("INVALID_SHOP_ID");
    }
  }

  const firstId = toShopifyCustomerNumericId(first.customerId);
  const secondId = toShopifyCustomerNumericId(second.customerId);
  return first.shopId === second.shopId && firstId === secondId;
}
