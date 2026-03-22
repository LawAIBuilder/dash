import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileUp, Loader2, Package, Play, FileDown, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { useCreateExhibitPacket, useExhibitWorkspace } from "@/hooks/useExhibits";
import { useUpdateExhibitPacket } from "@/hooks/useExhibits";
import {
  usePackageRules,
  usePackageRuns,
  useCreatePackageRule,
  useDeletePackageRule,
  useUploadToCase,
  useApprovePackageRun,
  useTriggerPackageRun,
  useUpdatePackageRunDraft
} from "@/hooks/usePackages";
import { useHearingPrepSnapshot } from "@/hooks/useHearingPrepSnapshot";
import { useProjection } from "@/hooks/useProjection";
import { describeApiFailure, exportPackageRunDocx, getDisplayErrorMessage } from "@/lib/api-client";
import type { PackageRun } from "@/lib/api-client";
import { formatDateTime, formatLabel } from "@/ui/formatters";
import { toast } from "sonner";
import { DraftEditor } from "@/components/packages/DraftEditor";
import { CitationPanel, type PackageCitation } from "@/components/packages/CitationPanel";
import { QAChecklist } from "@/components/packages/QAChecklist";

const PKG_TYPES = ["hearing_packet", "claim_petition", "discovery_response"] as const;

function parseWorkerOutput(outputJson: string | null): {
  draft_markdown: string;
  edited_draft_markdown: string | null;
  qa_checklist: Array<{ check_id?: string; label?: string; status?: string; detail?: string }>;
  citations: PackageCitation[];
  interrogatory_parse: unknown[] | null;
  extra: Record<string, unknown>;
} {
  if (!outputJson) {
    return {
      draft_markdown: "",
      edited_draft_markdown: null,
      qa_checklist: [],
      citations: [],
      interrogatory_parse: null,
      extra: {}
    };
  }
  try {
    const o = JSON.parse(outputJson) as Record<string, unknown>;
    const draft = typeof o.draft_markdown === "string" ? o.draft_markdown : "";
    const edited = typeof o.edited_draft_markdown === "string" ? o.edited_draft_markdown : null;
    const qaList = Array.isArray(o.qa_checklist)
      ? (o.qa_checklist as Array<{ check_id?: string; label?: string; status?: string; detail?: string }>)
      : [];
    let citations: PackageCitation[] = [];
    if (Array.isArray(o.citations)) citations = o.citations as PackageCitation[];
    const interrogatory_parse = Array.isArray(o.interrogatory_parse) ? o.interrogatory_parse : null;
    return {
      draft_markdown: draft,
      edited_draft_markdown: edited,
      qa_checklist: qaList,
      citations,
      interrogatory_parse,
      extra: o
    };
  } catch {
    return {
      draft_markdown: outputJson,
      edited_draft_markdown: null,
      qa_checklist: [],
      citations: [],
      interrogatory_parse: null,
      extra: {}
    };
  }
}

