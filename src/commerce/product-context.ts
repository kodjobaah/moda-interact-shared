import { z } from "zod";
import { CommerceProductSchema } from "./schemas.js";
const id = z.string().min(1).max(128);
const date = z.iso.datetime({offset:false});
export const CommerceConversationProductContextSchema = z.strictObject({schemaVersion:z.literal(1),shopId:id,conversationId:id,platform:z.enum(["SHOPIFY","WOOCOMMERCE"]),references:z.array(z.strictObject({productId:id,variantId:id.nullable(),title:z.string().min(1).max(512),observedAt:date})).max(20),updatedAt:date}).superRefine((v,c)=>{
 const valid=(value:string,kind:string)=>v.platform === "SHOPIFY" ? new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(value) : /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
 if(v.references.some(r=>!valid(r.productId,"Product")||(r.variantId!==null&&!valid(r.variantId,"ProductVariant")))||new TextEncoder().encode(JSON.stringify(v)).length>32768)c.addIssue({code:"custom",message:"Invalid product context"});
});
export type CommerceConversationProductContext = z.infer<typeof CommerceConversationProductContextSchema>;
export type CommerceProductObservation = {toolName:string;products:z.infer<typeof CommerceProductSchema>[];observedAt:string};
export type CommerceProductContextIdentity = {shopId:string;conversationId:string;platform:"SHOPIFY"|"WOOCOMMERCE";now:number};
export function mergeConversationProductContext(previous:CommerceConversationProductContext|null,observations:readonly CommerceProductObservation[],identity:CommerceProductContextIdentity):CommerceConversationProductContext {
 id.parse(identity.shopId);id.parse(identity.conversationId);z.enum(["SHOPIFY","WOOCOMMERCE"]).parse(identity.platform);if(!Number.isFinite(identity.now))throw new Error("PRODUCT_CONTEXT_TIME_INVALID");
 let admitted=false;
 if(previous){previous=CommerceConversationProductContextSchema.parse(previous);if(previous.shopId!==identity.shopId||previous.conversationId!==identity.conversationId||previous.platform!==identity.platform)throw new Error("PRODUCT_CONTEXT_IDENTITY_MISMATCH");}
 const fresh=(time:string)=>Number.isFinite(Date.parse(time))&&Date.parse(time)<=identity.now&&Date.parse(time)>=identity.now-86400000;
 const entries=new Map<string,CommerceConversationProductContext["references"][number]>();
 const add=(r:CommerceConversationProductContext["references"][number])=>{if(!fresh(r.observedAt))return;const key=JSON.stringify([r.productId,r.variantId]);const old=entries.get(key);if(!old||Date.parse(r.observedAt)>=Date.parse(old.observedAt))entries.set(key,r);};
 if(previous&&fresh(previous.updatedAt))previous.references.forEach(add);
 for(const o of observations){if(!["commerce_search_products","commerce_get_product"].includes(o.toolName)||!fresh(o.observedAt))continue;for(const raw of o.products){const p=CommerceProductSchema.parse(raw);admitted=true;add({productId:p.productId,variantId:p.variantId,title:p.title,observedAt:o.observedAt});}}
 const references=[...entries.values()].sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||(a.productId<b.productId?-1:a.productId>b.productId?1:0)||((a.variantId??"")<(b.variantId??"")?-1:(a.variantId??"")>(b.variantId??"")?1:0)).slice(0,20);
 const result={schemaVersion:1 as const,shopId:identity.shopId,conversationId:identity.conversationId,platform:identity.platform,references,updatedAt:admitted?new Date(identity.now).toISOString():previous&&fresh(previous.updatedAt)?previous.updatedAt:new Date(identity.now).toISOString()};
 while(references.length&&new TextEncoder().encode(JSON.stringify(result)).length>32768)references.pop();
 return CommerceConversationProductContextSchema.parse(result);
}
export function resolveConversationProductReference(context:CommerceConversationProductContext,reference:{productId?:string;variantId?:string|null;title?:string}):{kind:"MATCH";productId:string;variantId:string|null}|{kind:"AMBIGUOUS"}|{kind:"MISSING"}{
 const parsed=CommerceConversationProductContextSchema.parse(context);
 const matches=parsed.references.filter(r=>(reference.productId!==undefined?r.productId===reference.productId:reference.title!==undefined&&r.title.trim().toLowerCase()===reference.title.trim().toLowerCase())&&(reference.variantId===undefined||r.variantId===reference.variantId));
 const unique=[...new Map(matches.map(r=>[JSON.stringify([r.productId,r.variantId]),r])).values()];return unique.length===1?{kind:"MATCH",productId:unique[0]!.productId,variantId:unique[0]!.variantId}:unique.length>1?{kind:"AMBIGUOUS"}:{kind:"MISSING"};
}
