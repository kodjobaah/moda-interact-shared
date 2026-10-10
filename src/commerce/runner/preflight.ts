import { satisfies } from "semver";
import { ZodError } from "zod";

import { LanguageSourceSchema } from "../../internationalization.js";
import { canonicalJson, jsonBytes } from "../canonical-json.js";
import { LanguageSchema } from "../primitives.js";
import { verifyResponseContract, finalResponseSchema } from "../response.js";
import {
  CommerceConversationGrantSchema,
  CommerceManifestSchema,
  CommerceTurnIdentitySchema,
} from "../schemas.js";
import { manifestMatchesGrant } from "../selection.js";
import { composeTrustedInstructions } from "./instructions.js";
import { RunnerFailure } from "./failure.js";
import { schemaIssueMetadata, type RunnerDiagnosticReason } from "./diagnostics.js";
import { runnerVersion } from "./version.js";
import type { RunCommerceTurnInput, RunnerTool } from "./types.js";

export type CommerceTurnBudgets = {
  modelSteps: number;
  remoteCalls: number;
  deadlineMs: number;
  outputTokens: number;
};

export type PreparedCommerceTurn = {
  turn: ReturnType<typeof CommerceTurnIdentitySchema.parse>;
  grant: ReturnType<typeof CommerceConversationGrantSchema.parse>;
  manifest: NonNullable<ReturnType<typeof CommerceManifestSchema.safeParse>["data"]>;
  response: ReturnType<typeof verifyResponseContract>;
  finalSchema: ReturnType<typeof finalResponseSchema>;
  budgets: CommerceTurnBudgets;
  instructions: readonly string[];
  registered: ReadonlyMap<string, RunnerTool>;
};

function validatePreflight<T>(parse: () => T, code: "INVALID_INPUT" | "INCOMPATIBLE_VERSION", reasonCode: RunnerDiagnosticReason): T {
  try { return parse(); }
  catch (error) {
    throw new RunnerFailure(code, {
      stage: "preflight.validate", reasonCode,
      ...(error instanceof ZodError ? schemaIssueMetadata(error) : {}),
    }, error);
  }
}

export function prepareCommerceTurn(input: RunCommerceTurnInput): PreparedCommerceTurn {
  if (input.signal.aborted) throw new RunnerFailure("CANCELLED", {
    stage: "runtime.cancellation", reasonCode: "CANCELLED_BY_CALLER",
  });
  if (jsonBytes(input.manifest) > 262144 || jsonBytes(input.grant) > 131072)
    throw new RunnerFailure("INVALID_INPUT", { stage: "preflight.validate", reasonCode: "INPUT_TOO_LARGE" });
  const turn = validatePreflight(() => CommerceTurnIdentitySchema.parse(input.turn), "INVALID_INPUT", "TURN_INVALID");
  const grant = validatePreflight(() => CommerceConversationGrantSchema.parse(input.grant), "INVALID_INPUT", "GRANT_INVALID");
  const parsedManifest = CommerceManifestSchema.safeParse(input.manifest);
  if (!parsedManifest.success) throw new RunnerFailure("INCOMPATIBLE_VERSION", {
    stage: "preflight.validate", reasonCode: "MANIFEST_INVALID", ...schemaIssueMetadata(parsedManifest.error),
  }, parsedManifest.error);
  const manifest = parsedManifest.data;
  if (
    !manifestMatchesGrant(manifest, grant) ||
    turn.shopId !== grant.shopId ||
    turn.conversationId !== grant.conversationId ||
    turn.inboundVersion < grant.initialInboundVersion
  ) throw new RunnerFailure("DENIED", { stage: "preflight.contract", reasonCode: "GRANT_MISMATCH" });
  if (!satisfies(runnerVersion, manifest.runnerCompatibility))
    throw new RunnerFailure("INCOMPATIBLE_VERSION", {
      stage: "preflight.contract", reasonCode: "RUNNER_VERSION_INCOMPATIBLE",
    });

  let response: ReturnType<typeof verifyResponseContract>;
  try {
    response = verifyResponseContract(
      manifest.responseContract,
      manifest.responseContractHash,
      input.dependencies.digest,
    );
  } catch (error) {
    throw new RunnerFailure("INCOMPATIBLE_VERSION", {
      stage: "preflight.contract", reasonCode: "RESPONSE_CONTRACT_INVALID",
    }, error);
  }
  const finalSchema = finalResponseSchema(response);
  if (input.language.tag !== null)
    validatePreflight(() => LanguageSchema.parse(input.language.tag), "INVALID_INPUT", "LANGUAGE_INVALID");
  if (input.language.source !== null)
    validatePreflight(() => LanguageSourceSchema.parse(input.language.source), "INVALID_INPUT", "LANGUAGE_INVALID");
  if ((input.language.tag === null) !== (input.language.source === null))
    throw new RunnerFailure("INVALID_INPUT", { stage: "preflight.validate", reasonCode: "LANGUAGE_INVALID" });

  const budgets: CommerceTurnBudgets = {
    modelSteps: 12,
    remoteCalls: 10,
    deadlineMs: 90000,
    outputTokens: 800,
    ...input.budgets,
  };
  for (const key of ["modelSteps", "remoteCalls", "deadlineMs", "outputTokens"] as const) {
    const maximum = { modelSteps: 12, remoteCalls: 10, deadlineMs: 90000, outputTokens: 800 }[key];
    if (!Number.isSafeInteger(budgets[key]) || budgets[key] < 1 || budgets[key] > maximum)
      throw new RunnerFailure("INVALID_INPUT", { stage: "preflight.validate", reasonCode: "BUDGET_INVALID" });
  }
  if (
    input.hostInstructions.some((text) => typeof text !== "string") ||
    input.history.length > 20 ||
    Array.from(canonicalJson(input.history)).length > 32000 ||
    jsonBytes(input.context) + jsonBytes(input.history) > 131072
  ) throw new RunnerFailure("INVALID_INPUT", { stage: "preflight.validate", reasonCode: "CONTEXT_INVALID" });
  const instructions = composeTrustedInstructions(
    input.hostInstructions,
    response.instructions,
    manifest.featureBehaviours.map((feature) => feature.behaviourPrompt),
  );
  if (instructions.join("").length > 64000)
    throw new RunnerFailure("INVALID_INPUT", { stage: "preflight.validate", reasonCode: "CONTEXT_INVALID" });

  const registered = new Map<string, RunnerTool>();
  for (const tool of input.dependencies.tools) {
    if (registered.has(tool.descriptor.name))
      throw new RunnerFailure("INVALID_INPUT", { stage: "preflight.validate", reasonCode: "TOOL_REGISTRATION_INVALID" });
    registered.set(tool.descriptor.name, tool);
  }
  return { turn, grant, manifest, response, finalSchema, budgets, instructions, registered };
}
