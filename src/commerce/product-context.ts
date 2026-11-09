import { z } from "zod";
import { CommerceProductSchema, CommerceProductSelectedOptionsSchema } from "./schemas.js";
const id = z.string().min(1).max(128);
const date = z.iso.datetime({offset:false});
export const CommerceConversationProductContextSchema = z.strictObject({schemaVersion:z.literal(1),shopId:id,conversationId:id,platform:z.enum(["SHOPIFY","WOOCOMMERCE"]),references:z.array(z.strictObject({productId:id,variantId:id.nullable(),title:z.string().min(1).max(512),selectedOptions:CommerceProductSelectedOptionsSchema.optional(),observedAt:date})).max(20),presentation:z.strictObject({references:z.array(z.strictObject({productId:id,variantId:id.nullable()})).max(3),presentedAt:date}).optional(),updatedAt:date}).superRefine((v,c)=>{
 const pairs=v.presentation?.references??[];
 if(new Set(pairs.map(r=>JSON.stringify([r.productId,r.variantId]))).size!==pairs.length||pairs.some(p=>!v.references.some(r=>r.productId===p.productId&&r.variantId===p.variantId)))c.addIssue({code:'custom',message:'Invalid product presentation'});
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
 for(const o of observations){if(!["commerce_search_products","commerce_get_product"].includes(o.toolName)||!fresh(o.observedAt))continue;for(const raw of o.products){const p=CommerceProductSchema.parse(raw);admitted=true;add({productId:p.productId,variantId:p.variantId,title:p.title,...(p.selectedOptions!==undefined?{selectedOptions:p.selectedOptions}:{}),observedAt:o.observedAt});}}
 const references=[...entries.values()].sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||(a.productId<b.productId?-1:a.productId>b.productId?1:0)||((a.variantId??"")<(b.variantId??"")?-1:(a.variantId??"")>(b.variantId??"")?1:0)).slice(0,20);
 const result:CommerceConversationProductContext={schemaVersion:1 as const,shopId:identity.shopId,conversationId:identity.conversationId,platform:identity.platform,references,updatedAt:admitted?new Date(identity.now).toISOString():previous&&fresh(previous.updatedAt)?previous.updatedAt:new Date(identity.now).toISOString()};
 if(previous?.presentation&&fresh(previous.presentation.presentedAt)&&previous.presentation.references.every(p=>references.some(r=>r.productId===p.productId&&r.variantId===p.variantId)))result.presentation=previous.presentation;
 while(references.length&&new TextEncoder().encode(JSON.stringify(result)).length>32768){references.pop();if(result.presentation?.references.some(p=>!references.some(r=>r.productId===p.productId&&r.variantId===p.variantId)))delete result.presentation;}
 return CommerceConversationProductContextSchema.parse(result);
}
export function resolveConversationProductReference(context:CommerceConversationProductContext,reference:{productId?:string;variantId?:string|null;title?:string}):{kind:"MATCH";productId:string;variantId:string|null}|{kind:"AMBIGUOUS"}|{kind:"MISSING"}{
 const parsed=CommerceConversationProductContextSchema.parse(context);
 const matches=parsed.references.filter(r=>(reference.productId!==undefined?r.productId===reference.productId:reference.title!==undefined&&r.title.trim().toLowerCase()===reference.title.trim().toLowerCase())&&(reference.variantId===undefined||r.variantId===reference.variantId));
 const unique=[...new Map(matches.map(r=>[JSON.stringify([r.productId,r.variantId]),r])).values()];return unique.length===1?{kind:"MATCH",productId:unique[0]!.productId,variantId:unique[0]!.variantId}:unique.length>1?{kind:"AMBIGUOUS"}:{kind:"MISSING"};
}

/** Record only exact pairs actually composed by the host; references remain stale labels. */
export function recordCommerceProductPresentation(context:CommerceConversationProductContext,pairs:readonly {productId:string;variantId:string|null}[],identity:CommerceProductContextIdentity):CommerceConversationProductContext {
 const fresh=mergeConversationProductContext(context,[],identity);
 const parsed=z.array(z.strictObject({productId:id,variantId:id.nullable()})).max(3).safeParse(pairs);
 if(!parsed.success||new Set(pairs.map(p=>JSON.stringify([p.productId,p.variantId]))).size!==pairs.length||pairs.some(p=>!fresh.references.some(r=>r.productId===p.productId&&r.variantId===p.variantId)))throw new Error('PRODUCT_PRESENTATION_INVALID');
 const result:CommerceConversationProductContext={...fresh,presentation:{references:parsed.data,presentedAt:new Date(identity.now).toISOString()}};
 while(result.references.length&&new TextEncoder().encode(JSON.stringify(result)).length>32768){result.references.pop();if(result.presentation?.references.some(p=>!result.references.some(r=>r.productId===p.productId&&r.variantId===p.variantId)))delete result.presentation;}
 return CommerceConversationProductContextSchema.parse(result);
}
