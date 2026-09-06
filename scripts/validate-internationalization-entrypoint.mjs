import assert from "node:assert/strict";
import { createInternationalizationRuntime } from "@modainteract/moda-interact-shared/internationalization";

const runtime = createInternationalizationRuntime({
  locale: "en-GB",
  catalogue: { greeting: "Hello, {name}!" },
});

assert.equal(runtime.t("greeting", { name: "Ada" }), "Hello, Ada!");
console.log("internationalization subpath import passed");