import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { encryptCredential, parseCredentialKeyring } from "../security/credentials/node.js";
import {
  readShopifyOAuthConfiguration,
  ShopifyOAuthConfigurationError,
  type ShopifyOAuthConfigurationPrisma,
} from "./oauth-configuration.js";

const environment = "test";
const version = 7;
const keyring = parseCredentialKeyring(JSON.stringify({ active: randomBytes(32).toString("base64") }));
const aad = JSON.stringify(["moda-platform-config-v1", environment, "shopify.oauth", version, 1]);
const envelope = encryptCredential({
  keyring,
  activeKeyId: "active",
  plaintext: JSON.stringify({ apiKey: "app-key", apiSecret: "app-secret" }),
  aad,
});
const serialized = {
  kind: "sealed", schemaVersion: 1, algorithm: "AES-256-GCM", wrappingKeyId: envelope.keyId,
  nonce: Buffer.from(envelope.nonce).toString("base64"),
  ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
  authTag: Buffer.from(envelope.authTag).toString("base64"),
};

function prisma(row: Record<string, unknown> | null, before?: (args: unknown) => void): ShopifyOAuthConfigurationPrisma {
  return { platformConfiguration: { findUnique: async (args) => { before?.(args); return row as never; } } };
}

test("reads App and Background compatible sealed OAuth configuration with exact environment/key/version AAD", async () => {
  let query: unknown;
  const reader = prisma({ environment, key: "shopify.oauth", version, value: serialized }, (args) => { query = args; });
  assert.deepEqual(await readShopifyOAuthConfiguration({ prisma: reader, environment, unsealKeyring: keyring }), { apiKey: "app-key", apiSecret: "app-secret" });
  assert.deepEqual(query, { where: { environment_key: { environment, key: "shopify.oauth" } }, select: { environment: true, key: true, version: true, value: true } });
});

test("missing and disabled configuration fail closed", async () => {
  for (const row of [null, { environment, key: "shopify.oauth", version, value: { kind: "disabled", schemaVersion: 1 } }]) {
    await assert.rejects(readShopifyOAuthConfiguration({ prisma: prisma(row), environment, unsealKeyring: keyring }), (error: unknown) => error instanceof ShopifyOAuthConfigurationError && error.code === "CONFIGURATION_UNAVAILABLE");
  }
});

test("wrong row identity, unsupported envelope, tampered AAD and plaintext payload fail safely", async () => {
  const cases = [
    { environment: "production", key: "shopify.oauth", version, value: serialized },
    { environment, key: "shopify.other", version, value: serialized },
    { environment, key: "shopify.oauth", version: 0, value: serialized },
    { environment, key: "shopify.oauth", version, value: { apiKey: "plaintext", apiSecret: "unsafe" } },
  ];
  for (const row of cases) await assert.rejects(readShopifyOAuthConfiguration({ prisma: prisma(row), environment, unsealKeyring: keyring }), ShopifyOAuthConfigurationError);
  await assert.rejects(readShopifyOAuthConfiguration({ prisma: prisma({ environment, key: "shopify.oauth", version: version + 1, value: serialized }), environment, unsealKeyring: keyring }), (error: unknown) => error instanceof ShopifyOAuthConfigurationError && error.code === "CONFIGURATION_INVALID");
});

test("bad OAuth credentials and database diagnostics never escape the safe boundary", async () => {
  const badPlaintext = encryptCredential({ keyring, activeKeyId: "active", plaintext: JSON.stringify({ apiKey: " key", apiSecret: "canary-secret" }), aad });
  const badEnvelope = {
    kind: "sealed", schemaVersion: 1, algorithm: "AES-256-GCM", wrappingKeyId: badPlaintext.keyId,
    nonce: Buffer.from(badPlaintext.nonce).toString("base64"), ciphertext: Buffer.from(badPlaintext.ciphertext).toString("base64"), authTag: Buffer.from(badPlaintext.authTag).toString("base64"),
  };
  await assert.rejects(readShopifyOAuthConfiguration({ prisma: prisma({ environment, key: "shopify.oauth", version, value: badEnvelope }), environment, unsealKeyring: keyring }), (error: unknown) => error instanceof ShopifyOAuthConfigurationError && !error.message.includes("canary-secret"));
  const dbError = Object.assign(new Error("db password canary"), { code: "P2002" });
  const broken: ShopifyOAuthConfigurationPrisma = { platformConfiguration: { findUnique: async () => { throw dbError; } } };
  await assert.rejects(readShopifyOAuthConfiguration({ prisma: broken, environment, unsealKeyring: keyring }), (error: unknown) => error instanceof ShopifyOAuthConfigurationError && error.code === "CONFIGURATION_UNAVAILABLE" && !error.message.includes("password"));
});

