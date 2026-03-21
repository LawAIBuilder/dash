import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DocumentTemplateField } from "@/types/document-templates";
import { TemplateMarkdownPreview } from "./TemplateMarkdownPreview";

type Props = {
  effectiveFields: DocumentTemplateField[];
  fillValues: Record<string, string>;
  onFillValueChange: (name: string, value: string) => void;
  missing: string[];
  preview: string | null;
  onSaveDraft: () => void;
  onCopyMarkdown: () => void;
  savePending?: boolean;
};

export function TemplateFillCard({
  effectiveFields,
  fillValues,
  onFillValueChange,
  missing,
  preview,
  onSaveDraft,
  onCopyMarkdown,
  savePending
}: Props) {
  const baseId = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fill & preview</CardTitle>
        <CardDescription>
          Values map to placeholders. Matter fields pre-fill when names match. Preview updates shortly after you change
          fields or template body.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {effectiveFields.map((f) => {
            const inputId = `${baseId}-fill-${f.name}`;
            return (
              <div key={f.name} className="space-y-1">
                <label htmlFor={inputId} className="text-sm font-medium">
                  {f.label || f.name}
                </label>
                <Input
                  id={inputId}
                  value={fillValues[f.name] ?? ""}
                  onChange={(e) => onFillValueChange(f.name, e.target.value)}
                  placeholder={f.name}
                />
              </div>
            );
          })}
        </div>
        {missing.length > 0 ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">Unfilled placeholders: {missing.join(", ")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onSaveDraft} disabled={savePending}>
            Save filled draft
          </Button>
          {preview !== null ? (
            <Button type="button" variant="outline" onClick={onCopyMarkdown}>
              Copy markdown
            </Button>
          ) : null}
        </div>
        {preview !== null ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Preview</div>
            <TemplateMarkdownPreview markdown={preview} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
