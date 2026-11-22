import {useState} from 'react';
import {Link} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {FilePdf,UploadSimple} from '@phosphor-icons/react';
import {api,errorMessage} from '../../lib/api';
import {useUser} from '../../lib/auth';
import type {Book} from '../../lib/types';
import {fmtBytes} from '../../lib/format';
import {Button,Card,Empty,ErrorBox,inputCls,Loading,Sheet,toast} from '../../components/ui';
import {IB_DOCUMENT_TYPES,IB_LEVELS,ibResourceSchema,type IbResourceMetadata} from '../../../shared/ib-resources';
import {UploadSheet} from '../reader/UploadSheet';
import {IbMetadataFields} from '../reader/IbMetadataFields';

export function IbResourceLibrary(){
  const user=useUser(),qc=useQueryClient();
  const [type,setType]=useState(''),[level,setLevel]=useState(''),[search,setSearch]=useState('');
  const [uploading,setUploading]=useState(false),[resuming,setResuming]=useState<Book|null>(null),[editing,setEditing]=useState<Book|null>(null),[replacing,setReplacing]=useState<Book|null>(null);
  const query=useQuery({queryKey:['ib-resources'],queryFn:()=>api.get<{books:Book[]}>('/api/books?collection=ib')});
  if(user.role!=='admin')return <p role="alert">需要管理員權限。</p>;
  const filtered=(query.data?.books??[]).filter(book=>(!type||book.ib_document_type===type)&&(!level||book.ib_level===level||book.ib_level==='both')&&(!search.trim()||[book.title,book.ib_version].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const refresh=()=>{void qc.invalidateQueries({queryKey:['ib-resources']});};
  const remove=async(book:Book)=>{if(!confirm(`刪除「${book.title}」？chatbot 將無法再讀取此檔案。`))return;try{await api.del('/api/books/'+book.id);refresh();}catch(error){toast(errorMessage(error),'err');}};
  return <div className="space-y-5">
    <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">IB 生成參考資料</h2><p className="mt-2 max-w-3xl text-sm text-slate-500">管理 IB 的 syllabus、guideline 與 mark scheme，供 chatbot 透過 MCP 生成筆記、試題、字卡、課堂及評分時讀取。不分科目、不綁學期：chatbot 會列出全部文件並依名稱與版本自行挑選，所以請在文件名稱寫上科目（如「Chemistry guide 2025」）。</p></div><Button variant="primary" onClick={()=>setUploading(true)}><UploadSimple size={18}/>上傳參考文件</Button></div>
      <div className="mt-5 flex flex-wrap items-end gap-3"><label className="text-xs">類型<select className={inputCls+' mt-1 block'} value={type} onChange={e=>setType(e.target.value)}><option value="">全部類型</option>{Object.entries(IB_DOCUMENT_TYPES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs">級別<select className={inputCls+' mt-1 block'} value={level} onChange={e=>setLevel(e.target.value)}><option value="">全部級別</option>{Object.entries(IB_LEVELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="min-w-40 flex-1 text-xs">搜尋<input className={inputCls+' mt-1 w-full'} value={search} onChange={e=>setSearch(e.target.value)} placeholder="名稱、版本或場次"/></label></div>
    </Card>
    {query.isLoading?<Loading/>:query.error?<ErrorBox error={query.error}/>:filtered.length===0?<Empty icon={<FilePdf size={32}/>} title="尚無符合條件的參考文件">上傳後，chatbot 可透過 list_ib_resources 與 get_ib_resource 查找及讀取。</Empty>:<div className="space-y-3">{filtered.map(book=><Card key={book.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{book.title}</h3><p className="mt-1 text-xs text-slate-500">{IB_DOCUMENT_TYPES[book.ib_document_type!]} · {IB_LEVELS[book.ib_level??'both']}</p><p className="mt-2 text-xs text-slate-500">{book.ib_version||'未標示版本'}{book.ib_first_assessment_year?` · 首次評核 ${book.ib_first_assessment_year}`:''} · {fmtBytes(book.size_bytes)} · {book.status==='ready'?'MCP 可讀取':'上傳未完成'}</p></div><div className="flex flex-wrap gap-2">{book.status==='ready'?<><Link className="inline-flex min-h-10 items-center rounded-lg border px-3 text-xs" to={'/books/'+book.id}>查看 PDF</Link><Button size="sm" onClick={()=>setReplacing(book)}>替換 PDF</Button></>:<Button size="sm" onClick={()=>setResuming(book)}>續傳</Button>}<Button size="sm" onClick={()=>setEditing(book)}>編輯分類</Button><Button size="sm" variant="ghost" className="text-rose-600" onClick={()=>void remove(book)}>刪除</Button></div></div></Card>)}</div>}
    <p className="text-xs leading-6 text-slate-500">只有管理員能上傳、替換及編輯。MCP 讀取沿用「課綱／IB 科目文件」與個別檔案權限；chatbot 必須自行判斷適用科目，並核對 SL／HL、年份及場次，實際讀取文件後才引用，不能把文件清單當成已讀內容。</p>
    {uploading&&<UploadSheet open ib kind="syllabus" onClose={()=>setUploading(false)} initialValues={{title:'',subject_id:null}}/>}
    {resuming&&<UploadSheet key={resuming.id} open ib kind="syllabus" onClose={()=>setResuming(null)} initialValues={resuming}/>}
    {replacing&&<UploadSheet key={replacing.id} open ib replace={replacing} onClose={()=>setReplacing(null)}/>}
    {editing&&<EditResource book={editing} onClose={()=>setEditing(null)} onSaved={refresh}/>}
  </div>;
}
function EditResource({book,onClose,onSaved}:{book:Book;onClose:()=>void;onSaved:()=>void}){
  const [title,setTitle]=useState(book.title),[saving,setSaving]=useState(false);
  const [meta,setMeta]=useState<IbResourceMetadata>({ib_document_type:book.ib_document_type!,ib_level:book.ib_level??'both',ib_first_assessment_year:book.ib_first_assessment_year??null,ib_version:book.ib_version??''});
  const save=async()=>{setSaving(true);try{await api.put('/api/books/'+book.id,{title,...ibResourceSchema.parse(meta)});onSaved();onClose();toast('參考資料已更新');}catch(error){toast(errorMessage(error),'err');}finally{setSaving(false);}};
  return <Sheet open onClose={()=>{if(!saving)onClose();}} title="編輯 IB 參考資料"><div className="space-y-4 p-4"><label className="block text-xs">文件名稱<input className={inputCls+' mt-1 w-full'} value={title} disabled={saving} onChange={e=>setTitle(e.target.value)}/></label><IbMetadataFields value={meta} onChange={setMeta} disabled={saving}/><Button variant="primary" disabled={saving||!title.trim()||!ibResourceSchema.safeParse(meta).success} onClick={()=>void save()}>{saving?'儲存中…':'儲存分類'}</Button></div></Sheet>;
}
