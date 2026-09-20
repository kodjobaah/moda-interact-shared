import { z } from "zod";
import { IdSchema } from "./primitives";
import {
  type CommerceManifest,
  CommerceManifestSchema,
  type CommerceConversationGrant,
} from "./schemas";
import { type GrantedTool, type ToolDescriptor } from "./definitions";
import { canonicalJson } from "./canonical-json";
export const CommerceCapabilityBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("BASE"),
    key: z.literal("conversation_core"),
  }),
  z.strictObject({
    kind: z.literal("FEATURE"),
    key: IdSchema,
    featureId: IdSchema,
  }),
  z.strictObject({
    kind: z.literal("RECOVERY_POLICY"),
    key: z.literal("discount_assistance"),
  }),
]);
export type CommerceCapabilityBinding = z.infer<
  typeof CommerceCapabilityBindingSchema
>;
export type FeatureFacts = {
  id: string;
  active: boolean;
  planMappingEnabled: boolean;
  mode: "ALWAYS_ENABLED" | "MERCHANT_OPT_IN";
  preferenceEnabled: boolean | null;
};
export function selectCapabilities(
  candidates: Array<{
    binding: CommerceCapabilityBinding;
    enabled: boolean;
    position: number;
  }>,
  facts: {
    features: FeatureFacts[];
    offerMode: "NONE" | "FIXED" | "AI_BEST_APPLICABLE" | null;
  },
) {
  const selected = candidates
    .filter((c) => {
      const b = CommerceCapabilityBindingSchema.parse(c.binding);
      if (!c.enabled) return false;
      if (b.kind === "BASE") return true;
      if (b.kind === "RECOVERY_POLICY")
        return (
          facts.offerMode === "FIXED" ||
          facts.offerMode === "AI_BEST_APPLICABLE"
        );
      const f = facts.features.find((f) => f.id === b.featureId);
      return (
        !!f &&
        f.active &&
        f.planMappingEnabled &&
        (f.mode === "ALWAYS_ENABLED" || f.preferenceEnabled === true)
      );
    })
    .sort((a, b) => a.position - b.position);
  if (!selected.some((c) => c.binding.kind === "BASE"))
    throw new TypeError("Base capability unavailable");
  if (
    new Set(selected.map((c) => c.binding.key)).size !== selected.length ||
    new Set(selected.map((c) => c.position)).size !== selected.length
  )
    throw new TypeError("Duplicate release membership");
  return selected.map((c) => c.binding.key);
}
export function deduplicateTools(
  capabilities: Array<{ key: string; toolDescriptors: ToolDescriptor[] }>,
): GrantedTool[] {
  const byId = new Map<string, { tool: GrantedTool; descriptor: string }>();
  const names = new Map<string, string>();
  for (const cap of capabilities)
    for (const d of cap.toolDescriptors) {
      const previous = byId.get(d.toolId);
      const descriptor = canonicalJson(d);
      if (
        (previous && previous.descriptor !== descriptor) ||
        (names.has(d.name) && names.get(d.name) !== d.toolId)
      )
        throw new TypeError("Conflicting tool association");
      names.set(d.name, d.toolId);
      if (previous)
        previous.tool.capabilityKeys = [
          ...new Set([...previous.tool.capabilityKeys, cap.key]),
        ].sort();
      else
        byId.set(d.toolId, {
          descriptor,
          tool: {
            toolId: d.toolId,
            toolRevisionId: d.toolRevisionId,
            toolName: d.name,
            definitionVersion: d.definitionVersion,
            capabilityKeys: [cap.key],
          },
        });
    }
  return [...byId.values()]
    .map((v) => v.tool)
    .sort((a, b) => a.toolName.localeCompare(b.toolName, "en"));
}
export function manifestMatchesGrant(
  manifest: CommerceManifest,
  grant: CommerceConversationGrant,
) {
  return (
    manifest.releaseId === grant.releaseId &&
    canonicalJson(manifest.selectedCapabilityKeys) ===
      canonicalJson(grant.selectedCapabilityKeys) &&
    canonicalJson(
      [...manifest.grantedTools].sort((a, b) =>
        a.toolId.localeCompare(b.toolId),
      ),
    ) ===
      canonicalJson(
        [...grant.grantedTools].sort((a, b) =>
          a.toolId.localeCompare(b.toolId),
        ),
      )
  );
}
export const parseCommerceManifest = (raw: unknown) =>
  CommerceManifestSchema.parse(raw);
export function currentlyGrantedTools(
  grant: CommerceConversationGrant,
  eligibleCapabilityKeys: ReadonlySet<string>,
  enabledToolIds: ReadonlySet<string>,
) {
  return grant.grantedTools.filter(
    (t) =>
      enabledToolIds.has(t.toolId) &&
      t.capabilityKeys.some((k) => eligibleCapabilityKeys.has(k)),
  );
}
