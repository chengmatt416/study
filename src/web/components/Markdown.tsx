import { forwardRef, useMemo, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { clsx } from "clsx";
import { renderMarkdown, renderTree, type RenderMode } from "../../shared/markdown";
import { diffMarkdown, diffInlineMarkdown } from "../../shared/diff-md";

interface Props {
  md: string;
  /** Optional HTML prepared by the same sanitized renderer off the main thread. */
  preparedHtml?: string;
  /** 有提供則以螢光標示與 baseline 的差異 */
  baseline?: string | null;
  mode?: RenderMode;
  className?: string;
  hideDeletions?: boolean;
  inline?: boolean;
}

/** 渲染 Markdown（含 LaTeX），攔截站內連結改用 SPA 導覽。 */
export const Markdown = forwardRef<HTMLDivElement, Props>(function Markdown({ md, preparedHtml, baseline, mode = "note", className, hideDeletions, inline }, ref) {
  const navigate = useNavigate();
  const html = useMemo(() => {
    try {
      if (baseline != null && baseline !== md) {
        return renderTree(inline ? diffInlineMarkdown(baseline, md) : diffMarkdown(baseline, md).tree, { mode });
      }
      return preparedHtml ?? renderMarkdown(md, { mode });
    } catch (e) {
      console.error(e);
      return `<pre>${md.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>`;
    }
  }, [md, preparedHtml, baseline, mode, inline]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || e.metaKey || e.ctrlKey) return;
    const href = a.getAttribute("href") ?? "";
    if (a.dataset.internal || (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/"))) {
      e.preventDefault();
      navigate(href);
    } else if (href.startsWith("#")) {
      e.preventDefault();
      document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return <div ref={ref} className={clsx("prose-md", hideDeletions && "hide-deletions", className)} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
