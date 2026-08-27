import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "shopify/index": "src/shopify/index.ts",
    "shopify/node": "src/shopify/node.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
