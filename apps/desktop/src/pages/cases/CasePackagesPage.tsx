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
import {
  usePackageRules,
  usePackageRuns,
  useCreatePackageRule,
  useDeletePackageRule,
  useUploadToCase,
  useTriggerPackageRun,
  useUpdatePackageRunDraft
} from "@/hooks/usePackages";
import { exportPackageRunDocx } from "@/lib/api-client";
import type { PackageRun } from "@/lib/api-client";
import { formatLabel } from "@/ui/formatters";
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
} {
  if (!outputJson) {
    return {
      draft_markdown: "",
      edited_draft_markdown: null,
      qa_checklist: [],
      citations: [],
      interrogatory_parse: null
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
      interrogatory_parse
    };
  } catch {
    return {
      draft_markdown: outputJson,
      edited_draft_markdown: null,
      qa_checklist: [],
      citations: [],
      interrogatory_parse: null
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

export function CasePackagesPage() {
  const { caseId } = useParams();
  const exhibitQuery = useExhibitWorkspace(caseId);
  const packets = exhibitQuery.data ?? [];
  const isLoading = exhibitQuery.isLoading;
  const refresh = exhibitQuery.refetch;
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

  const { data: runs = [], refetch: refetchRuns } = usePackageRuns(activePacket?.id);
  const updateDraft = useUpdatePackageRunDraft(activePacket?.id);

  const createPacket = useCreateExhibitPacket(caseId);
  const createRule = useCreatePackageRule(caseId ?? "");
  const deleteRule = useDeletePackageRule(caseId ?? "");
  const upload = useUploadToCase(caseId ?? "");
  const runWorker = useTriggerPackageRun(caseId ?? "");

  const [ruleKey, setRuleKey] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");
  const [ruleInstr, setRuleInstr] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newPkgName, setNewPkgName] = useState("");
  const [newPkgType, setNewPkgType] = useState<string>("hearing_packet");

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
            <Link to={`/cases/${caseId}/exhibits`}>Open hearing exhibits</Link>
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
                    <Link to={`/cases/${caseId}/exhibits`}>Edit exhibits</Link>
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
                if (f) upload.mutate(f);
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
                    setRuleKey("");
                    setRuleLabel("");
                    setRuleInstr("");
                  }
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
                <Button size="sm" variant="ghost" onClick={() => deleteRule.mutate(r.id)}>
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
                    onSuccess: () => void refetchRuns()
                  }
                )
              }
            >
              {runWorker.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
              Run package worker
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
                const interrogatoryCount =
                  parsed.interrogatory_parse?.length ??
                  (() => {
                    try {
                      const o = run.output_json ? (JSON.parse(run.output_json) as { interrogatory_parse?: unknown[] }) : null;
                      return Array.isArray(o?.interrogatory_parse) ? o.interrogatory_parse.length : null;
                    } catch {
                      return null;
                    }
                  })();

                return (
                  <li key={run.id} className="rounded-lg border px-3 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Badge variant="outline">{formatLabel(run.status)}</Badge>{" "}
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
                        disabled={run.status !== "completed"}
                        onClick={() =>
                          exportPackageRunDocx(run.id)
                            .then(() => toast.success("DOCX export written on server"))
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Export failed"))
                        }
                      >
                        <FileDown className="mr-1 size-4" />
                        Export DOCX
                      </Button>
                    </div>
                    {discoveryHints && interrogatoryCount != null ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        Parsed interrogatory segments in output: {interrogatoryCount}
                      </p>
                    ) : null}
                    {run.error_message ? <div className="text-destructive mt-1 text-xs">{run.error_message}</div> : null}

                    {run.status === "completed" && run.output_json ? (
                      <div className="mt-4 grid gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
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
                                  onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed")
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
                  toast.error(e instanceof Error ? e.message : "Failed to create package");
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
