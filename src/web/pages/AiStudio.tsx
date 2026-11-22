import { useSearchParams } from "react-router";
import { Cards, Exam, NotePencil, TreeStructure } from "@phosphor-icons/react";
import { Card, PageHeader, Tabs } from "../components/ui";
import { Page } from "../layouts/Shell";
import { PromptBuilder, type AiKind } from "../features/ai/PromptBuilder";
import { McpConnect } from "../features/ai/McpConnect";
import { BlueprintReview } from "../features/ai/BlueprintReview";

type StudioTab = AiKind | "course";

export default function AiStudio() {
  const [params, setParams] = useSearchParams();
  const kind = (["note", "exam", "cards", "course"].includes(params.get("kind") ?? "") ? params.get("kind") : "exam") as StudioTab;
  return (
    <Page>
      <PageHeader eyebrow="AI" title="AI 生成" subtitle="用 Prompt 讓任何 AI 產生符合格式的內容，或透過 MCP 讓 AI 直接連線建立" />
      <Tabs<StudioTab>
        className="mb-6"
        value={kind}
        onChange={(k) => setParams({ kind: k }, { replace: true })}
        items={[
          { value: "exam", label: <><Exam size={15} /> 模擬試題</> },
          { value: "note", label: <><NotePencil size={15} /> 重點整理</> },
          { value: "cards", label: <><Cards size={15} /> 字卡</> },
          { value: "course", label: <><TreeStructure size={15} /> 互動課程</> },
        ]}
      />
      {kind === "course" ? <BlueprintReview /> : <Card className="p-5 md:p-8">
        <PromptBuilder key={kind} kind={kind} />
      </Card>}
      <div className="mt-8">
        <McpConnect />
      </div>
    </Page>
  );
}
