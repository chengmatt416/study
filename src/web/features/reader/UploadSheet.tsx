import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useUser } from "../../lib/auth";
import type { BookKind } from "../../../shared/access";
import { academicYearLabel, currentSyllabusTerm, SEMESTERS, type Semester, type SyllabusTerm } from "../../../shared/syllabus";
import { errorMessage } from "../../lib/api";
import { fmtBytes } from "../../lib/format";
import type { Book } from "../../lib/types";
import { Button, inputCls, Sheet, SubjectSelect, toast } from "../../components/ui";
import { ibResourceSchema,type IbResourceMetadata } from "../../../shared/ib-resources";
import { IbMetadataFields } from "./IbMetadataFields";
import { uploadBook, type UploadProgress } from "./uploader";

export function UploadSheet({
  open,
  onClose,
  replace,
  kind = "book",
  onUploaded,
  initialTerm,
  initialValues,
  ib = false,
}: {
  open: boolean;
  onClose: () => void;
  replace?: Book;
  kind?: BookKind;
  initialTerm?: SyllabusTerm;
  ib?: boolean;
  initialValues?: { title: string; subject_id: string | null } & Partial<Pick<Book,"ib_document_type"|"ib_level"|"ib_first_assessment_year"|"ib_version">>;
  onUploaded?: (bookId: string) => void;
}) {
  const qc = useQueryClient();
  const user = useUser();
  const effectiveKind = replace?.kind ?? kind;
  const isIb = ib || !!replace?.ib_document_type;
  const [ibMeta,setIbMeta] = useState<IbResourceMetadata>({ib_document_type:replace?.ib_document_type??initialValues?.ib_document_type??'syllabus',ib_level:replace?.ib_level??initialValues?.ib_level??'both',ib_first_assessment_year:replace?.ib_first_assessment_year??initialValues?.ib_first_assessment_year??null,ib_version:replace?.ib_version??initialValues?.ib_version??''});
  const defaultTerm = initialTerm ?? currentSyllabusTerm();
  const [year, setYear] = useState(String(defaultTerm.academic_year));
  const [semester, setSemester] = useState<Semester>(defaultTerm.semester);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [subject, setSubject] = useState(replace?.subject_id ?? initialValues?.subject_id ?? "");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const inFlight = useRef(false);
  const busy = progress && progress.phase !== "done" && progress.phase !== "error";

  const start = async () => {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setProgress({ phase: "analyzing", sent: 0, total: file.size });
    try {
      if (await file.slice(0, 5).text() !== "%PDF-") throw new Error("請選擇有效的 PDF 檔案");
      if (effectiveKind !== "book" && file.size > 100 * 1024 * 1024) throw new Error("資料手冊與課綱上限 100MB");
      const ibValues = isIb ? ibResourceSchema.parse(ibMeta) : undefined;
      const bookId = await uploadBook(file, { title: title || file.name.replace(/\.pdf$/i, ""), subject_id: isIb ? undefined : subject || undefined, book_id: replace?.id, kind: effectiveKind, ...(ibValues ?? {}), ...(effectiveKind === "syllabus" && !isIb && !replace ? { academic_year: Number(year), semester } : {}) }, setProgress, user.id);
      toast("上傳完成");
      qc.invalidateQueries({ queryKey: ["books"] });
      qc.invalidateQueries({ queryKey: ["booklets"] });
      qc.invalidateQueries({ queryKey: ["syllabi"] });
      qc.invalidateQueries({ queryKey: ["ib-resources"] });
      qc.invalidateQueries({ queryKey: ["book", bookId] });
      onUploaded?.(bookId);
      setFile(null);
      setTitle("");
      setProgress(null);
      onClose();
    } catch (e) {
      setProgress((p) => ({ ...(p ?? { sent: 0, total: 0 }), phase: "error", message: errorMessage(e) }));
    } finally { inFlight.current = false; }
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={replace ? `替換檔案：${replace.title}` : isIb ? "上傳 IB 生成參考文件" : effectiveKind === "syllabus" ? "上傳學期課綱" : effectiveKind === "booklet" ? "上傳資料手冊（Data Booklet）" : "上傳 PDF"}>
      <div className="space-y-3 p-4">
        <input
          type="file"
          aria-label="PDF 檔案"
          accept="application/pdf"
          disabled={!!busy}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ""));
          }}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-800"
        />
        {file && <div className="text-xs text-slate-500">{fmtBytes(file.size)} · 將分成 {Math.ceil(file.size / (20 * 1024 * 1024))} 段（每段 20MB）上傳</div>}
        {!replace && (
          <>
            <input aria-label={isIb ? "參考文件名稱" : effectiveKind === "syllabus" ? "課綱名稱" : "檔案名稱"} className={inputCls} placeholder={isIb ? "參考文件名稱（含科目，如 Chemistry guide）" : effectiveKind === "syllabus" ? "課綱名稱" : effectiveKind === "booklet" ? "資料手冊名稱" : "書名"} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!busy} />
            {isIb && <IbMetadataFields value={ibMeta} onChange={setIbMeta} disabled={!!busy}/>}
            {effectiveKind === "syllabus" && !isIb && <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium">西元學年度<input aria-label="西元學年度" className={inputCls + " mt-1 w-full"} type="number" min={1900} max={2200} value={year} disabled={!!busy} onChange={(e) => setYear(e.target.value)} /><span className="mt-1 block text-slate-500">{Number(year) >= 1900 ? academicYearLabel(Number(year)) : "請填學年度起始年"}</span></label>
              <label className="text-xs font-medium">學期<select aria-label="學期" className={inputCls + " mt-1 w-full"} value={semester} disabled={!!busy} onChange={(e) => setSemester(e.target.value as Semester)}>{Object.entries(SEMESTERS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            </div>}
            {!isIb && <fieldset disabled={!!busy}><label className="text-xs font-medium"><span className="mb-1 block">科目（可不指定）</span><SubjectSelect value={subject} onChange={setSubject} /></label></fieldset>}
          </>
        )}
        {progress && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className={clsx("h-full transition-all duration-500", progress.phase === "error" ? "bg-rose-500" : "bg-aurora")} style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 5}%` }} />
            </div>
            <div className={clsx("text-xs whitespace-pre-wrap", progress.phase === "error" ? "text-red-600" : "text-slate-500")}>
              {{ analyzing: "分析 PDF（頁數、文字層、封面）…", uploading: `上傳中 ${fmtBytes(progress.sent)} / ${fmtBytes(progress.total)}`, finishing: "合併檔案…", done: "完成", error: "上傳失敗：" }[progress.phase]}
              {progress.phase === "error" && progress.message}
              {progress.phase === "error" && "\n若已有上傳進度，請在原裝置選擇同一檔案與設定以續傳。"}
            </div>
          </div>
        )}
        {isIb ? <p className="text-xs leading-relaxed text-slate-500">供 chatbot 透過 MCP 生成筆記、試題、字卡、課堂或評分時參考。不分科目，依級別與版本保存（請在名稱寫上科目），PDF 上限 100MB；僅管理員可管理。</p> : effectiveKind === "syllabus" ? <p className="text-xs leading-relaxed text-slate-500">課綱依學年度、學期與科目保存，上限 100MB。成員依群組權限閱讀，chatbot 可透過 MCP 取得原始 PDF。</p> : effectiveKind === "booklet" ? (
          <p className="text-xs text-slate-500">資料手冊可連結到模擬試題，作答時能在旁邊開啟查閱（上限 100MB）。</p>
        ) : (
          <p className="text-xs text-slate-500">提示：掃描檔建議先執行 <code>scripts/preprocess-pdf.sh</code>（OCR 加文字層並壓縮），即可文字選取、搜尋與標注。</p>
        )}
        <Button variant="primary" className="w-full" disabled={!file || !!busy || (isIb && !ibResourceSchema.safeParse(ibMeta).success) || (effectiveKind === "syllabus" && !isIb && !replace && (!Number.isInteger(Number(year)) || Number(year) < 1900 || Number(year) > 2200))} onClick={start}>
          {busy ? "上傳中…" : "開始上傳"}
        </Button>
      </div>
    </Sheet>
  );
}
