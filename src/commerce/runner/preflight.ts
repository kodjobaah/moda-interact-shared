import { satisfies } from "semver";

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
import { PLATFORM_INSTRUCTIONS, composeTrustedInstructions } from "./instructions.js";
import { RunnerFailure } from "./failure.js";
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

export function prepareCommerceTurn(input: RunCommerceTurnInput): PreparedCommerceTurn {
  if (input.signal.aborted) throw new RunnerFailure("CANCELLED");
  if (jsonBytes(input.manifest) > 262144 || jsonBytes(input.grant) > 131072)
    throw new RunnerFailure("INVALID_INPUT");
  const turn = CommerceTurnIdentitySchema.parse(input.turn);
  const grant = CommerceConversationGrantSchema.parse(input.grant);
  const parsedManifest = CommerceManifestSchema.safeParse(input.manifest);
  if (!parsedManifest.success) throw new RunnerFailure("INCOMPATIBLE_VERSION");
  const manifest = parsedManifest.data;
  if (
    !manifestMatchesGrant(manifest, grant) ||
    turn.shopId !== grant.shopId ||
    turn.conversationId !== grant.conversationId ||
    turn.inboundVersion < grant.initialInboundVersion
  ) throw new RunnerFailure("DENIED");
  if (!satisfies(runnerVersion, manifest.runnerCompatibility))
    throw new RunnerFailure("INCOMPATIBLE_VERSION");

  let response: ReturnType<typeof verifyResponseContract>;
  try {
    response = verifyResponseContract(
      manifest.responseContract,
      manifest.responseContractHash,
      input.dependencies.digest,
    );
  } catch {
    throw new RunnerFailure("INCOMPATIBLE_VERSION");
  }
  const finalSchema = finalResponseSchema(response);
  if (input.language.tag !== null) LanguageSchema.parse(input.language.tag);
  if (input.language.source !== null) LanguageSourceSchema.parse(input.language.source);
  if ((input.language.tag === null) !== (input.language.source === null))
    throw new RunnerFailure("INVALID_INPUT");

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
      throw new RunnerFailure("INVALID_INPUT");
  }
  if (
    input.hostInstructions.some((text) => typeof text !== "string") ||
    input.history.length > 20 ||
    Array.from(canonicalJson(input.history)).length > 32000 ||
    jsonBytes(input.context) + jsonBytes(input.history) > 131072
  ) throw new RunnerFailure("INVALID_INPUT");
  const instructions = composeTrustedInstructions(
    input.hostInstructions,
    response.instructions,
    manifest.featureBehaviours.map((feature) => feature.behaviourPrompt),
  );
  if (instructions.join("").length > 64000) throw new RunnerFailure("INVALID_INPUT");

  const registered = new Map<string, RunnerTool>();
  for (const tool of input.dependencies.tools) {
    if (registered.has(tool.descriptor.name)) throw new RunnerFailure("INVALID_INPUT");
    registered.set(tool.descriptor.name, tool);
  }
  return { turn, grant, manifest, response, finalSchema, budgets, instructions, registered };
}