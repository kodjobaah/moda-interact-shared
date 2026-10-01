import { Annotation } from "@langchain/langgraph";
import type { CommerceFinalResponse } from "../../response.js";
import type { CommerceEvidence } from "../../schemas.js";
import type { ToolDescriptor } from "../../definitions.js";
import type { ModelStep } from "../types.js";

export type CommerceRuntimeMessage = Readonly<{ tool: string; result: unknown }>;

export const CommerceTurnGraphState = Annotation.Root({
  modelSteps: Annotation<number>(),
  remoteCalls: Annotation<number>(),
  availableTools: Annotation<readonly ToolDescriptor[]>(),
  pendingStep: Annotation<ModelStep | null>(),
  runtimeMessages: Annotation<readonly CommerceRuntimeMessage[]>(),
  evidenceById: Annotation<Readonly<Record<string, CommerceEvidence>>>(),
  requiredReferral: Annotation<CommerceFinalResponse["referralReason"]>(),
  finalResult: Annotation<CommerceFinalResponse | null>(),
});

export type CommerceTurnGraphStateValue = typeof CommerceTurnGraphState.State;

export function initialCommerceTurnGraphState(): CommerceTurnGraphStateValue {
  return {
    modelSteps: 0,
    remoteCalls: 0,
    availableTools: [],
    pendingStep: null,
    runtimeMessages: [],
    evidenceById: {},
    requiredReferral: null,
    finalResult: null,
  };
}