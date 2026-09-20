/** Synthetic examples; no provider identity, schema artifact or publication claim. */
import type {
  CommerceManifest,
  CommerceConversationGrant,
  CommerceTurnIdentity,
} from "./schemas";
import {
  EMPTY_RESPONSE_CONTRACT,
  type CommerceFinalResponse,
} from "./response";
import type { Digest } from "./canonical-json";
import { responseContractCanonicalJson } from "./canonical-json";
import type { ToolDescriptor, CommerceToolDefinition } from "./definitions";
export const exampleTool: ToolDescriptor = {
  toolId: "tool-fixture",
  toolRevisionId: "revision-fixture",
  name: "never_seeded_catalogue_facts",
  definitionVersion: "1.0.0",
  description: "Read synthetic catalogue facts.",
  inputSchema: {
    type: "object",
    properties: { handle: { type: "string", minLength: 1, maxLength: 255 } },
    required: ["handle"],
    additionalProperties: false,
  },
};
export const exampleDefinition: CommerceToolDefinition = {
  name: exampleTool.name,
  definitionVersion: "1.0.0",
  description: exampleTool.description,
  inputSchema: exampleTool.inputSchema,
  execution: {
    kind: "SHOPIFY_STOREFRONT_QUERY",
    executorVersion: "1.0.0",
    apiVersion: "2026-07",
    schemaHash: "a".repeat(64),
    document:
      "query ProductDetails($handle: String!) { product(handle: $handle) { title description } }",
    operationName: "ProductDetails",
    variables: { handle: { input: "handle" } },
    resultPath: "product",
  },
  responseTemplate: {
    kind: "text",
    text: "{{result.values.title}}: {{result.values.description}}",
    unavailable: "Product details could not be verified.",
  },
};
export const exampleTurn: CommerceTurnIdentity = {
  contractVersion: "commerce.v1",
  shopId: "shop-fixture",
  checkoutRecoveryId: "recovery-fixture",
  conversationId: "conversation-fixture",
  inboundVersion: 1,
};
export function exampleManifest(
  digest: Digest,
  withTool = false,
): CommerceManifest {
  const capabilities = [
    {
      key: "conversation_core",
      revisionId: "core-revision",
      position: 0,
      promptName: "commerce/release-fixture/conversation_core/core-revision",
      configuration: {},
      toolDescriptors: withTool ? [structuredClone(exampleTool)] : [],
    },
  ];
  return {
    contractVersion: "commerce.v1",
    releaseId: "release-fixture",
    runnerCompatibility: "^1.0.0",
    capabilities,
    selectedCapabilityKeys: ["conversation_core"],
    grantedTools: withTool
      ? [
          {
            toolId: exampleTool.toolId,
            toolRevisionId: exampleTool.toolRevisionId,
            toolName: exampleTool.name,
            definitionVersion: "1.0.0",
            capabilityKeys: ["conversation_core"],
          },
        ]
      : [],
    responseContract: structuredClone(EMPTY_RESPONSE_CONTRACT),
    responseContractHash: digest(
      responseContractCanonicalJson(EMPTY_RESPONSE_CONTRACT),
    ),
  };
}
export function exampleGrant(
  manifest: CommerceManifest,
): CommerceConversationGrant {
  return {
    id: "grant-fixture",
    shopId: exampleTurn.shopId,
    conversationId: exampleTurn.conversationId,
    initialInboundVersion: 1,
    releaseId: manifest.releaseId,
    selectedCapabilityKeys: [...manifest.selectedCapabilityKeys],
    grantedTools: structuredClone(manifest.grantedTools),
    runnerVersion: "1.0.0",
    createdAt: "2026-09-20T00:00:00.000Z",
    expiresAt: null,
  };
}
export const exampleFinal: CommerceFinalResponse = {
  answerKind: "REFER_TO_STORE",
  replyText:
    "I cannot verify that information. Please contact the store directly.",
  referralReason: "INSUFFICIENT_TOOLS",
  detectedLanguageTag: null,
  detectedLanguageConfidence: null,
  evidenceIds: [],
  details: {},
};
