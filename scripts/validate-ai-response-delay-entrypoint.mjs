import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const entry = packageJson.exports["./ai-response-delay"];

assert.deepEqual(entry, {
  types: "./dist/ai-response-delay.d.ts",
  import: "./dist/ai-response-delay.js",
});
assert.equal(existsSync(resolve(root, entry.import)), true, "built JavaScript export is missing");
assert.equal(existsSync(resolve(root, entry.types)), true, "built declaration export is missing");

const declaration = readFileSync(resolve(root, entry.types), "utf8");
for (const exportName of [
  "AI_RESPONSE_DELAY_SCHEMA_VERSION",
  "AiResponseDelayMinutesSchema",
  "AiResponseDelayRevisionSchema",
  "MerchantAiResponseDelayReadV1Schema",
  "MerchantAiResponseDelayWriteV1Schema",
  "AiResponseDelayMinutes",
  "AiResponseDelayRevision",
  "MerchantAiResponseDelayReadV1",
  "MerchantAiResponseDelayWriteV1",
]) {
  assert.match(declaration, new RegExp(`\\b${exportName}\\b`), `declaration is missing ${exportName}`);
}

const published = await import("@modainteract/moda-interact-shared/ai-response-delay");
for (const exportName of [
  "AI_RESPONSE_DELAY_SCHEMA_VERSION",
  "AiResponseDelayMinutesSchema",
  "AiResponseDelayRevisionSchema",
  "MerchantAiResponseDelayReadV1Schema",
  "MerchantAiResponseDelayWriteV1Schema",
]) {
  assert.equal(exportName in published, true, `package subpath is missing ${exportName}`);
}

console.log("ai-response-delay package entrypoint and declarations validated");
