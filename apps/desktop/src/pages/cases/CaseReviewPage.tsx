import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LazyPdfPreviewDialog } from "@/components/documents/LazyPdfPreviewDialog";
import { getDisplayErrorMessage, previewFile } from "@/lib/api-client";
import { useDocumentTypes } from "@/hooks/useDocumentTypes";
import { useOverrideClassification, useResolveOcrReview, useReviewQueue } from "@/hooks/useReviewQueue";
import { formatDateTime, formatLabel, truncateMiddle } from "@/ui/formatters";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";

function isPdfLikeTitle(title: string | null | undefined) {
  return /\.pdf$/i.test(title ?? "");
}

export function CaseReviewPage() {
  const { caseId } = useParams();
  const { data, isLoading, error } = useReviewQueue(caseId);
  const documentTypes = useDocumentTypes();
  const resolveReview = useResolveOcrReview(caseId);
  const overrideClassification = useOverrideClassification(caseId);
  const [preview, setPreview] = useState<{ title: string; file: Blob | null; open: boolean }>({
    title: "",
    file: null,
    open: false
  });
  const [overrideInput, setOverrideInput] = useState<Record<string, string>>({});

  const counts = useMemo(
    () => ({
      ocr: data?.ocr_reviews.length ?? 0,
      unclassified: data?.unclassified_documents.length ?? 0,
      missingProof: data?.missing_proof.length ?? 0
    }),
    [data]
  );

  async function openPreview(sourceItemId: string, title: string) {
    if (!caseId) {
      toast.error("Case id missing");
      return;
    }
    try {
      const blob = await previewFile(caseId, sourceItemId);
      setPreview({ title, file: blob, open: true });
    } catch (previewError) {
      toast.error(getDisplayErrorMessage(previewError, "Preview failed"));
    }
  }

  if (error) {
    return <StatePanel variant="error" message={getDisplayErrorMessage(error, "Review queue failed to load.")} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Review queue</h2>
        <p className="text-sm text-muted-foreground">
          Resolve OCR issues, classify uncategorized documents, and understand missing proof before packet assembly.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <AlertTriangle className="size-5 text-amber-500" />
            <div>
              <div className="text-sm text-muted-foreground">OCR review</div>
              <div className="text-2xl font-semibold">{counts.ocr}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <FileWarning className="size-5 text-sky-500" />
            <div>
              <div className="text-sm text-muted-foreground">Unclassified docs</div>
              <div className="text-2xl font-semibold">{counts.unclassified}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="size-5 text-rose-500" />
            <div>
              <div className="text-sm text-muted-foreground">Missing proof items</div>
              <div className="text-2xl font-semibold">{counts.missingProof}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>OCR review</CardTitle>
          <CardDescription>Pages with low-confidence or unresolved OCR output.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <PageSkeleton rows={4} />
          ) : data?.ocr_reviews.length ? (
            data.ocr_reviews.map((item) => (
              <div key={item.review_id} className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{item.canonical_document_title ?? item.source_item_title ?? "Untitled document"}</div>
                    <div className="text-sm text-muted-foreground">
                      Page {item.page_number} • {item.document_type_name ? formatLabel(item.document_type_name) : "Unclassified"} • {formatLabel(item.severity)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{formatLabel(item.review_status)}</Badge>
                    <Badge variant={item.blocker_for_branch ? "destructive" : "secondary"}>
                      {item.blocker_for_branch ? "Branch blocker" : "Needs review"}
                    </Badge>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="space-y-2 text-sm">
                    <div className="text-muted-foreground">
                      OCR method {item.ocr_method ? formatLabel(item.ocr_method) : "not set"} • confidence {item.ocr_confidence ?? "n/a"} • extraction {formatLabel(item.extraction_status ?? "pending")}
                    </div>
                    <div className="rounded-md bg-muted/50 p-3 text-foreground">
                      {item.raw_text?.trim() ? item.raw_text.slice(0, 500) : "No OCR text captured yet."}
                    </div>
                    {item.review_note ? <div className="text-muted-foreground">Review note: {item.review_note}</div> : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    {item.source_item_id ? (
                      <Button
                        variant="outline"
                        disabled={!isPdfLikeTitle(item.source_item_title ?? item.canonical_document_title)}
                        onClick={() =>
                          void openPreview(
                            item.source_item_id!,
                            item.source_item_title ?? item.canonical_document_title ?? "Preview"
                          )
                        }
                      >
                        {isPdfLikeTitle(item.source_item_title ?? item.canonical_document_title) ? "Preview PDF" : "PDF only"}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() =>
                        void resolveReview
                          .mutateAsync({ pageId: item.canonical_page_id, acceptEmpty: false })
                          .then(() => toast.success("Review resolved"))
                          .catch((resolveError) =>
                            toast.error(getDisplayErrorMessage(resolveError, "Resolve review failed"))
                          )
                      }
                    >
                      Resolve with text
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void resolveReview
                          .mutateAsync({ pageId: item.canonical_page_id, acceptEmpty: true })
                          .then(() => toast.success("Review resolved (empty accepted)"))
                          .catch((resolveError) =>
                            toast.error(getDisplayErrorMessage(resolveError, "Resolve review failed"))
                          )
                      }
                    >
                      Accept empty
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <StatePanel message="No OCR review items are waiting in this matter." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Unclassified documents</CardTitle>
          <CardDescription>Temporary classification override entry point until the dedicated editor exists.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.unclassified_documents.length ? (
            data.unclassified_documents.map((item) => (
              <div key={item.source_item_id} className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
                <div>
                  <div className="font-medium">{item.title ?? "Untitled source item"}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatLabel(item.provider)} • {formatLabel(item.source_kind)} • updated {formatDateTime(item.updated_at)}
                  </div>
                  {item.canonical_document_id ? (
                    <div className="mt-1 text-xs text-muted-foreground">Canonical {truncateMiddle(item.canonical_document_id)}</div>
                  ) : null}
                </div>
                <Select
                  value={overrideInput[item.source_item_id] ?? ""}
                  onValueChange={(value) =>
                    setOverrideInput((current) => ({ ...current, [item.source_item_id]: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose document type" />
                  </SelectTrigger>
                  <SelectContent>
                    {documentTypes.data?.map((documentType) => (
                      <SelectItem key={documentType.id} value={documentType.id}>
                        {formatLabel(documentType.canonical_name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    disabled={!overrideInput[item.source_item_id]?.trim()}
                    onClick={() =>
                      void overrideClassification
                        .mutateAsync({
                          sourceItemId: item.source_item_id,
                          documentTypeId: overrideInput[item.source_item_id]!.trim()
                        })
                        .then(() => toast.success("Classification updated"))
                        .catch((classificationError) =>
                          toast.error(getDisplayErrorMessage(classificationError, "Classification update failed"))
                        )
                    }
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void overrideClassification
                        .mutateAsync({ sourceItemId: item.source_item_id, documentTypeId: null })
                        .then(() => toast.success("Classification cleared"))
                        .catch((classificationError) =>
                          toast.error(getDisplayErrorMessage(classificationError, "Classification clear failed"))
                        )
                    }
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <StatePanel message="No unclassified documents in this matter." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Missing proof</CardTitle>
          <CardDescription>Requirements that are still not satisfied by the current document set.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.missing_proof.length ? (
            data.missing_proof.map((item) => (
              <div key={item.proof_requirement_id} className="rounded-lg border p-4">
                <div className="font-medium">{formatLabel(item.requirement_key)}</div>
                <div className="text-sm text-muted-foreground">
                  {formatLabel(item.issue_type)} • {formatLabel(item.requirement_policy)}
                  {item.rationale ? ` • ${item.rationale}` : ""}
                </div>
              </div>
            ))
          ) : (
            <StatePanel message="No missing proof requirements are currently flagged." />
          )}
        </CardContent>
      </Card>

      <LazyPdfPreviewDialog
        open={preview.open}
        title={preview.title}
        file={preview.file}
        onOpenChange={(open) =>
          setPreview((current) => (open ? { ...current, open } : { title: "", file: null, open: false }))
        }
      />
    </div>
  );
}
