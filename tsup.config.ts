import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    internationalization: "src/internationalization.ts",
    billing: "src/billing.ts",
    "merchant-communications": "src/merchant-communications.ts",
    "merchant-communications/node": "src/merchant-communications.node.ts",
    "testing/node": "src/testing/node.ts",
    "shopify/index": "src/shopify/index.ts",
    "shopify/node": "src/shopify/node.ts",
    "logging/index": "src/logging/index.ts",
    "logging/node": "src/logging/node.ts",
    "observability/index": "src/observability/index.ts",
    "observability/node": "src/observability/node.ts",
    "observability/bullmq": "src/observability/bullmq.ts",
    "observability/genai": "src/observability/genai.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
