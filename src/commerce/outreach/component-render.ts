import type { z } from 'zod';
import type { ComponentSchema, PreparedComponentSchema } from './template-contracts.js';
import { BindingUnavailable } from './variables.js';
type Component = z.infer<typeof ComponentSchema>;
type ParameterComponent = z.infer<typeof PreparedComponentSchema> extends infer C ? C extends {parameters: infer P extends readonly unknown[]} ? Omit<C, 'parameters'> & {readonly parameters: Readonly<P>} : never : never;
export function renderStoredComponentText(components: readonly Component[], parameters: readonly ParameterComponent[]): string {
 function substitute(text:string,type:'header'|'body'):string {
  const values=parameters.find(p=>p.type===type)?.parameters??[];
  return text.replace(/\{\{([1-9][0-9]*)\}\}/g,(_,position:string)=>{
   const value=values[Number(position)-1];
   if(!value||value.type!=='text')throw new BindingUnavailable('BINDINGS_INVALID');
   return value.text;
  });
 }
 const body=components.find(c=>c.type==='BODY');
 if(!body||body.type!=='BODY')throw new BindingUnavailable('BINDINGS_INVALID');
 if(substitute(body.text,'body').length>4096)throw new BindingUnavailable('MESSAGE_TOO_LARGE');
 const text=components.flatMap(c=>{
  if(c.type==='BODY')return [substitute(c.text,'body')];
  if(c.type==='FOOTER')return [c.text];
  if(c.type==='HEADER'&&c.format==='TEXT')return [substitute(c.text,'header')];
  return [];
 }).join('\n');
 if(text.length>8192)throw new BindingUnavailable('MESSAGE_TOO_LARGE');
 return text;
}
