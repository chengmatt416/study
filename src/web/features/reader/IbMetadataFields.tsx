import { IB_DOCUMENT_TYPES,IB_LEVELS,type IbResourceMetadata } from '../../../shared/ib-resources';
import { inputCls } from '../../components/ui';
export function IbMetadataFields({value,onChange,disabled}:{value:IbResourceMetadata;onChange:(value:IbResourceMetadata)=>void;disabled?:boolean}){
  return <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
    <label className="text-xs font-medium">文件類型<select className={inputCls+' mt-1 w-full'} value={value.ib_document_type} onChange={e=>onChange({...value,ib_document_type:e.target.value as IbResourceMetadata['ib_document_type']})}>{Object.entries(IB_DOCUMENT_TYPES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label className="text-xs font-medium">IB 級別<select className={inputCls+' mt-1 w-full'} value={value.ib_level} onChange={e=>onChange({...value,ib_level:e.target.value as IbResourceMetadata['ib_level']})}>{Object.entries(IB_LEVELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label className="text-xs font-medium">首次評核年份（選填）<input className={inputCls+' mt-1 w-full'} type="number" min="1900" max="2200" value={value.ib_first_assessment_year??''} onChange={e=>onChange({...value,ib_first_assessment_year:e.target.value?Number(e.target.value):null})}/></label>
    <label className="text-xs font-medium">版本／考試場次（選填）<input className={inputCls+' mt-1 w-full'} maxLength={120} value={value.ib_version} onChange={e=>onChange({...value,ib_version:e.target.value})} placeholder="如：2025 guide、May 2026 Paper 1"/></label>
  </fieldset>;
}
