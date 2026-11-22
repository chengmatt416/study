import {canAccess} from '../../shared/access';
import type {IbResourceMetadata} from '../../shared/ib-resources';
import {accessRules} from './access';
import type {SessionUser} from './types';
import {bad} from './util';
export {IB_REFERENCE_INSTRUCTIONS} from '../../shared/ib-resources';
/** The group switch for AI / MCP generation. */
export async function requireAiAccess(env:Env,user:SessionUser){
  if(!canAccess(await accessRules(env,user),'ai'))bad('你的群組未開放 AI / MCP',403);
}
export interface IbReference extends IbResourceMetadata {id:string;title:string;page_count:number|null;size_bytes:number;updated_at:number}
export async function ibReferenceIndex(env:Env,user:SessionUser,filters:{query?:string;ib_level?:'both'|'SL'|'HL';ib_document_type?:IbResourceMetadata['ib_document_type']}={}){
  const rules=await accessRules(env,user);
  if(!canAccess(rules,'ai'))bad('你的群組未開放 AI / MCP',403);
  const query=filters.query?.trim().toLowerCase()||null;
  const {results}=await env.DB.prepare(`SELECT b.id,b.title,b.ib_document_type,b.ib_level,b.ib_first_assessment_year,b.ib_version,b.page_count,b.size_bytes,b.updated_at
    FROM books b WHERE b.kind='syllabus' AND b.ib_document_type IS NOT NULL AND b.status='ready'
    AND (? IS NULL OR instr(lower(b.title||' '||COALESCE(b.ib_version,'')),?)>0) AND (? IS NULL OR b.ib_document_type=?)
    AND (? IS NULL OR b.ib_level=? OR (? IN ('SL','HL') AND b.ib_level='both')) ORDER BY b.ib_document_type,b.title`)
    .bind(query,query,filters.ib_document_type??null,filters.ib_document_type??null,filters.ib_level??null,filters.ib_level??null,filters.ib_level??null).all<IbReference>();
  return results.filter(book=>canAccess(rules,'syllabi','book',book.id));
}
