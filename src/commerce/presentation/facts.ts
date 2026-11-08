import { z } from "zod";
import { CommerceProductSchema, CommerceProductOptionsSchema, CommerceProductSelectedOptionsSchema } from "../schemas.js";
import { CommerceProductDescriptionSchema, CommerceProductAttributesSchema } from "../product-facts.js";
import type { ModaSupportedLanguageTag } from "../../internationalization.js";
import { productFactMessages } from "./fact-messages.js";
export const CommerceProductFactSchema = z.strictObject({productId:z.string().min(1).max(128),variantId:z.string().min(1).max(128).nullable(),title:z.string().min(1).max(512),description:CommerceProductDescriptionSchema,attributes:CommerceProductAttributesSchema,options:CommerceProductOptionsSchema,selectedOptions:CommerceProductSelectedOptionsSchema});
export type CommerceProductFact = z.infer<typeof CommerceProductFactSchema>;
export function verifyCommerceProductFacts(selection: readonly {productId:string;variantId:string|null}[], currentProducts: readonly unknown[]): {kind:"verified";productFacts:CommerceProductFact[]}|{kind:"limitation";reason:"INVALID_SELECTION"|"PRODUCT_NOT_FOUND"|"PRODUCT_INVALID"} {
 const parsed=z.array(z.strictObject({productId:z.string().min(1).max(128),variantId:z.string().min(1).max(128).nullable()})).max(3).safeParse(selection);
 if(!parsed.success||new Set(selection.map(s=>JSON.stringify([s.productId,s.variantId]))).size!==selection.length)return {kind:"limitation",reason:"INVALID_SELECTION"};
 const facts:CommerceProductFact[]=[];
 for(const selected of parsed.data){const matches=currentProducts.filter(p=>p&&typeof p==="object"&&(p as {productId?:unknown}).productId===selected.productId&&(p as {variantId?:unknown}).variantId===selected.variantId);if(matches.length!==1)return {kind:"limitation",reason:"PRODUCT_NOT_FOUND"};const product=CommerceProductSchema.safeParse(matches[0]);if(!product.success)return {kind:"limitation",reason:"PRODUCT_INVALID"};facts.push({productId:product.data.productId,variantId:product.data.variantId,title:product.data.title,description:product.data.description??{status:"PARTIAL",text:""},attributes:product.data.attributes??{status:"PARTIAL",items:[]},options:product.data.options??{status:"PARTIAL",items:[]},selectedOptions:product.data.selectedOptions??[]});}
 return {kind:"verified",productFacts:facts};
}
export function renderCommerceProductFacts(facts:readonly CommerceProductFact[],locale:ModaSupportedLanguageTag):string {
 const [unavailable,incomplete,selected]=productFactMessages[locale];if(!facts.length)return unavailable;
 return facts.map(f=>{
  const lines:string[]=[];
  if(f.description.text)lines.push(f.description.text);
  const selectedLines = [...new Set(f.selectedOptions.map(o=>`${o.name}: ${o.value}`))];
  const factLines = [...f.attributes.items.map(a=>`${a.name}: ${a.values.length?a.values.join(", "):unavailable}`),...f.options.items.filter(o=>!f.attributes.items.some(a=>a.name===o.name&&JSON.stringify(a.values)===JSON.stringify(o.values))).map(o=>`${o.name}: ${o.values.length?o.values.join(", "):unavailable}`)];
  lines.push(...new Set(factLines.filter(line=>!selectedLines.includes(line))));
  if(selectedLines.length)lines.push(`${selected}:`,...selectedLines);
  if(!f.description.text&&!f.attributes.items.some(a=>a.values.length)&&!f.options.items.some(o=>o.values.length)&&!selectedLines.length)lines.push(unavailable);
  if([f.description.status,f.attributes.status,f.options.status].includes("PARTIAL"))lines.push(incomplete);
  return [f.title,...lines].join("\n");
 }).join("\n\n");
}
