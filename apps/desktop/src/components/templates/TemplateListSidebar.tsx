import { LayoutTemplate, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import type { UserDocumentTemplate } from "@/types/document-templates";

type Props = {
  templates: UserDocumentTemplate[] | undefined;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequestNew: () => void;
  createPending?: boolean;
};

export function TemplateListSidebar({
  templates,
  isLoading,
  selectedId,
  onSelect,
  onRequestNew,
  createPending
}: Props) {
  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Templates</CardTitle>
        <CardDescription>Per-matter library</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" className="w-full gap-2" onClick={onRequestNew} disabled={createPending}>
          <Plus className="size-4" />
          New template
        </Button>
        {isLoading ? (
          <PageSkeleton rows={4} />
        ) : (
          <ul className="space-y-1">
            {(templates ?? []).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selectedId === t.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
                  )}
                >
                  <LayoutTemplate className="size-4 shrink-0 opacity-70" />
                  <span className="truncate font-medium">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
