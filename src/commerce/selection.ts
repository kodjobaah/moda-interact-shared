import { IdSchema } from "./primitives";
import {
  type CommerceManifest,
  CommerceManifestSchema,
  type CommerceConversationGrant,
  CommerceConversationGrantSchema,
} from "./schemas";
import { GrantedToolsSchema, PublishedToolDescriptorSchema, type GrantedTool, type PublishedGrantedTool, type PublishedToolDescriptor, type CommerceBuiltInToolDescriptor, isBuiltInTool } from "./definitions";
import { isTrustedCommerceBuiltInDescriptor, isTrustedCommerceBuiltInGrant } from "./built-in-tools";
import { canonicalJson } from "./canonical-json";
export type FeatureFacts = {
  id: string;
  active: boolean;
  planMappingEnabled: boolean;
  mode: "ALWAYS_ENABLED" | "MERCHANT_OPT_IN";
  preferenceEnabled: boolean | null;
};
export function selectCapabilities(
  candidates: Array<{
    key: string;
    featureId: string;
    enabled: boolean;
    position: number;
  }>,
  facts: {
    features: FeatureFacts[];
  },
) {
  for (const candidate of candidates) {
    IdSchema.parse(candidate.key);
    IdSchema.parse(candidate.featureId);
    if (!Number.isSafeInteger(candidate.position) || candidate.position < 0)
      throw new TypeError("Invalid capability position");
  }
  const selected = candidates
    .filter((c) => {
      if (!c.enabled) return false;
      const f = facts.features.find((f) => f.id === c.featureId);
      return (
        !!f &&
        f.active &&
        f.planMappingEnabled &&
        (f.mode === "ALWAYS_ENABLED" || f.preferenceEnabled === true)
      );
    })
    .sort((a, b) => a.position - b.position);
  if (
    new Set(selected.map((c) => c.key)).size !== selected.length ||
    new Set(selected.map((c) => c.position)).size !== selected.length
  )
    throw new TypeError("Duplicate release membership");
  return selected.map((c) => c.key);
}
export function deduplicateTools(
  capabilities: Array<{ key: string; toolDescriptor: PublishedToolDescriptor }>,
  builtInTools: readonly CommerceBuiltInToolDescriptor[] = [],
): GrantedTool[] {
  const byId = new Map<string, { tool: PublishedGrantedTool; descriptor: string }>();
  const names = new Map<string, string>();
  for (const cap of capabilities) {
    const d = PublishedToolDescriptorSchema.parse(cap.toolDescriptor);
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
  if (builtInTools.some(tool => !isTrustedCommerceBuiltInDescriptor(tool)))
    throw new TypeError("Untrusted built-in descriptor");
  return GrantedToolsSchema.parse([
    ...[...byId.values()].map(value => value.tool),
    ...builtInTools.map(tool => ({
      kind: "BUILT_IN" as const, toolName: tool.name,
      definitionVersion: tool.definitionVersion, contractHash: tool.contractHash,
    })),
  ]).sort((a, b) => a.toolName.localeCompare(b.toolName, "en"));
}
export function manifestMatchesGrant(
  manifest: CommerceManifest,
  grant: CommerceConversationGrant,
) {
  if (!CommerceManifestSchema.safeParse(manifest).success || !CommerceConversationGrantSchema.safeParse(grant).success) return false;
  return (
    manifest.releaseId === grant.releaseId &&
    canonicalJson(manifest.selectedCapabilityKeys) ===
      canonicalJson(grant.selectedCapabilityKeys) &&
    canonicalJson(
      [...manifest.grantedTools].sort((a, b) =>
        a.toolName.localeCompare(b.toolName),
      ),
    ) ===
      canonicalJson(
        [...grant.grantedTools].sort((a, b) =>
          a.toolName.localeCompare(b.toolName),
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
  allowedBuiltInTools: readonly CommerceBuiltInToolDescriptor[] = [],
) {
  return grant.grantedTools.filter(
    (t) =>
      isBuiltInTool(t)
        ? isTrustedCommerceBuiltInGrant(t) && allowedBuiltInTools.some(descriptor =>
            isTrustedCommerceBuiltInDescriptor(descriptor) && descriptor.name === t.toolName &&
            descriptor.definitionVersion === t.definitionVersion && descriptor.contractHash === t.contractHash)
        : enabledToolIds.has(t.toolId) && t.capabilityKeys.some((k) => eligibleCapabilityKeys.has(k)),
  );
}
