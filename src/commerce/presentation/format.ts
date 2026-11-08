/** Plain text only. Unbalanced markers and non-HTTPS links remain literal. */
export function normalizeCommerceReplyText(value:string):string {
 const linked=value.replace(/\[([^\]\r\n]+)\]\((https:\/\/[^\s)]+)\)/g,(original,label:string,raw:string)=>{try{const url=new URL(raw);return url.protocol==="https:"&&!url.username&&!url.password?`${label}: ${raw}`:original;}catch{return original;}});
 const strip=(text:string,pattern:RegExp)=>text.replace(pattern,(original:string,inner:string,offset:number,source:string)=>/https?:\/\/[^\s]*$/.test(source.slice(0,offset))?original:inner);
 return strip(strip(linked,/\*\*([^*]+)\*\*/g),/~~([^~]+)~~/g);
}
