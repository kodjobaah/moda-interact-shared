import assert from "node:assert/strict";
import test from "node:test";
import {
  createStoreCategoryPromptConditionBlock,
  createStoreCategoryPromptContext,
  MAX_STORE_CATEGORY_PROMPT_SOURCE_CHARS,
  renderStoreCategoryPromptTemplate,
  StoreCategoryPromptConditionKeySchema,
  validateStoreCategoryPromptTemplate,
} from "./store-category-prompt";

test("accepts stable mapping condition keys and rejects unsafe names", () => {
  assert.equal(StoreCategoryPromptConditionKeySchema.safeParse("shoes").success, true);
  assert.equal(StoreCategoryPromptConditionKeySchema.safeParse("formal_shoes_2").success, true);
  assert.equal(StoreCategoryPromptConditionKeySchema.safeParse("Shoes").success, false);
  assert.equal(StoreCategoryPromptConditionKeySchema.safeParse("constructor").success, false);
  assert.equal(StoreCategoryPromptConditionKeySchema.safeParse("shoes-and-boots").success, false);
});

test("generates canonical condition insertion blocks", () => {
  assert.equal(
    createStoreCategoryPromptConditionBlock("shoes"),
    "{% if mappings.shoes %}\n\n{% endif %}",
  );
  assert.throws(() => createStoreCategoryPromptConditionBlock("Shoes"), /Invalid mapping condition key/);
});

test("validates the bounded conditional prompt language", () => {
  const source = `Base instructions.\n{% if mappings.shoes and not mappings.handbags %}\nFootwear instructions.\n{% elif mappings.handbags or mappings.dresses %}\nFashion accessory instructions.\n{% else %}\nGeneric apparel instructions.\n{% endif %}`;
  const result = validateStoreCategoryPromptTemplate({
    source,
    availableConditionKeys: ["shoes", "handbags", "dresses"],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.referencedConditionKeys, ["shoes", "handbags", "dresses"]);
});

test("supports nested conditions and parenthesized boolean expressions", () => {
  const source = `{% if mappings.shoes and (mappings.boots or mappings.trainers) %}footwear{% if not mappings.kids %}-adult{% endif %}{% endif %}`;
  const result = validateStoreCategoryPromptTemplate({
    source,
    availableConditionKeys: ["shoes", "boots", "trainers", "kids"],
  });
  assert.equal(result.valid, true);
});

test("rejects unknown conditions and unsupported nunjucks constructs", () => {
  const unknown = validateStoreCategoryPromptTemplate({
    source: "{% if mappings.shoes %}shoe{% endif %}",
    availableConditionKeys: ["handbags"],
  });
  assert.equal(unknown.valid, false);
  assert(unknown.issues.some((entry) => entry.code === "unknown_mapping_condition"));

  for (const source of [
    "{{ mappings.shoes }}",
    "{# comment #}",
    "{% for item in mappings %}x{% endfor %}",
    "{% if mappings.shoes == true %}x{% endif %}",
    "{% set x = mappings.shoes %}",
  ]) {
    const result = validateStoreCategoryPromptTemplate({ source, availableConditionKeys: ["shoes"] });
    assert.equal(result.valid, false, source);
    assert(result.issues.some((entry) => entry.code === "unsupported_template_construct" || entry.code === "invalid_template_expression"));
  }
});

test("rejects malformed conditional structure", () => {
  const result = validateStoreCategoryPromptTemplate({
    source: "{% if mappings.shoes %}shoe{% else %}other{% else %}again{% endif %}",
    availableConditionKeys: ["shoes"],
  });
  assert.equal(result.valid, false);
  assert(result.issues.some((entry) => entry.code === "invalid_template_structure"));
});

test("renders a concrete prompt from selected mapping conditions", () => {
  const source = `Base.\n{% if mappings.shoes %}Shoes.\n{% endif %}{% if mappings.handbags %}Handbags.\n{% else %}No handbags.\n{% endif %}`;
  const context = createStoreCategoryPromptContext({
    availableConditionKeys: ["shoes", "handbags"],
    selectedConditionKeys: ["shoes"],
  });
  const result = renderStoreCategoryPromptTemplate({ source, context });
  assert.deepEqual(result, {
    ok: true,
    promptText: "Base.\nShoes.\nNo handbags.\n",
    referencedConditionKeys: ["shoes", "handbags"],
  });
});

test("renders elif branches deterministically", () => {
  const source = "{% if mappings.shoes %}shoes{% elif mappings.handbags %}bags{% else %}other{% endif %}";
  const context = createStoreCategoryPromptContext({
    availableConditionKeys: ["shoes", "handbags"],
    selectedConditionKeys: ["handbags"],
  });
  assert.deepEqual(renderStoreCategoryPromptTemplate({ source, context }), {
    ok: true,
    promptText: "bags",
    referencedConditionKeys: ["shoes", "handbags"],
  });
});

test("context creation rejects selected mappings outside the available contract", () => {
  assert.throws(
    () => createStoreCategoryPromptContext({ availableConditionKeys: ["shoes"], selectedConditionKeys: ["handbags"] }),
    /unavailable/,
  );
});

test("bounds prompt source size", () => {
  const result = validateStoreCategoryPromptTemplate({
    source: "x".repeat(MAX_STORE_CATEGORY_PROMPT_SOURCE_CHARS + 1),
    availableConditionKeys: [],
  });
  assert.equal(result.valid, false);
  assert(result.issues.some((entry) => entry.code === "invalid_prompt_source"));
});
