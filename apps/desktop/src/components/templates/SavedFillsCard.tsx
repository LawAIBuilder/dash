import { Copy, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserDocumentTemplateFill } from "@/types/document-templates";
import { formatDateTime } from "@/ui/formatters";
import { TemplateMarkdownPreview } from "./TemplateMarkdownPreview";

type Props = {
  fills: UserDocumentTemplateFill[] | undefined;
  onLoadFill: (fill: UserDocumentTemplateFill) => void;
  onCopyFillMarkdown: (markdown: string) => void;
  onDeleteFill: (fillId: string) => void;
  deletePending?: boolean;
};

export function SavedFillsCard({ fills, onLoadFill, onCopyFillMarkdown, onDeleteFill, deletePending }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saved drafts</CardTitle>
        <CardDescription>Recent fills for this template ({fills?.length ?? 0})</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!fills?.length ? (
          <p className="text-sm text-muted-foreground">No saved drafts yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {fills.map((f) => (
              <li key={f.id} className="rounded-lg border px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(f.updated_at ?? f.created_at)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{f.status}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => onLoadFill(f)}
                    >
                      <Upload className="size-3.5" />
                      Load into form
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => onCopyFillMarkdown(f.rendered_markdown)}
                    >
                      <Copy className="size-3.5" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      aria-label="Delete saved draft"
                      onClick={() => onDeleteFill(f.id)}
                      disabled={deletePending}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 max-h-[200px] overflow-hidden rounded-md border border-border/50">
                  <TemplateMarkdownPreview className="max-h-[200px] border-0 shadow-none" markdown={f.rendered_markdown} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
