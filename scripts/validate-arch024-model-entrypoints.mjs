import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const browserBundle = await readFile(
  new URL("../dist/commerce/model/index.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  browserBundle,
  /@langchain\/(?:openrouter|core)|OPENROUTER_API_KEY|\bnode:/,
  "browser-safe model entrypoint includes a Node/provider runtime dependency",
);

const cleanEnv = { PATH: "/usr/bin:/bin" };
for (const source of [
  `import * as model from "@modainteract/moda-interact-shared/commerce/model"; if (!model.CommerceModelConfigurationSchema) process.exit(2);`,
  `import * as model from "@modainteract/moda-interact-shared/commerce/model/node"; if (!model.OpenRouterModelClient) process.exit(2);`,
]) {
  execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: packageRoot,
    env: cleanEnv,
    stdio: "pipe",
  });
}

console.log("ARCH-024 model entrypoints are clean and importable without credentials.");