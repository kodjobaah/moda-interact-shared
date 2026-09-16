import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const recoveryExport = packageJson.exports["./recovery-policy"];
const shopifyExport = packageJson.exports["./shopify"];
const shopifyNodeExport = packageJson.exports["./shopify/node"];

for (const target of [recoveryExport.import, recoveryExport.types, shopifyExport.import, shopifyExport.types, shopifyNodeExport.import, shopifyNodeExport.types]) {
  assert.equal(existsSync(resolve(root, target)), true, `package export target is missing: ${target}`);
}

const recovery = await import("@modainteract/moda-interact-shared/recovery-policy");
const shopify = await import("@modainteract/moda-interact-shared/shopify");
const shopifyNode = await import("@modainteract/moda-interact-shared/shopify/node");

for (const exportName of [
  "RECOVERY_OFFER_MODES",
  "RecoveryOfferModeSchema",
  "EffectiveRecoveryPolicySchema",
  "parseEffectiveRecoveryPolicy",
  "safeParseEffectiveRecoveryPolicy",
]) {
  assert.equal(exportName in recovery, true, `recovery-policy subpath is missing runtime export: ${exportName}`);
}

for (const exportName of [
  "SHOPIFY_WEBHOOK_QUEUE_CONTRACTS",
  "SHOPIFY_DISCOUNT_SYNC_REASONS",
  "SHOPIFY_DISCOUNT_SYNC_WEBHOOK_TOPICS",
  "parseShopifyDiscountSyncJob",
  "safeParseShopifyDiscountSyncJob",
]) {
  assert.equal(exportName in shopify, true, `shopify subpath is missing runtime export: ${exportName}`);
}

for (const exportName of [
  "createShopifyDiscountSyncJobId",
  "createShopifyOrderJobId",
]) {
  assert.equal(exportName in shopifyNode, true, `shopify/node subpath is missing runtime export: ${exportName}`);
}

const declaration = readFileSync(resolve(root, recoveryExport.types), "utf8");
assert.match(declaration, /type RecoveryOfferMode =/, "recovery-policy declaration is missing the RecoveryOfferMode type");
assert.match(declaration, /export \{[\s\S]*\btype EffectiveRecoveryPolicy\b/, "recovery-policy declaration does not export EffectiveRecoveryPolicy");

const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
}))[0];
const packedFiles = new Set(packed.files.map(({ path }) => path));
for (const target of [recoveryExport.import, recoveryExport.types, shopifyExport.import, shopifyExport.types, shopifyNodeExport.import, shopifyNodeExport.types]) {
  assert.equal(packedFiles.has(target.slice(2)), true, `packed artifact is missing export target: ${target}`);
}

console.log("recovery-policy entrypoint and declarations validated");
