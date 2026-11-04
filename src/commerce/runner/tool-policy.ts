import { canonicalJson } from "../canonical-json.js";
import { isBuiltInTool, type GrantedTool, type ToolDescriptor } from "../definitions.js";
import { RunnerFailure } from "./failure.js";
import type { CommerceTurnRuntime } from "./runtime.js";
import type { PreparedCommerceTurn } from "./preflight.js";
import type { RunnerTool } from "./types.js";

export type ToolDenialReason = "INSUFFICIENT_TOOLS" | "TOOL_UNAVAILABLE" | "TOOL_REVOKED";

export async function resolveAvailableTools(
  prepared: PreparedCommerceTurn,
  runtime: CommerceTurnRuntime,
): Promise<ToolDescriptor[]> {
  const available: ToolDescriptor[] = [];
  for (const granted of prepared.grant.grantedTools) {
    const tool = prepared.registered.get(granted.toolName);
    const descriptor = isBuiltInTool(granted)
      ? prepared.manifest.builtInTools.find(candidate => candidate.name === granted.toolName &&
          candidate.definitionVersion === granted.definitionVersion)
      : prepared.manifest.capabilities.map(capability => capability.toolDescriptor)
          .find(candidate => candidate.toolId === granted.toolId);
    if (!tool || !descriptor) continue;
    if (canonicalJson(tool.descriptor) !== canonicalJson(descriptor))
      throw new RunnerFailure("INCOMPATIBLE_VERSION", {
        stage: "tools.resolve", reasonCode: "TOOL_DESCRIPTOR_MISMATCH", toolName: granted.toolName,
      });
    if (await runtime.bounded((signal) => tool.isAuthorized(granted, signal), 10000, {
      stage: "tool.authorize", reasonCode: "TOOL_AUTHORIZATION_FAILED", toolName: granted.toolName,
    }))
      available.push(descriptor);
  }
  return available;
}

export function resolveToolCall(
  name: string,
  prepared: PreparedCommerceTurn,
  availableTools: readonly ToolDescriptor[],
): { grant: GrantedTool; tool: RunnerTool } | { denial: ToolDenialReason } {
  const grant = prepared.grant.grantedTools.find((entry) => entry.toolName === name);
  const tool = prepared.registered.get(name);
  if (!grant) return { denial: "INSUFFICIENT_TOOLS" };
  if (!tool) return { denial: "TOOL_UNAVAILABLE" };
  const pinned = availableTools.find(descriptor => descriptor.name === name);
  if (!pinned) return { denial: "TOOL_REVOKED" };
  if (canonicalJson(pinned) !== canonicalJson(tool.descriptor))
    throw new RunnerFailure("INCOMPATIBLE_VERSION", {
      stage: "tools.resolve", reasonCode: "TOOL_DESCRIPTOR_MISMATCH", toolName: name,
    });
  return { grant, tool };
}