import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const exportTarget = pkg.exports["./whatsapp-template-events"];
const fixtureTarget = pkg.exports["./whatsapp-template-events/fixtures"];
assert.deepEqual(exportTarget, {
  types: "./dist/whatsapp-template-events.d.ts",
  import: "./dist/whatsapp-template-events.js",
});
assert.equal(fixtureTarget, "./fixtures/meta-template-status-v2.json");
for (const path of [exportTarget.types, exportTarget.import, fixtureTarget]) {
  assert.ok(existsSync(resolve(root, path)), `Missing public export target: ${path}`);
}

const exported = await import("@modainteract/moda-interact-shared/whatsapp-template-events");
for (const name of [
  "META_TEMPLATE_STATUS_QUEUE", "META_TEMPLATE_STATUS_JOB", "META_TEMPLATE_STATUS_SCHEMA_VERSION",
  "MetaTemplateStatusObservationV2Schema", "formatMetaTemplateStatusEventIdentity",
  "formatMetaTemplateStatusJobId",
]) assert.ok(name in exported, `Missing runtime API ${name}`);

const fixture = JSON.parse(readFileSync(resolve(root, fixtureTarget), "utf8"));
const payload = exported.MetaTemplateStatusObservationV2Schema.parse(fixture.observation);
assert.equal(payload.eventIdentity, exported.formatMetaTemplateStatusEventIdentity("550e8400-e29b-41d4-a716-446655440000"));
assert.equal(fixture.expectedJobId, exported.formatMetaTemplateStatusJobId("550e8400-e29b-41d4-a716-446655440000"));

const declaration = readFileSync(resolve(root, exportTarget.types), "utf8");
assert.match(declaration, /MetaTemplateStatusObservationV2/);
const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root, encoding: "utf8",
}))[0];
const packedFiles = new Set(packed.files.map(({path}) => path));
for (const path of [exportTarget.import, exportTarget.types, fixtureTarget]) {
  assert.ok(packedFiles.has(path.slice(2)), `Public export missing from tarball: ${path}`);
}
const source = readFileSync(resolve(root, "src/whatsapp-template-events.ts"), "utf8");
assert.doesNotMatch(source, /from\s*["']node:/, "This entrypoint must remain browser-safe");
console.log("ARCH-047 Meta status v2 subpath, fixture and npm tarball validated");
