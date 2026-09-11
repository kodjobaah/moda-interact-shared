import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const billingExport = packageJson.exports["./billing"];

for (const target of [billingExport.import, billingExport.types]) {
  assert.equal(
    existsSync(resolve(root, target)),
    true,
    `package export target is missing: ${target}`,
  );
}

const billing = await import("@modainteract/moda-interact-shared/billing");
for (const exportName of [
  "BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION",
  "BILLING_SUBSCRIPTION_RECONCILE_QUEUE_NAME",
  "BILLING_SUBSCRIPTION_RECONCILE_JOB_NAME",
  "APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS",
  "BILLING_SYSTEM_MESSAGE_CODES",
  "BillingSubscriptionReconcileJobSchema",
  "parseBillingSubscriptionReconcileJob",
  "safeParseBillingSubscriptionReconcileJob",
  "createBillingSubscriptionReconcileJobId",
]) {
  assert.equal(
    exportName in billing,
    true,
    `billing subpath is missing runtime export: ${exportName}`,
  );
}
assert.equal(
  billing.BILLING_SYSTEM_MESSAGE_CODES.RECOVERY_CAPACITY_EXHAUSTED,
  "BILLING_RECOVERY_CAPACITY_EXHAUSTED",
);

const declaration = readFileSync(resolve(root, billingExport.types), "utf8");
assert.match(
  declaration,
  /type BillingSubscriptionReconcileJob = /,
  "billing declaration is missing the BillingSubscriptionReconcileJob type",
);
assert.match(
  declaration,
  /export \{[\s\S]*\btype BillingSubscriptionReconcileJob\b/,
  "billing declaration does not export BillingSubscriptionReconcileJob",
);

const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
  }),
)[0];
const packedFiles = new Set(packed.files.map(({ path }) => path));
for (const target of [billingExport.import, billingExport.types]) {
  assert.equal(
    packedFiles.has(target.slice(2)),
    true,
    `packed artifact is missing export target: ${target}`,
  );
}

console.log("billing entrypoint and declaration validated");
