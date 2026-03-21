import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type PackageCitation = {
  claim?: string;
  source_item_id?: string | null;
  canonical_page_id?: string | null;
  page_text_excerpt?: string | null;
};

type Props = {
  caseId: string;
  citations: PackageCitation[];
  className?: string;
};

export function CitationPanel({ caseId, citations, className }: Props) {
  if (citations.length === 0) {
    return (
      <div className={cn("text-muted-foreground text-sm", className)}>
        No citations on this run. Completed worker output should include citations for factual claims.
      </div>
    );
  }

  return (
    <ul className={cn("space-y-2 text-sm", className)}>
      {citations.map((c, i) => {
        const sid = c.source_item_id ?? undefined;
        const href = sid
          ? `/cases/${encodeURIComponent(caseId)}/documents?sourceItem=${encodeURIComponent(sid)}`
          : null;
        return (
          <li key={`${sid ?? "c"}-${i}`} className="rounded-md border bg-muted/20 px-3 py-2">
            <div className="font-medium text-foreground">{c.claim ?? "Citation"}</div>
            {c.page_text_excerpt ? (
              <div className="text-muted-foreground mt-1 line-clamp-3 text-xs">{c.page_text_excerpt}</div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {sid ? <span>Source: {sid.slice(0, 8)}…</span> : null}
              {c.canonical_page_id ? <span>Page ref: {c.canonical_page_id.slice(0, 8)}…</span> : null}
              {href ? (
                <Link
                  to={href}
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open in documents
                  <ExternalLink className="size-3" />
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
