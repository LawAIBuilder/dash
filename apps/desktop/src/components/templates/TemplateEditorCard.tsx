import { useId } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DocumentTemplateField } from "@/types/document-templates";

const textareaClass = cn(
  "min-h-[220px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30"
);

export type FieldCustomization = { label: string; default: string };

type Props = {
  draftName: string;
  onDraftNameChange: (v: string) => void;
  draftDescription: string;
  onDraftDescriptionChange: (v: string) => void;
  draftBody: string;
  onDraftBodyChange: (v: string) => void;
  draftHints: string;
  onDraftHintsChange: (v: string) => void;
  effectiveFields: DocumentTemplateField[];
  fieldCustomizations: Record<string, FieldCustomization>;
  onFieldCustomizationChange: (name: string, patch: Partial<FieldCustomization>) => void;
  onSave: () => void;
  onDelete: () => void;
  savePending?: boolean;
  deletePending?: boolean;
};

export function TemplateEditorCard({
  draftName,
  onDraftNameChange,
  draftDescription,
  onDraftDescriptionChange,
  draftBody,
  onDraftBodyChange,
  draftHints,
  onDraftHintsChange,
  effectiveFields,
  fieldCustomizations,
  onFieldCustomizationChange,
  onSave,
  onDelete,
  savePending,
  deletePending
}: Props) {
  const id = useId();
  const nameId = `${id}-name`;
  const descId = `${id}-desc`;
  const bodyId = `${id}-body`;
  const hintsId = `${id}-hints`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Edit template</CardTitle>
            <CardDescription>Placeholders are inferred from {"{{name}}"} tokens in the body.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onDelete} disabled={deletePending}>
              <Trash2 className="size-4" />
              Delete
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={savePending}>
              Save template
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={nameId} className="text-sm font-medium">
            Name
          </label>
          <Input id={nameId} value={draftName} onChange={(e) => onDraftNameChange(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label htmlFor={descId} className="text-sm font-medium">
            Description
          </label>
          <Input
            id={descId}
            value={draftDescription}
            onChange={(e) => onDraftDescriptionChange(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={bodyId} className="text-sm font-medium">
            Body (markdown)
          </label>
          <textarea id={bodyId} className={textareaClass} value={draftBody} onChange={(e) => onDraftBodyChange(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label htmlFor={hintsId} className="text-sm font-medium">
            AI hints (optional)
          </label>
          <textarea
            id={hintsId}
            className={cn(textareaClass, "min-h-[80px]")}
            value={draftHints}
            onChange={(e) => onDraftHintsChange(e.target.value)}
            placeholder="e.g. intervention notice, lien, WCAB — helps future automation pick this template."
          />
        </div>
        {effectiveFields.length > 0 ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="text-sm font-medium">Fields</div>
            <p className="text-xs text-muted-foreground">Customize labels and defaults for each placeholder.</p>
            <div className="space-y-3">
              {effectiveFields.map((f) => {
                const row = fieldCustomizations[f.name] ?? { label: f.label, default: String(f.default ?? "") };
                const labelId = `${id}-field-label-${f.name}`;
                const defId = `${id}-field-def-${f.name}`;
                return (
                  <div key={f.name} className="space-y-2 rounded-md border border-border/60 bg-background/80 p-3">
                    <div className="font-mono text-xs text-muted-foreground">{`{{${f.name}}}`}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label htmlFor={labelId} className="text-xs font-medium text-muted-foreground">
                          Label
                        </label>
                        <Input
                          id={labelId}
                          value={row.label}
                          onChange={(e) => onFieldCustomizationChange(f.name, { label: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={defId} className="text-xs font-medium text-muted-foreground">
                          Default value
                        </label>
                        <Input
                          id={defId}
                          value={row.default}
                          onChange={(e) => onFieldCustomizationChange(f.name, { default: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Add {"{{placeholder_name}}"} tokens to define fields.</p>
        )}
      </CardContent>
    </Card>
  );
}
