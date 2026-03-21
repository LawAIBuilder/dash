import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const textareaClass = cn(
  "min-h-[240px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
);

type Props = {
  /** Original AI draft_markdown from the worker output */
  aiDraftMarkdown: string;
  /** Saved human edit (persisted on run) */
  savedEditedMarkdown: string | null;
  onSave: (markdown: string) => void;
  savePending?: boolean;
};

export function DraftEditor({ aiDraftMarkdown, savedEditedMarkdown, onSave, savePending }: Props) {
  const baseline = savedEditedMarkdown ?? aiDraftMarkdown;
  const [value, setValue] = useState(baseline);

  useEffect(() => {
    setValue(savedEditedMarkdown ?? aiDraftMarkdown);
  }, [aiDraftMarkdown, savedEditedMarkdown]);

  const isEdited = value.trim() !== aiDraftMarkdown.trim();
  const hasSavedEdit = Boolean(savedEditedMarkdown);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Draft</span>
          <Badge variant="secondary" className="font-normal">
            {hasSavedEdit ? "Includes saved edits" : "AI-generated"}
          </Badge>
          {isEdited ? (
            <Badge variant="outline" className="border-amber-600/50 text-amber-900 dark:text-amber-200">
              Unsaved changes
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={savePending || !isEdited}
          onClick={() => onSave(value)}
        >
          {savePending ? "Saving…" : "Save draft"}
        </Button>
      </div>
      <textarea
        className={textareaClass}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck
        aria-label="Package draft markdown"
      />
    </div>
  );
}