function parseCitationsFromRun(run: PackageRun): PackageCitation[] {
  const fromOutput = parseWorkerOutput(run.output_json);
  if (fromOutput.citations.length > 0) return fromOutput.citations;
  if (run.citations_json) {
    try {
      const c = JSON.parse(run.citations_json) as unknown;
      return Array.isArray(c) ? (c as PackageCitation[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function describePackageRunFailure(run: PackageRun): string {
  return describeApiFailure({
    code: run.error_code,
    message: run.error_message,
    fallback: "Package run failed"
  });
}

export function CasePackagesPage() {
  const { caseId } = useParams();
  const normalizedCaseId = caseId ?? "";
  const exhibitQuery = useExhibitWorkspace(caseId);
  const packets = exhibitQuery.data ?? [];
  const isLoading = exhibitQuery.isLoading;
  const refresh = exhibitQuery.refetch;
  const { projection } = useProjection(caseId);
  const [pkgType, setPkgType] = useState<string>("hearing_packet");
  const { data: rules = [] } = usePackageRules(caseId, pkgType);

  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  useEffect(() => {
    if (packets.length === 0) {
      setSelectedPacketId(null);
      return;
    }
    setSelectedPacketId((current) => {
      if (current && packets.some((p) => p.id === current)) return current;
      return packets[0]?.id ?? null;
    });
  }, [packets]);

  const activePacket = useMemo(
    () => packets.find((p) => p.id === selectedPacketId) ?? packets[0] ?? null,
    [packets, selectedPacketId]
  );

  const { data: runs = [], refetch: refetchRuns } = usePackageRuns(normalizedCaseId, activePacket?.id);
  const updateDraft = useUpdatePackageRunDraft(normalizedCaseId, activePacket?.id);
  const approveRun = useApprovePackageRun(normalizedCaseId, activePacket?.id);
  const hearingSnapshot = useHearingPrepSnapshot(
    caseId,
    activePacket?.package_type === "hearing_packet" ? activePacket.id : null
  );

  const createPacket = useCreateExhibitPacket(caseId);
  const updatePacket = useUpdateExhibitPacket(caseId);
  const createRule = useCreatePackageRule(normalizedCaseId);
  const deleteRule = useDeletePackageRule(normalizedCaseId);
  const upload = useUploadToCase(normalizedCaseId);
  const runWorker = useTriggerPackageRun(normalizedCaseId);

  const [ruleKey, setRuleKey] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");
  const [ruleInstr, setRuleInstr] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newPkgName, setNewPkgName] = useState("");
  const [newPkgType, setNewPkgType] = useState<string>("hearing_packet");

  const sourceItems =
    projection?.slices.document_inventory_slice?.source_items.filter(
      (item) => item.source_kind === "upload" || item.source_kind === "file"
    ) ?? [];

  if (!caseId) return null;
  if (isLoading) return <PageSkeleton />;

  const discoveryHints = activePacket?.package_type === "discovery_response";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Packages</h2>
          <p className="text-muted-foreground text-sm">
            Hearing packets, claim petitions, and discovery responses — rules, uploads, and package runs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/cases/${caseId}/exhibits${activePacket ? `?packetId=${encodeURIComponent(activePacket.id)}` : ""}`}>
              Open hearing exhibits
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/cases/${caseId}/templates`}>Templates</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <Package className="text-muted-foreground size-5" />
            <CardTitle className="text-base">Active packages</CardTitle>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setNewPkgName("");
              setNewPkgType("hearing_packet");
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 size-4" />
            New package
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {packets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No packages yet. Click &quot;New package&quot; to create one.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] space-y-1">
                <label className="text-muted-foreground text-xs">Package for runs &amp; rules</label>
                <Select value={activePacket?.id ?? ""} onValueChange={(id) => setSelectedPacketId(id)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select package" />
                  </SelectTrigger>
                  <SelectContent>
                    {packets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.packet_name} ({formatLabel(p.package_type ?? "hearing_packet")})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {packets.length > 0 ? (
            <ul className="space-y-2 pt-2">
              {packets.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <div>
                    <div className="font-medium">{p.packet_name}</div>
                    <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{formatLabel(p.package_type ?? "hearing_packet")}</Badge>
                      {p.run_status ? <span>Run: {p.run_status}</span> : null}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/cases/${caseId}/exhibits?packetId=${encodeURIComponent(p.id)}`}>Edit exhibits</Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {discoveryHints ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Discovery response workflow</CardTitle>
            <p className="text-muted-foreground text-sm">
              Upload interrogatories or requests for production above, link them as the target document on the exhibit packet if
              your API workflow uses <code className="rounded bg-muted px-1">target_document_source_item_id</code>, then run the
              worker. Parsed request count and per-request QA appear in the run output after completion.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      {activePacket ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active package metadata</CardTitle>
            <p className="text-muted-foreground text-sm">
              Link target documents and keep package-specific context explicit instead of relying on out-of-band notes.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[260px_minmax(0,1fr)_auto]">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Package type</div>
                <Badge variant="secondary">{formatLabel(activePacket.package_type ?? "hearing_packet")}</Badge>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Target document</div>
                <Select
                  value={activePacket.target_document_source_item_id ?? "__none__"}
                  onValueChange={(value) =>
                    updatePacket
                      .mutateAsync({
                        packetId: activePacket.id,
                        input: {
                          target_document_source_item_id: value === "__none__" ? null : value
                        }
                      })
                      .then(() => toast.success("Target document updated"))
                      .catch((e) => toast.error(getDisplayErrorMessage(e, "Failed to update target document")))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target document" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No target document</SelectItem>
                    {sourceItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title ?? item.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Current link</div>
                <div className="text-sm text-muted-foreground">
                  {activePacket.target_document_source_item_id
                    ? activePacket.target_document_source_item_id
                    : "Not linked"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activePacket?.package_type === "hearing_packet" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hearing prep snapshot</CardTitle>
            <p className="text-muted-foreground text-sm">
              Structured runner context derived from the current matter, packet, proof gaps, people, and timeline.
            </p>
          </CardHeader>
          <CardContent>
            {hearingSnapshot.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading hearing snapshot…</p>
            ) : hearingSnapshot.error ? (
              <p className="text-destructive text-sm">
                {getDisplayErrorMessage(hearingSnapshot.error, "Hearing snapshot failed")}
              </p>
            ) : hearingSnapshot.data ? (
              <div className="space-y-3">
                {Object.entries(hearingSnapshot.data).map(([key, value]) => {
                  const summary = Array.isArray(value)
                    ? `${value.length} item${value.length === 1 ? "" : "s"}`
                    : value && typeof value === "object"
                      ? `${Object.keys(value as Record<string, unknown>).length} field${
                          Object.keys(value as Record<string, unknown>).length === 1 ? "" : "s"
                        }`
                      : "present";
                  return (
                    <details key={key} className="rounded-md border bg-muted/20 px-3 py-2">
                      <summary className="cursor-pointer text-sm font-medium">
                        {formatLabel(key)} • {summary}
                      </summary>
                      <pre className="mt-2 overflow-auto rounded bg-background p-2 text-xs whitespace-pre-wrap">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    </details>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No hearing snapshot available.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload target document</CardTitle>
          <p className="text-muted-foreground text-sm">
            Interrogatories, narratives, and other targets for discovery or petition flows.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <FileUp className="size-4" />
            <span>Choose file</span>
            <Input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  upload.mutate(f, {
                    onSuccess: () => toast.success("Upload completed"),
                    onError: (error) => toast.error(getDisplayErrorMessage(error, "Upload failed"))
                  });
                }
              }}
            />
          </label>
          {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {upload.isSuccess ? <span className="text-muted-foreground text-xs">Uploaded. Refresh documents to see it.</span> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Package rules</CardTitle>
          <p className="text-muted-foreground text-xs">
            New cases receive default MN WC rules; add or remove rows per matter. Switch type to view rules for each package.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {PKG_TYPES.map((t) => (
              <Button key={t} size="sm" variant={pkgType === t ? "default" : "outline"} onClick={() => setPkgType(t)}>
                {formatLabel(t)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3">
            <Input placeholder="rule_key" value={ruleKey} onChange={(e) => setRuleKey(e.target.value)} />
            <Input placeholder="Rule label" value={ruleLabel} onChange={(e) => setRuleLabel(e.target.value)} />
            <Input placeholder="Instructions" value={ruleInstr} onChange={(e) => setRuleInstr(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={!ruleKey.trim() || !ruleLabel.trim() || createRule.isPending}
            onClick={() =>
              createRule.mutate(
                { package_type: pkgType, rule_key: ruleKey.trim(), rule_label: ruleLabel.trim(), instructions: ruleInstr },
                {
                  onSuccess: () => {
                    toast.success("Rule added");
                    setRuleKey("");
                    setRuleLabel("");
                    setRuleInstr("");
                  },
                  onError: (error) => toast.error(getDisplayErrorMessage(error, "Failed to add rule"))
                }
              )
            }
          >
            Add rule
          </Button>
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{r.rule_label}</div>
                  <div className="text-muted-foreground text-xs">{r.instructions}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    deleteRule.mutate(r.id, {
                      onSuccess: () => toast.success("Rule removed"),
                      onError: (error) => toast.error(getDisplayErrorMessage(error, "Failed to remove rule"))
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Package runs</CardTitle>
          <p className="text-muted-foreground text-sm">
            Runs the package worker (retrieval + draft + QA). Configure OPENAI_API_KEY on the API.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!activePacket || runWorker.isPending}
              onClick={() =>
                activePacket &&
                runWorker.mutate(
                  { packetId: activePacket.id },
                  {
                    onSuccess: (run) => {
                      if (run.status === "failed") {
                        toast.error(describePackageRunFailure(run));
                      } else {
                        toast.success("Package run started");
                      }
                      void refetchRuns();
                    },
                    onError: (error) => toast.error(getDisplayErrorMessage(error, "Package run failed"))
                  }
                )
              }
            >
              {runWorker.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
              {activePacket?.package_type === "hearing_packet" ? "Run hearing prep" : "Run package worker"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Refresh workspace
            </Button>
          </div>
          {runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No runs yet.</p>
          ) : (
            <ul className="space-y-6">
              {runs.map((run) => {
                const parsed = parseWorkerOutput(run.output_json);
                const citations = parseCitationsFromRun(run);
                const structuredArtifactKeys = [
                  "case_profile",
                  "issue_matrix",
                  "fact_timeline",
                  "exhibit_catalog",
                  "witness_matrix",
                  "deadlines_and_requirements",
                  "read_coverage_log",
                  "open_questions",
                  "proof_to_relief_graph",
                  "hearing_readiness_checklist"
                ].filter((key) => key in parsed.extra);
                const interrogatoryCount = parsed.interrogatory_parse?.length ?? null;

                return (
                  <li key={run.id} className="rounded-lg border px-3 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Badge variant="outline">{formatLabel(run.status)}</Badge>{" "}
                        <Badge variant={run.approval_status === "approved" ? "default" : "secondary"}>
                          {formatLabel(run.approval_status ?? "pending")}
                        </Badge>{" "}
                        <span className="text-muted-foreground text-xs">{run.model ?? ""}</span>
                        {run.prompt_tokens != null ? (
                          <span className="text-muted-foreground ml-2 text-xs">
                            tokens {run.prompt_tokens}+{run.completion_tokens ?? 0}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={run.status !== "completed" || run.approval_status !== "approved"}
                        onClick={() =>
                          exportPackageRunDocx(normalizedCaseId, run.id)
                            .then(() => toast.success("DOCX export written on server"))
                            .catch((e) => toast.error(getDisplayErrorMessage(e, "Export failed")))
                        }
                      >
                        <FileDown className="mr-1 size-4" />
                        Export DOCX
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={run.status !== "completed" || run.approval_status === "approved" || approveRun.isPending}
                        onClick={() =>
                          approveRun
                            .mutateAsync({ runId: run.id })
                            .then(() => toast.success("Run approved for export"))
                            .catch((e) => toast.error(getDisplayErrorMessage(e, "Approval failed")))
                        }
                      >
                        Approve
                      </Button>
                    </div>
                    {discoveryHints && interrogatoryCount != null ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Parsed interrogatory segments in output: {interrogatoryCount}
                      </p>
                    ) : null}
                    {run.latest_exported_at ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Last export: {formatDateTime(run.latest_exported_at)} • {run.latest_export_format ?? "artifact"} •{" "}
                        {run.latest_export_bytes != null ? `${run.latest_export_bytes} bytes` : "size unknown"}
                      </p>
                    ) : null}
                    {run.error_message || run.error_code ? (
                      <div className="text-destructive mt-1 text-xs">{describePackageRunFailure(run)}</div>
                    ) : null}

                    {run.status === "completed" && run.output_json ? (
                      <div className="mt-4 grid gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
                          {structuredArtifactKeys.length > 0 ? (
                            <div className="mb-4 rounded-lg border bg-muted/30 p-3">
                              <div className="mb-2 text-sm font-medium">Structured artifacts present</div>
                              <div className="flex flex-wrap gap-2">
                                {structuredArtifactKeys.map((key) => (
                                  <Badge key={key} variant="outline">
                                    {formatLabel(key)}
                                  </Badge>
                                ))}
                              </div>
                              <div className="mt-3 space-y-2">
                                {structuredArtifactKeys.map((key) => {
                                  const value = parsed.extra[key];
                                  const summary = Array.isArray(value)
                                    ? `${value.length} item${value.length === 1 ? "" : "s"}`
                                    : value && typeof value === "object"
                                      ? `${Object.keys(value as Record<string, unknown>).length} field${
                                          Object.keys(value as Record<string, unknown>).length === 1 ? "" : "s"
                                        }`
                                      : "present";
                                  return (
                                    <details key={key} className="rounded-md border bg-background/70 px-3 py-2">
                                      <summary className="cursor-pointer text-sm font-medium">
                                        {formatLabel(key)} • {summary}
                                      </summary>
                                      <pre className="mt-2 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                                        {JSON.stringify(value, null, 2)}
                                      </pre>
                                    </details>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                          <DraftEditor
                            aiDraftMarkdown={parsed.draft_markdown || "(no draft_markdown in output)"}
                            savedEditedMarkdown={parsed.edited_draft_markdown}
                            savePending={updateDraft.isPending}
                            onSave={(markdown) =>
                              updateDraft.mutate(
                                { runId: run.id, markdown },
                                {
                                  onSuccess: () => {
                                    toast.success("Draft saved");
                                    void refetchRuns();
                                  },
                                  onError: (e) => toast.error(getDisplayErrorMessage(e, "Save failed"))
                                }
                              )
                            }
                          />
                        </div>
                        <div className="space-y-4">
                          <div>
                            <div className="mb-2 text-sm font-medium">QA checklist</div>
                            <QAChecklist items={parsed.qa_checklist} />
                          </div>
                          <div>
                            <div className="mb-2 text-sm font-medium">Citations</div>
                            <CitationPanel caseId={caseId} citations={citations} />
                          </div>
                        </div>
                      </div>
                    ) : run.output_json ? (
                      <pre className="bg-muted/50 mt-2 max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                        {run.output_json.slice(0, 4000)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label htmlFor="new-pkg-name" className="text-sm font-medium">
                Package name
              </label>
              <Input
                id="new-pkg-name"
                value={newPkgName}
                onChange={(e) => setNewPkgName(e.target.value)}
                placeholder="e.g. Johnson Hearing Packet"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="new-pkg-type" className="text-sm font-medium">
                Package type
              </label>
              <Select value={newPkgType} onValueChange={setNewPkgType}>
                <SelectTrigger id="new-pkg-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PKG_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {formatLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Hearing packets default to hearing_packet; petitions and discovery use their respective types.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newPkgName.trim() || createPacket.isPending}
              onClick={async () => {
                try {
                  await createPacket.mutateAsync({
                    packet_name: newPkgName.trim(),
                    package_type: newPkgType,
                    naming_scheme: "letters"
                  });
                  setCreateOpen(false);
                  toast.success("Package created");
                  void refresh();
                } catch (e) {
                  toast.error(getDisplayErrorMessage(e, "Failed to create package"));
                }
              }}
            >
              {createPacket.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
