import { recommendationMessage } from "./messages.js";
import { z } from "zod";
import { CommerceProductSchema, CommerceProductOptionsSchema, CommerceProductSelectedOptionsSchema } from "../schemas.js";
import { type ModaSupportedLanguageTag } from "../../internationalization.js";
export const CommerceOptionFactSchema = z.strictObject({productId:z.string().min(1).max(128),variantId:z.string().min(1).max(128).nullable(),title:z.string().min(1).max(512),options:CommerceProductOptionsSchema,selectedOptions:CommerceProductSelectedOptionsSchema});
export type CommerceOptionFact = z.infer<typeof CommerceOptionFactSchema>;
export function verifyCommerceOptionFacts(selection: readonly {productId:string;variantId:string|null}[], currentProducts: readonly unknown[]): {kind:"verified";optionFacts:CommerceOptionFact[]}|{kind:"limitation";reason:"INVALID_SELECTION"|"PRODUCT_NOT_FOUND"|"PRODUCT_INVALID"} {
 const parsed=z.array(z.strictObject({productId:z.string().min(1).max(128),variantId:z.string().min(1).max(128).nullable()})).max(3).safeParse(selection);
 if(!parsed.success||new Set(selection.map(s=>JSON.stringify([s.productId,s.variantId]))).size!==selection.length)return {kind:"limitation",reason:"INVALID_SELECTION"};
 const facts:CommerceOptionFact[]=[];
 for(const selected of parsed.data){const matches=currentProducts.filter(p=>p&&typeof p==="object"&&(p as {productId?:unknown}).productId===selected.productId&&(p as {variantId?:unknown}).variantId===selected.variantId);if(matches.length!==1)return {kind:"limitation",reason:"PRODUCT_NOT_FOUND"};const product=CommerceProductSchema.safeParse(matches[0]);if(!product.success)return {kind:"limitation",reason:"PRODUCT_INVALID"};facts.push({productId:product.data.productId,variantId:product.data.variantId,title:product.data.title,options:product.data.options??{status:"PARTIAL",items:[]},selectedOptions:product.data.selectedOptions??[]});}
 return {kind:"verified",optionFacts:facts};
}
export function renderProductOptionFacts(facts:readonly CommerceOptionFact[],locale:ModaSupportedLanguageTag):string {
 const unavailable=recommendationMessage(locale,"optionsUnavailable"),partial=recommendationMessage(locale,"optionsPartial"),selected=recommendationMessage(locale,"optionsSelected");if(!facts.length)return unavailable;
 return facts.map(f=>[f.title,...(f.options.status==="PARTIAL"?[partial]:[]),...(f.options.items.length?f.options.items.map(o=>`${o.name}: ${o.values.length?o.values.join(", "):unavailable}`):[unavailable]),...(f.selectedOptions.length?[`${selected}:`,...f.selectedOptions.map(o=>`${o.name}: ${o.value}`)]:[])].join("\n")).join("\n\n");
}
