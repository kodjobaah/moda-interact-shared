import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
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
