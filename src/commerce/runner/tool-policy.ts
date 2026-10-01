import { canonicalJson } from "../canonical-json.js";
import type { GrantedTool, ToolDescriptor } from "../definitions.js";
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
    const descriptor = prepared.manifest.capabilities
      .map((capability) => capability.toolDescriptor)
      .find((candidate) => candidate.toolId === granted.toolId);
    if (!tool || !descriptor) continue;
    if (canonicalJson(tool.descriptor) !== canonicalJson(descriptor))
      throw new RunnerFailure("INCOMPATIBLE_VERSION");
    if (await runtime.bounded((signal) => tool.isAuthorized(granted, signal), 10000))
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
  if (!availableTools.some((descriptor) => descriptor.name === name))
    return { denial: "TOOL_REVOKED" };
  return { grant, tool };
}