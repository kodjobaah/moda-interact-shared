import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const entrypoints = [
  "./internationalization",
  "./merchant-knowledge",
  "./merchant-knowledge/node",
  "./commerce/runner",
];

for (const entrypoint of entrypoints) {
  const target = packageJson.exports[entrypoint];
  assert.ok(target, `missing package export: ${entrypoint}`);
  for (const file of [target.import, target.types]) {
    assert.equal(existsSync(resolve(root, file)), true, `missing export target: ${file}`);
  }
}

const [internationalization, merchantKnowledge, merchantKnowledgeNode, runner] =
  await Promise.all([
    import("@modainteract/moda-interact-shared/internationalization"),
    import("@modainteract/moda-interact-shared/merchant-knowledge"),
    import("@modainteract/moda-interact-shared/merchant-knowledge/node"),
    import("@modainteract/moda-interact-shared/commerce/runner"),
  ]);

assert.equal(internationalization.resolveModaConfigurationLocale("zh-HK"), "zh-Hant");

const configuration = {
  schemaVersion: 1,
  maxKnowledgeSources: 5,
  maxContentUnitsPerSource: 1500,
  allowedSourceTypes: [
    { purposeKey: "COMPANY_INFORMATION", dataFormatKey: "WEB_PAGE" },
  ],
};
assert.equal(merchantKnowledge.MerchantKnowledgeFeatureConfigurationSchema.safeParse(configuration).success, true);
assert.equal(
  merchantKnowledge.MerchantKnowledgeFeatureConfigurationSchema.safeParse({
    ...configuration,
    allowedSourceTypes: [...configuration.allowedSourceTypes, ...configuration.allowedSourceTypes],
  }).success,
  false,
);
assert.equal(
  merchantKnowledge.MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({
    schemaVersion: 1,
    shopId: "shop-1",
    sourceRevisionId: "revision-1",
    generation: 1,
    requestedAt: "2026-09-30T07:30:00Z",
  }).success,
  true,
);
assert.match(
  merchantKnowledgeNode.createMerchantKnowledgeProcessJobId({
    shopId: "shop-1",
    sourceRevisionId: "revision-1",
    generation: 1,
  }),
  /^merchant-knowledge-process-[0-9a-f]{64}$/,
);
assert.equal(typeof runner.RUNTIME_DATA_AUTHORITY_INSTRUCTION, "string");
assert.equal(
  runner.RUNTIME_DATA_AUTHORITY_INSTRUCTION,
  runner.PLATFORM_INSTRUCTIONS[0],
);

console.log("ARCH-023 Shared package entrypoints validated");
