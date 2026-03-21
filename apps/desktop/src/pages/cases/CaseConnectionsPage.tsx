import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, FolderSync, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useProjection } from "@/hooks/useProjection";
import { useCaseActions } from "@/hooks/useCaseActions";
import { useProbeBoxJwt } from "@/hooks/useConnections";
import { useCaseDetail, useUpdateCase } from "@/hooks/useCaseDetail";
import { formatDateTime, formatLabel, truncateMiddle } from "@/ui/formatters";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { useEffect, useState } from "react";

export function CaseConnectionsPage() {
  const { caseId } = useParams();
  const { projection, error, isLoading } = useProjection(caseId);
  const { syncMutation } = useCaseActions(caseId);
  const probeMutation = useProbeBoxJwt(caseId);
  const caseDetail = useCaseDetail(caseId);
  const updateCaseMutation = useUpdateCase(caseId);
  const [rootFolderId, setRootFolderId] = useState("");

  const caseHeader = projection?.slices.case_header ?? null;
  const connection = projection?.slices.source_connection_slice?.connections[0] ?? null;
  const ocrSummary = projection?.slices.document_inventory_slice.ocr_summary ?? null;
  const queuedPages = ocrSummary?.by_ocr_status?.queued ?? 0;
  const processingPages = ocrSummary?.by_ocr_status?.processing ?? 0;
  const reviewPages = ocrSummary?.review_required_count ?? 0;

  useEffect(() => {
    setRootFolderId(caseDetail.data?.box_root_folder_id ?? caseHeader?.box_root_folder_id ?? "");
  }, [caseDetail.data?.box_root_folder_id, caseHeader?.box_root_folder_id]);

  if (error) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  }

  if (isLoading) {
    return <PageSkeleton rows={3} />;
  }

  async function saveRootFolder() {
    try {
      await updateCaseMutation.mutateAsync({
        box_root_folder_id: rootFolderId.trim() || null
      });
      toast.success("Box root folder updated");
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : "Failed to update case");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Connections</h2>
        <p className="text-sm text-muted-foreground">
          Make source health understandable and keep sync operations visible.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" />
              Box connection
            </CardTitle>
            <CardDescription>Current connection health and the matter's linked root folder.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connection ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge>{formatLabel(connection.status)}</Badge>
                      <Badge variant="outline">{formatLabel(connection.auth_mode)}</Badge>
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">Latest sync</div>
                    <div className="mt-1 font-medium">
                      {formatLabel(connection.latest_sync_status ?? "not_synced")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(connection.latest_sync_completed_at ?? connection.latest_sync_started_at ?? null)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">External account</div>
                    <div className="mt-1 font-medium">{connection.external_account_id ?? "Not recorded"}</div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">Inventory</div>
                    <div className="mt-1 font-medium">
                      {connection.source_item_count ?? 0} source items • {connection.snapshot_count ?? 0} snapshots
                    </div>
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Matter Box root folder</div>
                  <div className="flex gap-2">
                    <Input value={rootFolderId} onChange={(event) => setRootFolderId(event.target.value)} />
                    <Button
                      variant="outline"
                      disabled={updateCaseMutation.isPending}
                      onClick={() => void saveRootFolder()}
                    >
                      {updateCaseMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use the matter's Client File folder ID. This is the value the Box sync action reads by default.
                  </div>
                </div>

                {connection.last_error_message ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    {connection.last_error_message}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={syncMutation.isPending}
                    onClick={() =>
                      void syncMutation
                        .mutateAsync()
                        .then(() => toast.success("Box sync completed"))
                        .catch((syncError) =>
                          toast.error(syncError instanceof Error ? syncError.message : "Box sync failed")
                        )
                    }
                  >
                    <FolderSync className="mr-2 size-4" />
                    {syncMutation.isPending ? "Syncing…" : "Sync Box now"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={probeMutation.isPending}
                    onClick={() =>
                      void probeMutation
                        .mutateAsync()
                        .then(() => toast.success("Box JWT probe succeeded"))
                        .catch((probeError) =>
                          toast.error(probeError instanceof Error ? probeError.message : "JWT probe failed")
                        )
                    }
                  >
                    {probeMutation.isPending ? "Probing…" : "Probe JWT"}
                  </Button>
                  {connection.authorization_url ? (
                    <Button
                      variant="outline"
                      asChild
                    >
                      <a href={connection.authorization_url} target="_blank" rel="noreferrer">
                        Resume auth
                        <ArrowUpRight className="ml-2 size-4" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No Box connection has been established for this matter yet.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>OCR worker status</CardTitle>
              <CardDescription>Whether queued OCR is likely being drained or just stacking up.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Queued</div>
                  <div className="mt-1 text-2xl font-semibold">{queuedPages}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Processing</div>
                  <div className="mt-1 text-2xl font-semibold">{processingPages}</div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Needs review</div>
                  <div className="mt-1 text-2xl font-semibold">{reviewPages}</div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                {queuedPages > 0 || processingPages > 0
                  ? "The API can queue OCR from the UI, but you still need the OCR worker process running in production to drain those jobs."
                  : "No queued OCR backlog is visible for this matter."}
              </div>
            </CardContent>
          </Card>

          <Card>
          <CardHeader>
            <CardTitle>PracticePanther</CardTitle>
            <CardDescription>Product placeholder until the production OAuth + sync path is implemented.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              PracticePanther production sync is not wired yet. The roadmap reserves this for Milestone 2 once the Box-first lawyer workspace is stable.
            </div>
            {caseHeader?.pp_matter_id ? (
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Linked PP matter ID</div>
                <div className="mt-1 font-medium">{truncateMiddle(caseHeader.pp_matter_id, 12, 8)}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No PP matter is linked to this case yet.</div>
            )}
          </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
