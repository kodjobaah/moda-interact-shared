import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const nodeExport = packageJson.exports["./testing/node"];

for (const target of [nodeExport.import, nodeExport.types]) {
  assert.equal(existsSync(resolve(root, target)), true, `package export target is missing: ${target}`);
}

const testingNode = await import("@modainteract/moda-interact-shared/testing/node");
assert.equal(typeof testingNode.withDisposableIntegrationInfrastructure, "function");
assert.equal(typeof testingNode.deployPrismaMigrations, "function");

const packed = JSON.parse(
  (await import("node:child_process")).execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: root, encoding: "utf8" },
  ),
)[0];
const packedFiles = new Set(packed.files.map(({ path }) => path));
for (const target of [nodeExport.import, nodeExport.types]) {
  assert.equal(packedFiles.has(target.slice(2)), true, `packed artifact is missing export target: ${target}`);
}

console.log("testing/node export and packed artifact validated");