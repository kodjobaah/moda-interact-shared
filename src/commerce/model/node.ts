import type { CommerceModelInvoker } from "../runner/index.js";
import {
  createOpenRouterInvoker,
  type OpenRouterModelClientOptions,
} from "./openrouter-model-client.internal.js";

export type { OpenRouterModelClientOptions } from "./openrouter-model-client.internal.js";

export class OpenRouterModelClient implements CommerceModelInvoker {
  private readonly invoker: ReturnType<typeof createOpenRouterInvoker>;

  constructor(options: OpenRouterModelClientOptions) {
    this.invoker = createOpenRouterInvoker(options);
  }

  invoke(request: Parameters<CommerceModelInvoker["invoke"]>[0], signal: AbortSignal) {
    return this.invoker.invoke(request, signal);
  }
}