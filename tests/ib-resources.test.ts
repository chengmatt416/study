import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {Hono} from 'hono';import {HTTPException} from 'hono/http-exception';
import {Client} from '@modelcontextprotocol/client';import {InMemoryTransport} from '@modelcontextprotocol/server';
import {testDatabase} from './helpers/d1';import {callApi,callApiResponse} from '../src/worker/mcp/internal';import {buildServer} from '../src/worker/mcp/server';
import books from '../src/worker/routes/books';import {enforceAccess} from '../src/worker/lib/access';import type {AppEnv,SessionUser} from '../src/worker/lib/types';
import {uploadResumeKey,matchesLegacyUpload} from '../src/shared/book-upload';import {ibReferenceIndex} from '../src/worker/lib/ib-resources';
const admin={id:'admin',email:'admin@test.example',name:'Admin',avatar_url:null,role:'admin' as const},member={...admin,id:'member',email:'member@test.example',role:'member' as const};
const ctx={waitUntil:()=>{}} as ExecutionContext;
const pdf=new TextEncoder().encode('%PDF-1.7\nIB reference transport test\n%%EOF');
class Storage {
  objects=new Map<string,Uint8Array>();uploads=new Map<string,{key:string;parts:Map<number,Uint8Array>}>();
  async createMultipartUpload(key:string){const uploadId=crypto.randomUUID();this.uploads.set(uploadId,{key,parts:new Map()});return {uploadId};}
  resumeMultipartUpload(key:string,id:string){const up=this.uploads.get(id);if(!up||up.key!==key)throw Error('Unknown upload');return {
    uploadPart:async(n:number,value:ReadableStream|ArrayBuffer)=>{up.parts.set(n,new Uint8Array(await new Response(value).arrayBuffer()));return {partNumber:n,etag:'part-'+n};},
    complete:async(parts:{partNumber:number}[])=>{const bytes=Uint8Array.from(parts.flatMap(part=>Array.from(up.parts.get(part.partNumber)!)));this.objects.set(key,bytes);this.uploads.delete(id);return {size:bytes.length};},
    abort:async()=>{this.uploads.delete(id);},
  };}
  async head(key:string){const bytes=this.objects.get(key);return bytes?{size:bytes.length,httpEtag:'"stored"',etag:'stored'}:null;}
  async get(key:string,options?:{range?:{offset:number;length:number}}){const bytes=this.objects.get(key);if(!bytes)return null;const part=options?.range?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes;return {size:bytes.length,httpEtag:'"stored"',etag:'stored',body:new Blob([part]).stream(),text:async()=>new TextDecoder().decode(part)};}
  async delete(keys:string|string[]){for(const key of Array.isArray(keys)?keys:[keys])this.objects.delete(key);}
}
describe('IB references for chatbot MCP generation',()=>{
  let fixture:ReturnType<typeof testDatabase>,storage:Storage,env:Env;
  const api=<T=Record<string,unknown>>(method:string,path:string,body?:unknown,who:SessionUser=admin)=>callApi<T>(env,ctx,who,method,path,body);
  const seed=(id:string,type='syllabus',level='both',subject='chem',status='ready')=>{
    fixture.db.prepare("INSERT INTO books(id,title,kind,status,r2_key,subject_id,ib_document_type,ib_level,ib_first_assessment_year,ib_version,size_bytes,created_at,updated_at) VALUES (?,?,'syllabus',?,?,?,?,?,2025,'2025 guide',?,1,1)").run(id,id,status,'books/'+id+'.pdf',subject,type,level,pdf.length);storage.objects.set('books/'+id+'.pdf',pdf);
  };
  beforeEach(()=>{fixture=testDatabase();storage=new Storage();fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('admin@test.example','admin',1),('member@test.example','member',1);INSERT INTO users(id,email,created_at) VALUES ('admin','admin@test.example',1),('member','member@test.example',1);INSERT INTO subjects(id,slug,name,sort) VALUES ('chem','qa-ib-chem','Chemistry',1),('math','qa-ib-math','Math',2);INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1);INSERT INTO access_group_members(group_id,email) VALUES ('students','member@test.example')");env={DB:fixture.DB,BUCKET:storage} as unknown as Env;});
  afterEach(()=>fixture.db.close());
  async function mcp(who:SessionUser,run:(client:Client)=>Promise<void>,scopes=['study:read']){const server=buildServer({env,ctx,user:who,scopes,origin:'https://study.test'}),client=new Client({name:'ib-reference-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(b),client.connect(a)]);try{await run(client);}finally{await client.close();await server.close();}}
  const data=(result:Awaited<ReturnType<Client['callTool']>>)=>JSON.parse(result.content.find(v=>v.type==='text')?.text as string);
  it('only admins can upload, and no subject is needed or stored',async()=>{
    const body={title:'IB Chemistry syllabus',kind:'syllabus',size:pdf.length,ib_document_type:'syllabus',ib_level:'HL',ib_version:'2025',ib_first_assessment_year:2025};
    for(const kind of ['booklet','book','syllabus'])await expect(api('POST','/api/books/uploads',{...body,kind},member)).rejects.toMatchObject({status:403});
    for(const change of [{ib_document_type:'unknown'},{ib_level:'college'},{ib_first_assessment_year:2025.5}])await expect(api('POST','/api/books/uploads',{...body,...change})).rejects.toMatchObject({status:400});
    await expect(api('POST','/api/books/uploads',{...body,size:100*1024**2+1})).rejects.toMatchObject({status:413});expect(storage.uploads.size).toBe(0);
    const result=await api<{bookId:string}>('POST','/api/books/uploads',body);expect(fixture.db.prepare('SELECT academic_year,semester,ib_document_type,ib_level,subject_id FROM books WHERE id=?').get(result.bookId)).toMatchObject({academic_year:null,semester:null,ib_document_type:'syllabus',ib_level:'HL',subject_id:null});await api('DELETE','/api/books/'+result.bookId);expect(storage.uploads.size).toBe(0);
  });
  it('completes the actual byte pipeline and exposes the same original PDF to MCP',async()=>{
    const upload=await api<{bookId:string;uploadId:string}>('POST','/api/books/uploads',{title:'IB marking rules',kind:'syllabus',size:pdf.length,ib_document_type:'mark_scheme',ib_level:'HL',ib_version:'May 2026 Paper 1'});
    const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('user',admin);await next();});app.use('*',enforceAccess);app.route('/api/books',books);app.onError(error=>error instanceof HTTPException?error.getResponse():new Response(String(error),{status:500}));
    const part=await app.request('/api/books/uploads/'+upload.uploadId+'/parts/1',{method:'PUT',headers:{'content-length':String(pdf.length)},body:pdf},env,ctx);expect(part.status).toBe(200);await api('POST','/api/books/uploads/'+upload.uploadId+'/complete',{});
    expect(fixture.db.prepare('SELECT status,size_bytes FROM books WHERE id=?').get(upload.bookId)).toMatchObject({status:'ready',size_bytes:pdf.length});
    await mcp(member,async client=>{const list=data(await client.callTool({name:'list_ib_resources',arguments:{ib_document_type:'mark_scheme',ib_level:'HL'}}));expect(list.documents.map((v:{id:string})=>v.id)).toEqual([upload.bookId]);const result=await client.callTool({name:'get_ib_resource',arguments:{book_id:upload.bookId,delivery:'inline'}});expect(result.isError).not.toBe(true);expect(result.content.some(v=>v.type==='resource_link'&&v.mimeType==='application/pdf')).toBe(true);const resource=result.content.find(v=>v.type==='resource');expect(resource?.type==='resource'&&'blob' in resource.resource?Buffer.from(resource.resource.blob,'base64'):null).toEqual(Buffer.from(pdf));expect(result.structuredContent).toMatchObject({ib_document_type:'mark_scheme',ib_level:'HL',ib_version:'May 2026 Paper 1'});});
  });
  it('keeps IB documents separate from semester syllabi and lists them across subjects, filtered by keyword/type/level',async()=>{
    seed('ib-hl','syllabus','HL');seed('ib-shared','guideline');seed('ib-sl','mark_scheme','SL');seed('other-subject','syllabus','HL','math');seed('not-ready','syllabus','HL','chem','uploading');
    fixture.db.exec("INSERT INTO books(id,title,kind,status,academic_year,semester,created_at,updated_at) VALUES ('semester','Semester','syllabus','ready',2026,'1',1,1)");
    expect((await api<{books:{id:string}[]}>('GET','/api/books?kind=syllabus')).books.map(v=>v.id)).toEqual(['semester']);const result=await api<{books:{id:string}[]}>('GET','/api/books?collection=ib&ib_level=HL');expect(result.books.map(v=>v.id).sort()).toEqual(['ib-hl','ib-shared','not-ready','other-subject']);expect((await ibReferenceIndex(env,member,{ib_level:'HL'})).map(v=>v.id).sort()).toEqual(['ib-hl','ib-shared','other-subject']);expect((await ibReferenceIndex(env,member,{query:'OTHER'})).map(v=>v.id)).toEqual(['other-subject']);
    await expect(api('GET','/api/books?collection=ib&semester=1')).rejects.toMatchObject({status:400});
  });
  it('protects metadata and preserves source classification when replacing a file',async()=>{
    seed('ib','mark_scheme','HL');await expect(api('PUT','/api/books/ib',{ib_level:'SL'},member)).rejects.toMatchObject({status:403});await expect(api('PUT','/api/books/ib',{semester:'1'})).rejects.toMatchObject({status:400});
    await api('PUT','/api/books/ib',{subject_id:'math',ib_level:'SL',ib_version:'Nov 2026'});expect(fixture.db.prepare('SELECT subject_id,ib_level,ib_version FROM books WHERE id=?').get('ib')).toMatchObject({subject_id:'chem',ib_level:'SL',ib_version:'Nov 2026'});
    await expect(api('POST','/api/books/uploads',{book_id:'ib',title:'Replacement',kind:'book',size:101*1024**2})).rejects.toMatchObject({status:413});await api('POST','/api/books/uploads',{book_id:'ib',title:'Replacement',kind:'book',size:pdf.length,ib_document_type:'syllabus'});expect(fixture.db.prepare('SELECT ib_document_type,subject_id FROM books WHERE id=?').get('ib')).toMatchObject({ib_document_type:'mark_scheme',subject_id:'chem'});
  });
  it('honors document and group restrictions in lists, raw PDF and generation guides',async()=>{
    seed('public');seed('restricted','mark_scheme');fixture.db.exec("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students','book','restricted',0)");
    await mcp(member,async client=>{const list=data(await client.callTool({name:'list_ib_resources',arguments:{}}));expect(list.documents.map((v:{id:string})=>v.id)).toEqual(['public']);expect((await client.callTool({name:'get_ib_resource',arguments:{book_id:'restricted'}})).isError).toBe(true);for(const kind of ['note','exam','cards']){const guideResult=await client.callTool({name:'get_format_guide',arguments:{kind}});const guide=guideResult.content.find(v=>v.type==='text')?.text as string;expect(guide).toContain('get_ib_resource');expect(guide).toContain('"book_id":"public"');expect(guide).not.toContain('"book_id":"restricted"');}});
    fixture.db.exec("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students','feature','syllabi',0)");expect(await ibReferenceIndex(env,member,{})).toEqual([]);expect((await callApiResponse(env,ctx,member,'GET','/api/books/public/file')).status).toBe(403);
    await mcp(member,async client=>{expect((await client.callTool({name:'get_ib_resource',arguments:{book_id:'public'}})).isError).toBe(true);},['study:write']);
  });
  it('keeps upload resumption isolated by IB document type, level and version',()=>{
    const file={name:'source.pdf',size:100,lastModified:1},meta={title:'Source',kind:'syllabus' as const,ib_document_type:'syllabus' as const,ib_level:'HL' as const,ib_version:'2025'};
    const key=uploadResumeKey(file,meta,'admin');expect(uploadResumeKey(file,{...meta,ib_document_type:'mark_scheme'},'admin')).not.toBe(key);expect(uploadResumeKey(file,{...meta,ib_level:'SL'},'admin')).not.toBe(key);expect(uploadResumeKey(file,{...meta,ib_version:'2027'},'admin')).not.toBe(key);
    const regular={title:'Semester',kind:'syllabus' as const,academic_year:2026,semester:'1' as const};expect(uploadResumeKey(file,regular,'admin')).toBe('upload:v2:'+JSON.stringify(['admin','syllabus','',2026,'1','','Semester','source.pdf',100,1]));
    expect(matchesLegacyUpload(meta,'admin',{book_id:'ib',created_by:'admin',size_bytes:100},100,{id:'ib',title:'Source',kind:'syllabus',subject_id:'chem',ib_document_type:'mark_scheme',ib_level:'HL',ib_version:'2025'})).toBe(false);
  });
});
