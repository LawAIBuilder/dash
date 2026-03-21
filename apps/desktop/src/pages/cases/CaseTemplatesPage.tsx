import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { CreateTemplateDialog } from "@/components/templates/CreateTemplateDialog";
import { SavedFillsCard } from "@/components/templates/SavedFillsCard";
import { TemplateEditorCard, type FieldCustomization } from "@/components/templates/TemplateEditorCard";
import { TemplateFillCard } from "@/components/templates/TemplateFillCard";
import { TemplateListSidebar } from "@/components/templates/TemplateListSidebar";
import { Card, CardContent } from "@/components/ui/card";
import { StatePanel } from "@/components/case/StatePanel";
import { getStarterTemplate, type StarterTemplateKey } from "@/data/wc-starter-templates";
import { useCaseDetail } from "@/hooks/useCaseDetail";
import {
  useCreateDocumentTemplate,
  useDeleteDocumentTemplate,
  useDeleteDocumentTemplateFill,
  useDocumentTemplateFills,
  useDocumentTemplates,
  useRenderDocumentTemplate,
  useUpdateDocumentTemplate
} from "@/hooks/useDocumentTemplates";
import { renderDocumentTemplate } from "@/lib/api-client";
import { mergeCaseHintsIntoFillValues } from "@/lib/template-case-prefill";
import type { DocumentTemplateField, UserDocumentTemplateFill } from "@/types/document-templates";

