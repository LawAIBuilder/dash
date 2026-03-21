import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { FileCheck2, FolderSync, ShieldAlert, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProjection } from "@/hooks/useProjection";
import { useCaseActions } from "@/hooks/useCaseActions";
import { formatDateTime, formatLabel, summarizeCountRecord } from "@/ui/formatters";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";

function MetricCard({
  icon: Icon,
  label,
  value,
  detail
}: {
  icon: typeof FolderSync;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
          <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CaseOverviewPage() {
  const { caseId } = useParams();
  const { projection, watermark, isLoading, error, refresh } = useProjection(caseId);
  const { syncMutation, normalizeMutation, queueOcrMutation, heuristicMutation } = useCaseActions(caseId);
  const branchSlice = projection?.slices?.branch_state_slice;
  const issueProofSlice = projection?.slices?.issue_proof_slice;

  const metrics = useMemo(() => {
    const classification = projection?.slices.document_inventory_slice?.classification_summary;
    const ocr = projection?.slices.document_inventory_slice?.ocr_summary;
    const branch = branchSlice?.branch_instances?.[0];
    const proofRequirements = issueProofSlice?.proof_requirements ?? [];
    const satisfiedProof = proofRequirements.filter((item) => item.satisfied === 1).length;
    return {
      sourceItems: classification?.total ?? 0,
      classifiedPercent:
        classification && classification.total > 0
          ? `${Math.round((classification.classified / classification.total) * 100)}%`
          : "0%",
      ocrCompletePercent:
        ocr && ocr.total_pages > 0
          ? `${Math.round(((ocr.by_ocr_status.complete ?? 0) / ocr.total_pages) * 100)}%`
          : "0%",
      branchStage: branch?.current_stage_key ? formatLabel(branch.current_stage_key) : "Not started",
      reviewCount: ocr?.review_required_count ?? 0,
      proofSatisfied: `${satisfiedProof}/${proofRequirements.length}`
    };
  }, [branchSlice, issueProofSlice, projection]);

  async function runAction(
    action: "sync" | "normalize" | "ocr" | "heuristics",
    handler: () => Promise<Record<string, unknown>>
  ) {
    try {
      const result = await handler();
      toast.success(`${formatLabel(action)} completed`);
      await refresh();
      return result;
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : `${formatLabel(action)} failed`);
      throw actionError;
    }
  }

  if (error) {
    return <StatePanel variant="error" message={error} />;
  }

  if (isLoading || !projection) {
    return <PageSkeleton rows={4} />;
  }

  const caseHeader = projection.slices.case_header;
  const branchStatus = branchSlice?.branch_stage_status ?? [];
  const proofRequirements = issueProofSlice?.proof_requirements ?? [];
  const activeConnection = projection.slices.source_connection_slice?.connections[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>{formatLabel(caseHeader?.case_type ?? "matter")}</Badge>
            <Badge variant="outline">{formatLabel(caseHeader?.status ?? "unknown")}</Badge>
          </div>
          <h2 className="text-2xl font-semibold">{caseHeader?.name ?? "Untitled matter"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Matter ID {caseHeader?.id ?? "unknown"} • Projection-backed case summary
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={syncMutation.isPending} onClick={() => void runAction("sync", () => syncMutation.mutateAsync())}>
            {syncMutation.isPending ? "Syncing…" : "Sync Box"}
          </Button>
          <Button
            variant="outline"
            disabled={normalizeMutation.isPending}
            onClick={() => void runAction("normalize", () => normalizeMutation.mutateAsync())}
          >
            {normalizeMutation.isPending ? "Normalizing…" : "Normalize"}
          </Button>
          <Button
            variant="outline"
            disabled={queueOcrMutation.isPending}
            onClick={() => void runAction("ocr", () => queueOcrMutation.mutateAsync(undefined))}
          >
            {queueOcrMutation.isPending ? "Queueing OCR…" : "Queue OCR"}
          </Button>
          <Button
            variant="outline"
            disabled={heuristicMutation.isPending}
            onClick={() => void runAction("heuristics", () => heuristicMutation.mutateAsync())}
          >
            {heuristicMutation.isPending ? "Running heuristics…" : "Run extractions"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard icon={FolderSync} label="Source items" value={String(metrics.sourceItems)} detail="files inventoried from connected sources" />
        <MetricCard icon={FileCheck2} label="Classified" value={metrics.classifiedPercent} detail="documents mapped to a legal type" />
        <MetricCard icon={Sparkles} label="OCR complete" value={metrics.ocrCompletePercent} detail="pages ready for extraction and review" />
        <MetricCard icon={ShieldAlert} label="Needs review" value={String(metrics.reviewCount)} detail="OCR or document issues requiring attention" />
        <MetricCard icon={Workflow} label="Branch stage" value={metrics.branchStage} detail={`proof requirements satisfied ${metrics.proofSatisfied}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <CardTitle>Proof tracker</CardTitle>
            <CardDescription>What is already supported vs what still needs evidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {proofRequirements.length > 0 ? (
              proofRequirements.map((requirement) => (
                <div key={requirement.id} className="flex items-start justify-between gap-4 rounded-lg border p-4">
                  <div>
                    <div className="font-medium">{formatLabel(requirement.requirement_key)}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatLabel(requirement.requirement_policy)}{requirement.rationale ? ` • ${requirement.rationale}` : ""}
                    </div>
                  </div>
                  <Badge variant={requirement.satisfied === 1 ? "default" : "outline"}>
                    {requirement.satisfied === 1 ? "Met" : "Missing"}
                  </Badge>
                </div>
              ))
            ) : (
              <StatePanel message="No proof requirements are present for this matter yet." />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>Current source health for the active matter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {activeConnection ? (
                <>
                  <div className="flex items-center justify-between">
                    <span>Provider</span>
                    <Badge variant="outline">{formatLabel(activeConnection.provider)}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Connection status</span>
                    <Badge>{formatLabel(activeConnection.status)}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Latest sync</span>
                    <span className="text-muted-foreground">
                      {formatLabel(activeConnection.latest_sync_status ?? "not_synced")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Last verified</span>
                    <span className="text-muted-foreground">{formatDateTime(activeConnection.last_verified_at)}</span>
                  </div>
                </>
              ) : (
                <StatePanel message="No source connection yet." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Snapshot and projection details kept visible but no longer dominant.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Projection version</span>
                <span className="text-muted-foreground">{projection.projection_version}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last pull</span>
                <span className="text-muted-foreground">{formatDateTime(watermark?.last_pull_at ?? null)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Page states</span>
                <span className="max-w-[16rem] text-right text-muted-foreground">
                  {summarizeCountRecord(
                    projection.slices.canonical_spine_slice?.state_summary?.page_state_counts ?? {}
                  )}
                </span>
              </div>
              {branchStatus.length > 0 ? (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Latest branch note</div>
                  <div>{branchStatus[branchStatus.length - 1]?.progress_summary ?? "No stage summary available."}</div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
