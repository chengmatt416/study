// 試卷結構解析（供作答分欄介面、閱讀文章螢光標記、題號導覽與分段進度條使用）。
import { visit } from "unist-util-visit";
import { normalizeChoiceLabels, parseChoicePrefix, parseMarkdown, stripFrontmatter } from "./markdown";
import type { PublicQuestion, QuestionType } from "./exam";

export interface ExamPassageBlock {
  blockId: string;
  position: number;
  letter: string;
  md: string;
  isParagraph: boolean;
}

export interface ExamPassage {
  id: string;
  title: string;
  kind: "passage" | "stimulus";
  lettered: boolean;
  blocks: ExamPassageBlock[];
  rawMd: string;
}

export interface ParsedChoiceItem {
  key: string;
  md: string;
}

export interface ParsedPartItem {
  id: string;
  md: string;
  choices?: ParsedChoiceItem[];
  hasInlineBlanks: boolean;
}

export interface ExamQuestionView {
  index: number;
  question: PublicQuestion;
  sectionTitle: string | null;
  passageId: string | null;
  stemMd: string;
  fullQuestionMd: string;
  choices?: ParsedChoiceItem[];
  parts?: ParsedPartItem[];
  hasInlineBlanks: boolean;
  /** 大題若有共用題幹（如圖表、實驗數據、情境敘述），可固定顯示在左側材料欄。 */
  pinStemToPassagePane: boolean;
}

export interface ParsedExamPaper {
  preambleMd: string;
  passages: ExamPassage[];
  passagesById: Record<string, ExamPassage>;
  questions: ExamQuestionView[];
  sections: { title: string | null; questionIndices: number[] }[];
}

export interface PassageHighlight {
  id: string;
  passageId: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "單選題",
  multi_choice: "複選題",
  true_false: "是非題",
  tfng: "T / F / NG",
  ynng: "Y / N / NG",
  numeric: "數值計算",
  text: "簡答題",
  expression: "代數式",
  fill_blank: "填空題",
  completion: "結構填空",
  evidence: "原文舉證",
  ordering: "排序題",
  matching: "配對題",
  multipart: "複合大題",
  open: "申論／手寫",
};

