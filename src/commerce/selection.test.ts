import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CommerceManifestSchema,
  CommerceConversationGrantSchema,
} from "./index";
import {
  selectCapabilities,
  deduplicateTools,
  currentlyGrantedTools,
} from "./selection";
import { exampleManifest, exampleGrant, exampleTool } from "./fixtures";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, true);
const bad = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, false);

test("direct Feature selection preserves plan/opt-in policy and permits no selected capabilities", () => {
  const fresh = {
    key: "feature_product_read",
    featureId: "new-feature",
    enabled: true,
    position: 0,
  };
  const featureFacts = {
    features: [{
      id: "new-feature",
      active: true,
      planMappingEnabled: true,
      mode: "MERCHANT_OPT_IN" as const,
      preferenceEnabled: true,
    }],
  };
  assert.deepEqual(selectCapabilities([fresh], featureFacts), ["feature_product_read"]);
  assert.deepEqual(selectCapabilities([{ ...fresh, enabled: false }], { features: [] }), []);
  assert.deepEqual(selectCapabilities([], { features: [] }), []);
  assert.deepEqual(
    selectCapabilities([fresh], {
      features: [{ ...featureFacts.features[0], active: false }],
    }),
    [],
  );
  assert.deepEqual(
    selectCapabilities([fresh], {
      features: [{ ...featureFacts.features[0], planMappingEnabled: false }],
    }),
    [],
  );
  assert.deepEqual(
    selectCapabilities([fresh], {
      features: [{ ...featureFacts.features[0], preferenceEnabled: null }],
    }),
    [],
  );
  assert.throws(() => selectCapabilities([fresh, fresh], featureFacts));
});

test("direct Tool descriptors deduplicate provenance and conflicting associations reject; grants never widen", () => {
  const tools = deduplicateTools([
    { key: "z_feature", toolDescriptor: exampleTool },
    { key: "a_feature", toolDescriptor: exampleTool },
  ]);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0].capabilityKeys, ["a_feature", "z_feature"]);
  assert.throws(() =>
    deduplicateTools([
      { key: "a", toolDescriptor: exampleTool },
      {
        key: "b",
        toolDescriptor: { ...exampleTool, toolRevisionId: "different" },
      },
    ]),
  );
  const manifest = exampleManifest(digest, true);
  ok(CommerceManifestSchema, manifest);
  const emptyManifest = {
    ...manifest,
    capabilities: [],
    featureBehaviours: [],
    selectedCapabilityKeys: [],
    grantedTools: [],
  };
  ok(CommerceManifestSchema, emptyManifest);
  const grant = exampleGrant(manifest);
  const emptyGrant = {
    ...exampleGrant(emptyManifest),
    selectedCapabilityKeys: [],
    grantedTools: [],
  };
  ok(CommerceConversationGrantSchema, emptyGrant);
  bad(CommerceManifestSchema, { ...manifest, featureBehaviours: [] });
  bad(CommerceManifestSchema, {
    ...manifest,
    featureBehaviours: [{ featureId: "unrepresented", behaviourPrompt: "" }],
  });
  assert.equal(
    currentlyGrantedTools(
      grant,
      new Set(["another_capability"]),
      new Set([exampleTool.toolId]),
    ).length,
    0,
  );
  assert.equal(
    currentlyGrantedTools(
      grant,
      new Set(["feature_product_read"]),
      new Set([exampleTool.toolId]),
    ).length,
    1,
  );
  bad(CommerceManifestSchema, { ...manifest, grantedTools: [] });
  bad(CommerceManifestSchema, { ...manifest, selectedCapabilityKeys: ["other"] });
});