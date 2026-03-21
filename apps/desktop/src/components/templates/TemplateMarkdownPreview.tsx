import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

type Props = {
  markdown: string;
  className?: string;
};

/**
 * Renders template output as readable document text (not monospace source).
 */
export function TemplateMarkdownPreview({ markdown, className }: Props) {
  return (
    <div
      className={cn(
        "max-h-[min(420px,55vh)] overflow-auto rounded-lg border border-border/80 bg-card px-6 py-5 text-sm leading-relaxed shadow-sm",
        "[&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_p]:mb-3 [&_p]:text-foreground/95",
        "[&_ul]:mb-3 [&_ul]:list-inside [&_ul]:list-disc [&_ul]:space-y-1",
        "[&_ol]:mb-3 [&_ol]:list-inside [&_ol]:list-decimal [&_ol]:space-y-1",
        "[&_strong]:font-semibold [&_em]:italic",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/40 [&_blockquote]:pl-3 [&_blockquote]:italic",
        "[&_hr]:my-4 [&_hr]:border-border",
        className
      )}
    >
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}
