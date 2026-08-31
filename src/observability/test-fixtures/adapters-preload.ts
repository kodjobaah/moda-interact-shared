import { initNodeObservability } from "../node.js";

const runtime = initNodeObservability({
  serviceName: "observability-adapters-smoke",
  environment: "test",
  instrument: { prisma: true },
});

if (!runtime.enabled) {
  throw new Error(`adapter preload failed: ${runtime.error ?? "disabled"}`);
}