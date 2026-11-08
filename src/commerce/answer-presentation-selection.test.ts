import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { CommerceAnswerPresentationSelectionSchema, CommerceResponseDispositionSchema, verifyCommerceAnswerPresentationSelection } from "./index.js";
import { verifyCommerceProductFacts } from "./presentation/index.js";
const pair = { productId: "p1", variantId: null };
test("public detail selection is bounded, exact and strict", () => {
  assert.equal(CommerceResponseDispositionSchema.parse("PRODUCT_DETAILS"), "PRODUCT_DETAILS");
  assert.deepEqual(CommerceAnswerPresentationSelectionSchema.parse({productDetailSelections:[pair],responseDisposition:"PRODUCT_DETAILS"}), {productDetailSelections:[pair],responseDisposition:"PRODUCT_DETAILS"});
  for (const value of [[pair,pair],Array.from({length:4},(_,i)=>({...pair,productId:String(i)})),[{...pair,productId:""}],[{...pair,variantId:4}],[{...pair,description:"invented"}]])
    assert.equal(CommerceAnswerPresentationSelectionSchema.safeParse({productDetailSelections:value}).success,false);
  assert.equal(CommerceAnswerPresentationSelectionSchema.safeParse({arbitraryFacts:[]}).success,false);
});
test("canonical verifier refuses mixed selections without precedence", () => {
  assert.deepEqual(verifyCommerceAnswerPresentationSelection({productOptionSelections:[pair],productDetailSelections:[pair]}), {kind:"limitation",reason:"INVALID_SELECTION"});
  assert.deepEqual(verifyCommerceAnswerPresentationSelection({productDetailSelections:[pair,pair]}), {kind:"limitation",reason:"INVALID_SELECTION"});
  assert.equal(verifyCommerceAnswerPresentationSelection({productOptionSelections:[],productDetailSelections:[pair]}).kind,"verified");
  assert.deepEqual(verifyCommerceProductFacts([pair,pair],[]),{kind:"limitation",reason:"INVALID_SELECTION"});
});
test("legacy options and strict shape composition remain compatible", () => {
  const legacy={productOptionSelections:[pair],responseDisposition:"PRODUCT_OPTIONS"};
  assert.deepEqual(CommerceAnswerPresentationSelectionSchema.parse(legacy),legacy);
  assert.deepEqual(CommerceAnswerPresentationSelectionSchema.parse({}),{});
  const projected = z.strictObject({other:z.string()}).extend(CommerceAnswerPresentationSelectionSchema.shape);
  assert.equal(projected.safeParse({other:"x",productDetailSelections:[pair],responseDisposition:"PRODUCT_DETAILS"}).success,true);
  assert.equal(projected.safeParse({other:"x",unknown:1}).success,false);
});

test("JSON authoring projection retains bounded strict detail identities", () => {
  const schema = z.toJSONSchema(CommerceAnswerPresentationSelectionSchema, {io:"output",unrepresentable:"any"});
  const detail = schema.properties!.productDetailSelections!;
  assert.equal(typeof detail,"object");
  if (typeof detail !== "object") throw new Error("Missing detail projection");
  assert.equal(detail.type,"array");
  assert.equal(detail.maxItems,3);
  assert.equal((detail.items as Record<string, unknown>).additionalProperties,false);
  const disposition = schema.properties!.responseDisposition!;
  if (typeof disposition !== "object") throw new Error("Missing disposition projection");
  assert.equal(disposition.enum!.includes("PRODUCT_DETAILS"),true);
  assert.equal(schema.additionalProperties,false);
});
