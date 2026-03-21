import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, FolderSync, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useProjection } from "@/hooks/useProjection";
import { useCaseActions } from "@/hooks/useCaseActions";
import {
  useOcrWorkerHealth,
  usePracticePantherMatters,
  usePracticePantherStatus,
  useProbeBoxJwt,
  useStartPracticePantherAuth,
  useSyncPracticePanther
} from "@/hooks/useConnections";
import { useCaseDetail, useUpdateCase } from "@/hooks/useCaseDetail";
import { formatDateTime, formatLabel, truncateMiddle } from "@/ui/formatters";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CaseConnectionsPage() {
  const { caseId } = useParams();
  const { projection, error, isLoading } = useProjection(caseId);
  const { syncMutation } = useCaseActions(caseId);
  const probeMutation = useProbeBoxJwt(caseId);
  const workerHealth = useOcrWorkerHealth();
  const ppStatus = usePracticePantherStatus();
  const caseDetail = useCaseDetail(caseId);
  const updateCaseMutation = useUpdateCase(caseId);
  const startPpAuth = useStartPracticePantherAuth(caseId);
  const syncPracticePanther = useSyncPracticePanther(caseId);
  const [rootFolderId, setRootFolderId] = useState("");
  const [ppMatterId, setPpMatterId] = useState("");
  const [ppSearchText, setPpSearchText] = useState("");
  const ppMatters = usePracticePantherMatters(Boolean(ppStatus.data?.connection?.status === "active"), ppSearchText);

  const caseHeader = projection?.slices.case_header ?? null;
  const connection = projection?.slices.source_connection_slice?.connections[0] ?? null;
  const ppConnection = ppStatus.data?.connection ?? null;
  const ocrSummary = projection?.slices.document_inventory_slice?.ocr_summary ?? null;
  const queuedPages = ocrSummary?.by_ocr_status?.queued ?? 0;
  const processingPages = ocrSummary?.by_ocr_status?.processing ?? 0;
  const reviewPages = ocrSummary?.review_required_count ?? 0;
  const workerHealthLabel = workerHealth.isLoading
    ? "Loading"
    : workerHealth.isError
      ? "Unavailable"
      : workerHealth.data?.stale
        ? "Stale"
        : workerHealth.data?.worker
          ? "Healthy"
          : "Unavailable";
  const workerHealthVariant =
    workerHealth.isError || workerHealthLabel === "Unavailable"
      ? "secondary"
      : workerHealthLabel === "Stale"
        ? "destructive"
        : "outline";

  useEffect(() => {
    setRootFolderId(caseDetail.data?.box_root_folder_id ?? caseHeader?.box_root_folder_id ?? "");
  }, [caseDetail.data?.box_root_folder_id, caseHeader?.box_root_folder_id]);

  useEffect(() => {
    setPpMatterId(caseDetail.data?.pp_matter_id ?? caseHeader?.pp_matter_id ?? "");
  }, [caseDetail.data?.pp_matter_id, caseHeader?.pp_matter_id]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const authState = url.searchParams.get("pp_auth");
    const authError = url.searchParams.get("pp_error");
    if (authState === "success") {
      toast.success("PracticePanther connected");
      url.searchParams.delete("pp_auth");
      url.searchParams.delete("pp_error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    } else if (authState === "error") {
      toast.error(authError || "PracticePanther authentication failed");
      url.searchParams.delete("pp_auth");
      url.searchParams.delete("pp_error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }, []);

  if (error) {
    return <StatePanel variant="error" message={error} />;
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

  async function savePracticePantherMatter() {
    try {
      await updateCaseMutation.mutateAsync({
        pp_matter_id: ppMatterId.trim() || null
      });
      toast.success("PracticePanther matter link updated");
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : "Failed to update PP matter");
    }
  }

  async function beginPracticePantherAuth() {
    try {
      const result = await startPpAuth.mutateAsync({
        return_to: window.location.href
      });
      window.location.assign(result.authorization_url);
    } catch (authError) {
      toast.error(authError instanceof Error ? authError.message : "PracticePanther auth start failed");
    }
  }

  async function runPracticePantherSync() {
    try {
      await syncPracticePanther.mutateAsync({
        pp_matter_id: ppMatterId.trim() || null
      });
      toast.success("PracticePanther sync completed");
    } catch (syncError) {
      toast.error(syncError instanceof Error ? syncError.message : "PracticePanther sync failed");
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
              <>
                <StatePanel message="No Box connection has been established for this matter yet. Set the root folder, probe JWT access, and run the first sync from here." />
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
                    Use the matter's Client File folder ID. Save it here before the first sync.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
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
                </div>
              </>
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
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Worker state</div>
                  <div className="mt-1 font-medium">
                    {workerHealth.data?.worker
                      ? formatLabel(workerHealth.data.worker.status)
                      : "Unavailable"}
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Last heartbeat</div>
                  <div className="mt-1 font-medium">
                    {workerHealth.data?.worker?.last_heartbeat_at
                      ? formatDateTime(workerHealth.data.worker.last_heartbeat_at)
                      : "No heartbeat"}
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Worker health</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={workerHealthVariant}>
                      {workerHealthLabel}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                {workerHealth.data?.worker?.last_error_message
                  ? `Worker error: ${workerHealth.data.worker.last_error_message}`
                  : queuedPages > 0 || processingPages > 0
                    ? "Queued OCR is visible and the shared worker heartbeat is being monitored here."
                    : "No queued OCR backlog is visible for this matter."}
              </div>
            </CardContent>
          </Card>

          <Card>
          <CardHeader>
            <CardTitle>PracticePanther</CardTitle>
            <CardDescription>Production OAuth + matter sync for PracticePanther.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">OAuth redirect URI</div>
              <div className="mt-1 break-all text-sm font-medium">
                {ppStatus.data?.redirect_uri ?? "Unavailable"}
              </div>
            </div>

            {!ppStatus.data?.configured ? (
              <StatePanel message="PracticePanther OAuth is not fully configured yet. Set PP_CLIENT_ID, PP_CLIENT_SECRET, and the redirect URI on the API service." />
            ) : null}

            {ppConnection ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Connection status</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge>{formatLabel(ppConnection.status)}</Badge>
                    <Badge variant="outline">{formatLabel(ppConnection.auth_mode)}</Badge>
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Account</div>
                  <div className="mt-1 font-medium">
                    {ppConnection.external_account_id ?? ppConnection.account_label ?? "Not connected"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ppConnection.last_verified_at ? formatDateTime(ppConnection.last_verified_at) : "Not verified yet"}
                  </div>
                </div>
              </div>
            ) : (
              <StatePanel message="No PracticePanther connection has been established yet." />
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!ppStatus.data?.configured || startPpAuth.isPending}
                onClick={() => void beginPracticePantherAuth()}
              >
                {startPpAuth.isPending
                  ? "Redirecting…"
                  : ppConnection?.status === "active"
                    ? "Reconnect PracticePanther"
                    : "Connect PracticePanther"}
              </Button>
              {ppConnection?.authorization_url ? (
                <Button variant="outline" asChild>
                  <a href={ppConnection.authorization_url} target="_blank" rel="noreferrer">
                    Resume auth
                    <ArrowUpRight className="ml-2 size-4" />
                  </a>
                </Button>
              ) : null}
            </div>

            {ppConnection?.last_error_message ? (
              <StatePanel variant="error" message={ppConnection.last_error_message} />
            ) : null}

            <div className="space-y-2 rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Linked PracticePanther matter</div>
              {ppMatters.data?.length ? (
                <Select value={ppMatterId} onValueChange={setPpMatterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a PracticePanther matter" />
                  </SelectTrigger>
                  <SelectContent>
                    {ppMatters.data.map((matter) => (
                      <SelectItem key={matter.id} value={matter.id}>
                        {(matter.display_name || matter.name || matter.id)}{matter.status ? ` • ${matter.status}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="PracticePanther matter ID"
                  value={ppMatterId}
                  onChange={(event) => setPpMatterId(event.target.value)}
                />
              )}
              <Input
                placeholder="Search remote PP matters (optional)"
                value={ppSearchText}
                onChange={(event) => setPpSearchText(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={updateCaseMutation.isPending} onClick={() => void savePracticePantherMatter()}>
                  {updateCaseMutation.isPending ? "Saving…" : "Save linked PP matter"}
                </Button>
                <Button
                  disabled={syncPracticePanther.isPending || !ppMatterId.trim()}
                  onClick={() => void runPracticePantherSync()}
                >
                  {syncPracticePanther.isPending ? "Syncing…" : "Sync PracticePanther"}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                The sync uses the linked PP matter plus account contacts, notes, tasks, events, emails, call logs, and relationships.
              </div>
            </div>
          </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
