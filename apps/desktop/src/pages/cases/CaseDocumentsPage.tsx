import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LazyPdfPreviewDialog } from "@/components/documents/LazyPdfPreviewDialog";
import { useCaseActions } from "@/hooks/useCaseActions";
import { useDocumentTable } from "@/hooks/useDocumentTable";
import { useProjection } from "@/hooks/useProjection";
import { getDisplayErrorMessage, previewFile } from "@/lib/api-client";
import { formatDateTime, formatLabel } from "@/ui/formatters";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";

export function CaseDocumentsPage() {
  const { caseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projection, error, isLoading } = useProjection(caseId);
  const { rows, rawRows, categories, ocrStatuses, search, setSearch, categoryFilter, setCategoryFilter, ocrFilter, setOcrFilter, setSort } =
    useDocumentTable(projection);
  const { queueOcrMutation } = useCaseActions(caseId);
  const [preview, setPreview] = useState<{ title: string; file: Blob | null; open: boolean }>({
    title: "",
    file: null,
    open: false
  });
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const needsAttentionCount = useMemo(() => rows.filter((row) => row.reviewRequired).length, [rows]);

  useEffect(() => {
    const focus = searchParams.get("sourceItem")?.trim();
    if (!focus || rawRows.length === 0) return;
    const match = rawRows.find((row) => row.sourceItemId === focus || row.id === focus);
    if (match) {
      setSearch(match.title);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("sourceItem");
    setSearchParams(next, { replace: true });
  }, [rawRows, searchParams, setSearch, setSearchParams]);

  async function openPreview(sourceItemId: string, title: string) {
    if (!caseId) {
      toast.error("Case id missing");
      return;
    }
    try {
      setPreviewLoadingId(sourceItemId);
      const blob = await previewFile(caseId, sourceItemId);
      setPreview({ title, file: blob, open: true });
    } catch (previewError) {
      toast.error(getDisplayErrorMessage(previewError, "Preview failed"));
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function queueCaseOcr() {
    try {
      await queueOcrMutation.mutateAsync(undefined);
      toast.success("OCR jobs queued");
    } catch (queueError) {
      toast.error(getDisplayErrorMessage(queueError, "Queue OCR failed"));
    }
  }

  async function queueDocumentOcr(canonicalDocumentId: string) {
    try {
      await queueOcrMutation.mutateAsync({
        canonical_document_id: canonicalDocumentId,
        force_rerun: true
      });
      toast.success("Document OCR re-queued");
    } catch (queueError) {
      toast.error(getDisplayErrorMessage(queueError, "Document OCR re-queue failed"));
    }
  }

  if (error) {
    return <StatePanel variant="error" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">
            Main working surface for document review, filtering, preview, and OCR operations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{rows.length} visible</Badge>
          <Badge variant="outline">{needsAttentionCount} need review</Badge>
          <Button disabled={queueOcrMutation.isPending} onClick={() => void queueCaseOcr()}>
            {queueOcrMutation.isPending ? "Queueing…" : "Queue OCR"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter documents</CardTitle>
          <CardDescription>Search by title or narrow by category and OCR state.</CardDescription>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search title, type, or OCR state…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {formatLabel(category)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ocrFilter} onValueChange={setOcrFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All OCR states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All OCR states</SelectItem>
                {ocrStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <PageSkeleton rows={6} />
          ) : rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => setSort("title")}>Title</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort("documentType")}>Type</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort("category")}>Category</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort("ocrStatus")}>OCR</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort("pageCount")}>Pages</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort("updatedAt")}>Updated</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className={row.reviewRequired ? "bg-amber-500/5" : undefined}>
                      <TableCell>
                        <div className="font-medium">{row.title}</div>
                        <div className="text-xs text-muted-foreground">{row.sourceKind ? formatLabel(row.sourceKind) : "Canonical document"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.documentType ? "outline" : "secondary"}>
                          {row.documentType ? formatLabel(row.documentType) : "Unclassified"}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.category ? formatLabel(row.category) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={row.reviewRequired ? "destructive" : "outline"}>
                          {formatLabel(row.ocrStatus ?? "unknown")}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.pageCount}</TableCell>
                      <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {row.sourceItemId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={previewLoadingId === row.sourceItemId || !row.previewSupported}
                              onClick={() => void openPreview(row.sourceItemId!, row.title)}
                            >
                              {previewLoadingId === row.sourceItemId
                                ? "Loading…"
                                : row.previewSupported
                                  ? "Preview PDF"
                                  : "PDF only"}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">No file</span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void queueDocumentOcr(row.canonicalDocumentId)}
                          >
                            Re-queue OCR
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <StatePanel message="No documents match the current filters." className="text-center" />
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
