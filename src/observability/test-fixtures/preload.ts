import { initNodeObservability } from "../node.js";

const runtime = initNodeObservability({
  serviceName: "observability-preload-smoke",
  environment: "production",
  instrument: {
    http: true,
    fetch: true,
  },
});

if (!runtime.enabled) {
  throw new Error(`observability preload failed: ${runtime.error ?? "disabled"}`);
}