export function paragraphLetter(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

interface AstNode {
  type: string;
  name?: string;
  depth?: number;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  data?: { directiveLabel?: boolean };
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function nodeText(node: AstNode): string {
  let out = "";
  if (typeof node.value === "string") out += node.value;
  for (const child of node.children ?? []) out += nodeText(child);
  return out;
}

function innerContentRange(body: string, node: AstNode): [number, number] | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const raw = body.slice(start, end);
  const openEnd = raw.indexOf("\n");
  if (openEnd < 0) return [start, end];
  const lastNl = raw.lastIndexOf("\n");
  const closeLine = lastNl > openEnd ? raw.slice(lastNl + 1).trim() : "";
  const contentEnd = /^:{3,}$/.test(closeLine) ? start + lastNl : end;
  return [start + openEnd + 1, Math.max(start + openEnd + 1, contentEnd)];
}

function stripRanges(src: string, baseOffset: number, ranges: [number, number][]): string {
  const sorted = ranges
    .map(([s, e]) => [Math.max(0, s - baseOffset), Math.max(0, e - baseOffset)] as [number, number])
    .filter(([s, e]) => e > s && s < src.length)
    .sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [s, e] of sorted) {
    out = out.slice(0, s) + out.slice(e);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function extractChoicesFromNode(body: string, choicesNode: AstNode): ParsedChoiceItem[] {
  const rawItems: { rawKey: string; md: string }[] = [];
  for (const child of choicesNode.children ?? []) {
    if (child.type !== "list") continue;
    for (const li of child.children ?? []) {
      if (li.type !== "listItem" || !li.position) continue;
      const liStart = li.position.start.offset ?? 0;
      const liEnd = li.position.end.offset ?? liStart;
      const para = li.children?.[0];
      const firstText = para?.children?.[0];
      const prefix = firstText?.type === "text" && firstText.value ? parseChoicePrefix(firstText.value) : null;
      const contentStart =
        prefix && firstText?.position?.start.offset !== undefined
          ? firstText.position.start.offset + prefix.matchLength
          : (para?.position?.start.offset ?? liStart);
      const md = body
        .slice(contentStart, liEnd)
        .replace(/\n[ \t]{2,}/g, "\n")
        .trim();
      rawItems.push({ rawKey: prefix?.raw ?? "", md });
    }
  }
  const normalized = normalizeChoiceLabels(rawItems.map((item) => item.rawKey));
  return rawItems.map((item, idx) => ({ key: normalized[idx] || String.fromCharCode(65 + idx), md: item.md }));
}

function isImageOnlyParagraph(node: AstNode): boolean {
  if (node.type !== "paragraph") return false;
  const meaningful = (node.children ?? []).filter((c) => !(c.type === "text" && !c.value?.trim()));
  return meaningful.length === 1 && meaningful[0]?.type === "image";
}

function buildPassageBlocks(body: string, passageId: string, nodes: AstNode[], lettered: boolean): ExamPassageBlock[] {
  const blocks: ExamPassageBlock[] = [];
  let letterIdx = 0;
  nodes.forEach((child, idx) => {
    if (!child.position) return;
    const start = child.position.start.offset ?? 0;
    const end = child.position.end.offset ?? start;
    const md = body.slice(start, end).trim();
    if (!md) return;
    const isPara = child.type === "paragraph" && !isImageOnlyParagraph(child);
    const letter = isPara && lettered ? paragraphLetter(letterIdx++) : "";
    blocks.push({
      blockId: `${passageId}-b${idx}`,
      position: idx,
      letter,
      md,
      isParagraph: isPara,
    });
  });
  return blocks;
}

function isSubstantialStimulus(body: string, nodes: AstNode[]): boolean {
  if (nodes.length === 0) return false;
  let totalChars = 0;
  for (const n of nodes) {
    if (n.type === "table" || n.type === "blockquote" || n.type === "code" || n.type === "math" || n.type === "containerDirective") {
      return true;
    }
    if (n.type === "paragraph" && n.children?.some((c) => c.type === "image")) return true;
    if (n.position) {
      totalChars += body.slice(n.position.start.offset ?? 0, n.position.end.offset ?? 0).trim().length;
    }
  }
  return nodes.length >= 2 || totalChars >= 140;
}

/** 將試卷 Markdown 與公開題目清單解析成適合作答介面呈現的結構。 */
export function parseExamPaper(md: string, questions: PublicQuestion[]): ParsedExamPaper {
  const { body } = stripFrontmatter(md);
  const tree = parseMarkdown(body) as unknown as { children: AstNode[] };
  const topNodes = tree.children ?? [];

  const passages: ExamPassage[] = [];
  const passagesById: Record<string, ExamPassage> = {};
  const registerPassage = (p: ExamPassage) => {
    passages.push(p);
    passagesById[p.id] = p;
  };

  interface RawQuestionEntry {
    id: string;
    sectionTitle: string | null;
    inferredPassageId: string | null;
    explicitPassageId: string | null;
    stemMd: string;
    fullQuestionMd: string;
    choices?: ParsedChoiceItem[];
    parts?: ParsedPartItem[];
    hasInlineBlanks: boolean;
  }

  const rawQuestions = new Map<string, RawQuestionEntry>();
  const preambleChunks: string[] = [];

  let currentSectionTitle: string | null = null;
  let paperLevelPassageId: string | null = null;
  let sectionPassageId: string | null = null;
  let seenH2 = false;
  let seenFirstQuestionInSection = false;
  let pendingSectionNodes: AstNode[] = [];
  let passageCounter = 0;
  let stimulusCounter = 0;
  let qCounter = 0;

  const flushSectionPreamble = () => {
    if (pendingSectionNodes.length === 0) return;
    const nodes = pendingSectionNodes;
    pendingSectionNodes = [];
    if (sectionPassageId || paperLevelPassageId) return;
    if (seenH2 && isSubstantialStimulus(body, nodes)) {
      stimulusCounter++;
      const id = `stimulus-${stimulusCounter}`;
      const blocks = buildPassageBlocks(body, id, nodes, false);
      const rawMd = blocks.map((b) => b.md).join("\n\n");
      if (blocks.length > 0) {
        registerPassage({
          id,
          title: currentSectionTitle ?? "參考資料",
          kind: "stimulus",
          lettered: false,
          blocks,
          rawMd,
        });
        sectionPassageId = id;
      }
    } else if (!seenH2) {
      const text = nodes
        .map((n) => (n.position ? body.slice(n.position.start.offset ?? 0, n.position.end.offset ?? 0).trim() : ""))
        .filter(Boolean)
        .join("\n\n");
      if (text) preambleChunks.push(text);
    }
  };

  for (const node of topNodes) {
    if (node.type === "heading" && node.depth === 1) {
      // 文件主標題（h1）留在外層標題列，不重複佔據材料欄
      continue;
    }

    if (node.type === "heading" && node.depth === 2) {
      flushSectionPreamble();
      seenH2 = true;
      seenFirstQuestionInSection = false;
      currentSectionTitle = nodeText(node).trim() || null;
      sectionPassageId = null;
      pendingSectionNodes = [];
      continue;
    }

    if (node.type === "containerDirective" && node.name === "solution") {
      continue;
    }

    if (node.type === "containerDirective" && (node.name === "passage" || node.name === "stimulus")) {
      pendingSectionNodes = [];
      const isPassage = node.name === "passage";
      const id =
        node.attributes?.id?.trim() ||
        (isPassage ? `p${++passageCounter}` : `s${++stimulusCounter}`);
      const children = [...(node.children ?? [])];
      let title = node.attributes?.title?.trim() ?? "";
      if (children[0]?.data?.directiveLabel) {
        title = nodeText(children.shift()!).trim() || title;
      } else if (!title && children[0]?.type === "heading") {
        title = nodeText(children.shift()!).trim();
      }
      if (!title) title = currentSectionTitle ?? (isPassage ? "Reading Passage" : "Reference Material");
      const lettered = node.attributes?.lettered ? node.attributes.lettered !== "false" : isPassage;
      const blocks = buildPassageBlocks(body, id, children, lettered);
      const rawMd = blocks.map((b) => b.md).join("\n\n");
      registerPassage({
        id,
        title,
        kind: isPassage ? "passage" : "stimulus",
        lettered,
        blocks,
        rawMd,
      });
      if (seenH2) sectionPassageId = id;
      else paperLevelPassageId = id;
      continue;
    }

    if (node.type === "containerDirective" && node.name === "question") {
      if (!seenFirstQuestionInSection) {
        flushSectionPreamble();
        seenFirstQuestionInSection = true;
      }
      qCounter++;
      const qid = node.attributes?.id ?? `q${qCounter}`;
      const explicitPassageId = node.attributes?.passage ?? null;
      const range = innerContentRange(body, node);
      const innerStart = range ? range[0] : (node.position?.start.offset ?? 0);
      const innerEnd = range ? range[1] : (node.position?.end.offset ?? innerStart);
      const fullQuestionMd = body.slice(innerStart, innerEnd).trim();

      const stripFromStem: [number, number][] = [];
      let choices: ParsedChoiceItem[] | undefined;
      const parts: ParsedPartItem[] = [];
      let stemHasBlanks = false;

      visit(node as never, (inner) => {
        const x = inner as unknown as AstNode;
        if (x === node) return;
        if (x.type === "containerDirective" && x.name === "solution" && x.position) {
          stripFromStem.push([x.position.start.offset!, x.position.end.offset!]);
          return "skip";
        }
        if (x.type === "containerDirective" && x.name === "part" && x.position) {
          stripFromStem.push([x.position.start.offset!, x.position.end.offset!]);
          const partRange = innerContentRange(body, x);
          const pStart = partRange ? partRange[0] : x.position.start.offset!;
          const pEnd = partRange ? partRange[1] : x.position.end.offset!;
          const partStrip: [number, number][] = [];
          let partChoices: ParsedChoiceItem[] | undefined;
          let partHasBlanks = false;
          visit(x as never, (pin) => {
            const px = pin as unknown as AstNode;
            if (px === x) return;
            if (px.type === "containerDirective" && px.name === "solution" && px.position) {
              partStrip.push([px.position.start.offset!, px.position.end.offset!]);
              return "skip";
            }
            if (px.type === "containerDirective" && px.name === "choices" && px.position) {
              partStrip.push([px.position.start.offset!, px.position.end.offset!]);
              partChoices = extractChoicesFromNode(body, px);
              return "skip";
            }
            if ((px.type === "textDirective" || px.type === "leafDirective") && px.name === "blank") {
              partHasBlanks = true;
            }
          });
          parts.push({
            id: x.attributes?.id ?? "",
            md: stripRanges(body.slice(pStart, pEnd), pStart, partStrip),
            ...(partChoices ? { choices: partChoices } : {}),
            hasInlineBlanks: partHasBlanks,
          });
          return "skip";
        }
        if (x.type === "containerDirective" && x.name === "choices" && x.position) {
          stripFromStem.push([x.position.start.offset!, x.position.end.offset!]);
          choices = extractChoicesFromNode(body, x);
          return "skip";
        }
        if ((x.type === "textDirective" || x.type === "leafDirective") && x.name === "blank") {
          stemHasBlanks = true;
        }
      });

      const stemMd = stripRanges(fullQuestionMd, innerStart, stripFromStem);
      rawQuestions.set(qid, {
        id: qid,
        sectionTitle: currentSectionTitle,
        inferredPassageId: sectionPassageId ?? paperLevelPassageId,
        explicitPassageId,
        stemMd,
        fullQuestionMd,
        choices,
        parts: parts.length ? parts : undefined,
        hasInlineBlanks: stemHasBlanks,
      });
      continue;
    }

    if (!seenFirstQuestionInSection) {
      pendingSectionNodes.push(node);
    }
  }

  const questionViews: ExamQuestionView[] = questions.map((question, index) => {
    const raw = rawQuestions.get(question.id);
    const chosenPassage =
      question.passage === "none" || raw?.explicitPassageId === "none"
        ? null
        : (question.passage ?? raw?.explicitPassageId ?? raw?.inferredPassageId ?? null);
    const resolvedPassageId = chosenPassage && passagesById[chosenPassage] ? chosenPassage : null;

    let choices = raw?.choices;
    if (!choices && question.options?.length && (question.type === "single_choice" || question.type === "multi_choice")) {
      choices = question.options.map((key) => ({
        key,
        md: question.optionTexts?.[key] ?? key,
      }));
    }

    let parts = raw?.parts;
    if (!parts && question.type === "multipart" && question.parts?.length) {
      parts = question.parts.map((part) => ({
        id: part.id,
        md: `(${part.id})`,
        hasInlineBlanks: false,
      }));
    }

    const stemMd = raw?.stemMd ?? "";
    const pinStemToPassagePane = question.type === "multipart" && stemMd.trim().length > 0;

    return {
      index,
      question,
      sectionTitle: raw?.sectionTitle ?? null,
      passageId: resolvedPassageId,
      stemMd,
      fullQuestionMd: raw?.fullQuestionMd ?? "",
      choices,
      parts,
      hasInlineBlanks: raw?.hasInlineBlanks ?? false,
      pinStemToPassagePane,
    };
  });

  const sections: { title: string | null; questionIndices: number[] }[] = [];
  for (const qv of questionViews) {
    const last = sections.at(-1);
    if (last && last.title === qv.sectionTitle) {
      last.questionIndices.push(qv.index);
    } else {
      sections.push({ title: qv.sectionTitle, questionIndices: [qv.index] });
    }
  }

  return {
    preambleMd: preambleChunks.join("\n\n"),
    passages,
    passagesById,
    questions: questionViews,
    sections,
  };
}