function humanizePlaceholder(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferFieldNamesFromBody(body: string): string[] {
  const names = new Set<string>();
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    names.add(m[1]!);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function mergeFillValues(prev: Record<string, string>, fields: DocumentTemplateField[]): Record<string, string> {
  const next = { ...prev };
  for (const f of fields) {
    if (!(f.name in next)) {
      const d = String(f.default ?? "").trim();
      if (d !== "") {
        next[f.name] = d;
      }
    }
  }
  for (const k of Object.keys(next)) {
    if (!fields.some((field) => field.name === k)) {
      delete next[k];
    }
  }
  return next;
}

export function CaseTemplatesPage() {
  const { caseId } = useParams();
  const { data: templates, isLoading, error, refetch } = useDocumentTemplates(caseId);
  const { data: caseData } = useCaseDetail(caseId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftHints, setDraftHints] = useState("");
  const [fieldCustomizations, setFieldCustomizations] = useState<Record<string, FieldCustomization>>({});
  const [fillValues, setFillValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const lastSyncedTemplateId = useRef<string | null>(null);
  const livePreviewSeqRef = useRef(0);

  const selected = useMemo(
    () => templates?.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  );

  const effectiveFields: DocumentTemplateField[] = useMemo(() => {
    const names = inferFieldNamesFromBody(draftBody);
    const byName = new Map((selected?.fields ?? []).map((f) => [f.name, f]));
    return names.map((name) => {
      const meta = byName.get(name);
      return {
        name,
        label: meta?.label?.trim() || humanizePlaceholder(name),
        default: meta?.default ?? ""
      };
    });
  }, [draftBody, selected?.fields]);

  const { data: fills } = useDocumentTemplateFills(caseId, selectedId);

  const createTemplate = useCreateDocumentTemplate(caseId);
  const updateTemplate = useUpdateDocumentTemplate(caseId);
  const deleteTemplate = useDeleteDocumentTemplate(caseId);
  const renderTemplate = useRenderDocumentTemplate(caseId);
  const deleteFill = useDeleteDocumentTemplateFill(caseId);

  useEffect(() => {
    if (!selectedId) {
      lastSyncedTemplateId.current = null;
      setFieldCustomizations({});
      return;
    }
    if (!templates) {
      return;
    }
    const t = templates.find((x) => x.id === selectedId);
    if (!t) {
      return;
    }
    if (lastSyncedTemplateId.current === selectedId) {
      return;
    }
    lastSyncedTemplateId.current = selectedId;
    setDraftName(t.name);
    setDraftDescription(t.description ?? "");
    setDraftBody(t.body_markdown);
    setDraftHints(t.ai_hints ?? "");
    setFieldCustomizations(
      Object.fromEntries(
        t.fields.map((f) => [
          f.name,
          { label: f.label?.trim() || humanizePlaceholder(f.name), default: String(f.default ?? "") }
        ])
      )
    );
    setFillValues(mergeFillValues({}, t.fields));
    setPreview(null);
    setMissing([]);
  }, [selectedId, templates]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    setFieldCustomizations((prev) => {
      const next = { ...prev };
      for (const f of effectiveFields) {
        if (!(f.name in next)) {
          next[f.name] = { label: f.label, default: String(f.default ?? "") };
        }
      }
      for (const k of Object.keys(next)) {
        if (!effectiveFields.some((e) => e.name === k)) {
          delete next[k];
        }
      }
      return next;
    });
    setFillValues((prev) => mergeFillValues(prev, effectiveFields));
  }, [effectiveFields, selectedId]);

  useEffect(() => {
    if (!selectedId || !caseData) {
      return;
    }
    const names = inferFieldNamesFromBody(draftBody);
    setFillValues((prev) => mergeCaseHintsIntoFillValues(prev, names, caseData));
  }, [caseData?.id, caseData?.updated_at, selectedId, draftBody]);

  useEffect(() => {
    if (!caseId?.trim() || !selectedId) {
      return;
    }
    const seq = ++livePreviewSeqRef.current;
    const t = setTimeout(() => {
      void renderDocumentTemplate(caseId, selectedId, {
        values: fillValues,
        body_markdown: draftBody
      })
        .then((r) => {
          if (seq !== livePreviewSeqRef.current) {
            return;
          }
          setPreview(r.rendered_markdown);
          setMissing(r.missing_placeholders);
        })
        .catch(() => {
          if (seq !== livePreviewSeqRef.current) {
            return;
          }
        });
    }, 380);
    return () => clearTimeout(t);
  }, [caseId, selectedId, fillValues, draftBody]);

  async function handleCreateFromDialog(input: { name: string; starterKey: StarterTemplateKey }) {
    if (!caseId) {
      return;
    }
    const starter = getStarterTemplate(input.starterKey);
    try {
      const t = await createTemplate.mutateAsync({
        name: input.name,
        body_markdown: starter.body_markdown,
        ai_hints: starter.ai_hints
      });
      lastSyncedTemplateId.current = null;
      setSelectedId(t.id);
      toast.success("Template created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create template");
    }
  }

  async function handleSaveTemplate() {
    if (!caseId || !selectedId) {
      return;
    }
    try {
      await updateTemplate.mutateAsync({
        templateId: selectedId,
        input: {
          name: draftName,
          description: draftDescription || null,
          body_markdown: draftBody,
          ai_hints: draftHints || null,
          fields: effectiveFields.map((f) => ({
            name: f.name,
            label: fieldCustomizations[f.name]?.label ?? f.label,
            default: fieldCustomizations[f.name]?.default ?? ""
          }))
        }
      });
      await refetch();
      toast.success("Template saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleDeleteTemplate() {
    if (!caseId || !selectedId) {
      return;
    }
    if (!window.confirm("Delete this template and its saved fills?")) {
      return;
    }
    try {
      await deleteTemplate.mutateAsync(selectedId);
      setSelectedId(null);
      toast.success("Template deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleSaveDraft() {
    if (!caseId || !selectedId) {
      return;
    }
    try {
      const result = await renderTemplate.mutateAsync({
        templateId: selectedId,
        input: { values: fillValues, body_markdown: draftBody, save: true }
      });
      setPreview(result.rendered_markdown);
      setMissing(result.missing_placeholders);
      toast.success("Draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  function handleCopyMarkdown() {
    if (preview === null) {
      return;
    }
    void navigator.clipboard.writeText(preview).then(
      () => toast.success("Copied markdown"),
      () => toast.error("Could not copy")
    );
  }

  function handleCopyFillMarkdown(markdown: string) {
    void navigator.clipboard.writeText(markdown).then(
      () => toast.success("Copied draft"),
      () => toast.error("Could not copy")
    );
  }

  function handleLoadFill(fill: UserDocumentTemplateFill) {
    setFillValues((prev) => ({ ...prev, ...fill.values }));
    setPreview(fill.rendered_markdown);
    toast.success("Loaded draft into form");
  }

  async function handleDeleteFill(fillId: string) {
    if (!caseId) {
      return;
    }
    if (!window.confirm("Delete this saved draft?")) {
      return;
    }
    try {
      await deleteFill.mutateAsync(fillId);
      toast.success("Draft deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function onFieldCustomizationChange(name: string, patch: Partial<FieldCustomization>) {
    setFieldCustomizations((prev) => {
      const cur = prev[name] ?? { label: humanizePlaceholder(name), default: "" };
      return { ...prev, [name]: { ...cur, ...patch } };
    });
  }

  if (error) {
    return <StatePanel variant="error" message={error instanceof Error ? error.message : "Failed to load templates."} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Document templates</h2>
        <p className="text-sm text-muted-foreground">
          Reusable markdown with <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{{placeholders}}"}</code>. Match names
          like <code className="rounded bg-muted px-1 py-0.5 text-xs">employee_name</code> to pre-fill from this matter.
        </p>
      </div>

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreateFromDialog}
        isPending={createTemplate.isPending}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <TemplateListSidebar
          templates={templates}
          isLoading={isLoading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRequestNew={() => setCreateOpen(true)}
          createPending={createTemplate.isPending}
        />

        <div className="space-y-4">
          {!selected ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Select a template or create one to edit content, field labels, and drafts.
              </CardContent>
            </Card>
          ) : (
            <>
              <TemplateEditorCard
                draftName={draftName}
                onDraftNameChange={setDraftName}
                draftDescription={draftDescription}
                onDraftDescriptionChange={setDraftDescription}
                draftBody={draftBody}
                onDraftBodyChange={setDraftBody}
                draftHints={draftHints}
                onDraftHintsChange={setDraftHints}
                effectiveFields={effectiveFields}
                fieldCustomizations={fieldCustomizations}
                onFieldCustomizationChange={onFieldCustomizationChange}
                onSave={handleSaveTemplate}
                onDelete={handleDeleteTemplate}
                savePending={updateTemplate.isPending}
                deletePending={deleteTemplate.isPending}
              />

              <TemplateFillCard
                effectiveFields={effectiveFields}
                fillValues={fillValues}
                onFillValueChange={(name, value) =>
                  setFillValues((prev) => ({
                    ...prev,
                    [name]: value
                  }))
                }
                missing={missing}
                preview={preview}
                onSaveDraft={handleSaveDraft}
                onCopyMarkdown={handleCopyMarkdown}
                savePending={renderTemplate.isPending}
              />

              <SavedFillsCard
                fills={fills}
                onLoadFill={handleLoadFill}
                onCopyFillMarkdown={handleCopyFillMarkdown}
                onDeleteFill={handleDeleteFill}
                deletePending={deleteFill.isPending}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
