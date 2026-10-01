import type { Digest } from "../canonical-json.js";
import type { CommerceFinalResponse } from "../response.js";
import type {
  CommerceConversationGrant,
  CommerceManifest,
  CommerceToolResult,
  CommerceTurnIdentity,
} from "../schemas.js";
import type { GrantedTool, ToolDescriptor } from "../definitions.js";
import type { StructuredLogger } from "../../logging/index.js";

export type ModelCall = { name: string; arguments: unknown };
export type ModelStep = { calls: ModelCall[]; outputTokens: number };
export type ModelRequest = {
  instructions: readonly string[];
  context: unknown;
  history: readonly unknown[];
  messages: readonly unknown[];
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  maxOutputTokens: number;
};
export type CommerceModelInvoker = {
  invoke(request: ModelRequest, signal: AbortSignal): Promise<ModelStep>;
};
export type RunnerTool = {
  descriptor: ToolDescriptor;
  isAuthorized: (tool: GrantedTool, signal: AbortSignal) => Promise<boolean>;
  execute: (arguments_: Record<string, unknown>, signal: AbortSignal) => Promise<CommerceToolResult>;
  extractEvidence?: (result: CommerceToolResult) => unknown[];
};
export type RunCommerceTurnInput = {
  turn: CommerceTurnIdentity;
  grant: CommerceConversationGrant;
  manifest: CommerceManifest;
  hostInstructions: readonly string[];
  context: unknown;
  history: readonly unknown[];
  language: { tag: string | null; source: string | null };
  signal: AbortSignal;
  dependencies: {
    model: CommerceModelInvoker;
    tools: RunnerTool[];
    now: () => number;
    digest: Digest;
    logger?: StructuredLogger;
  };
  budgets?: {
    modelSteps?: number;
    remoteCalls?: number;
    deadlineMs?: number;
    outputTokens?: number;
  };
};
export type RunnerErrorCode =
  | "INVALID_INPUT" | "INVALID_FINAL" | "BUDGET_EXHAUSTED" | "CANCELLED"
  | "DEADLINE" | "UNAVAILABLE" | "DENIED" | "STALE_TURN" | "INCOMPATIBLE_VERSION";
export type RunCommerceTurnResult =
  | { ok: true; result: CommerceFinalResponse; usage: { modelSteps: number; remoteCalls: number } }
  | { ok: false; error: { code: RunnerErrorCode; retryable: boolean } };