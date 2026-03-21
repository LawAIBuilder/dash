import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Bot, Play, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";
import { formatDateTime } from "@/ui/formatters";
import {
  useAIEventConfigs,
  useAIJobs,
  useAIStatus,
  useDeleteAIEventConfig,
  useRunAIAssembly,
  useUpsertAIEventConfig
} from "@/hooks/useAIAssembly";
import type { AIEventConfig, AIJob } from "@/lib/api-client";

const PRESET_EVENT_TYPES = [
  { value: "239_conference", label: "239 Conference" },
  { value: "hearing", label: "Hearing" },
  { value: "bi_demand", label: "BI Demand" },
  { value: "mediation", label: "Mediation" },
  { value: "deposition", label: "Deposition" },
  { value: "custom", label: "Custom event" }
];

const textareaClass =
  "min-h-[160px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30";

function parseAIOutput(job: AIJob): Array<{ exhibit_label: string; title: string; source_item_ids: string[]; rationale: string }> {
  if (!job.output_json) return [];
  try {
    const parsed = JSON.parse(job.output_json);
    return Array.isArray(parsed.exhibits) ? parsed.exhibits : [];
  } catch {
    return [];
  }
}

export function CaseAIPage() {
  const { caseId } = useParams();
  const aiStatus = useAIStatus();
  const { data: configs, isLoading: configsLoading, error: configsError } = useAIEventConfigs(caseId);
  const { data: jobs, isLoading: jobsLoading } = useAIJobs(caseId);
  const upsertConfig = useUpsertAIEventConfig(caseId);
  const deleteConfig = useDeleteAIEventConfig(caseId);
  const runAssembly = useRunAIAssembly(caseId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AIEventConfig | null>(null);
  const [eventType, setEventType] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  function openNewDialog() {
    setEditingConfig(null);
    setEventType("");
    setEventLabel("");
    setInstructions("");
    setDialogOpen(true);
  }

  function openEditDialog(config: AIEventConfig) {
    setEditingConfig(config);
    setEventType(config.event_type);
    setEventLabel(config.event_label);
    setInstructions(config.instructions);
    setDialogOpen(true);
  }

  async function handleSaveConfig() {
    if (!caseId || !eventType.trim() || !eventLabel.trim()) return;
    try {
      await upsertConfig.mutateAsync({
        event_type: eventType.trim(),
        event_label: eventLabel.trim(),
        instructions: instructions.trim()
      });
      setDialogOpen(false);
      toast.success(editingConfig ? "Event config updated" : "Event config created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save config");
    }
  }

  async function handleDelete(configId: string) {
    if (!window.confirm("Delete this event configuration?")) return;
    try {
      await deleteConfig.mutateAsync(configId);
      toast.success("Config deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleRunAssembly(evtType: string) {
    try {
      const job = await runAssembly.mutateAsync(evtType);
      if (job.status === "completed") {
        toast.success("AI assembly completed");
        setExpandedJobId(job.id);
      } else if (job.status === "failed") {
        toast.error(job.error_message ?? "AI assembly failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assembly failed");
    }
  }

  if (configsError) {
    return <StatePanel variant="error" message={configsError instanceof Error ? configsError.message : "Failed to load AI configs"} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Package runs (event configs)</h2>
        <p className="text-muted-foreground text-sm">
          Legacy hearing-oriented AI jobs: event instructions and exhibit recommendations. Prefer{" "}
          <strong>Packages</strong> for full package worker runs with citations and DOCX export.
        </p>
      </div>

      {!aiStatus.data?.configured ? (
        <StatePanel message="AI is not configured. Set OPENAI_API_KEY on the API service to enable AI-driven exhibit assembly." />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Event configurations</CardTitle>
                <CardDescription>Each event type has its own instructions for how to select and order exhibits.</CardDescription>
              </div>
              <Button size="sm" onClick={openNewDialog}>
                <Plus className="mr-1 size-4" />
                Add event
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {configsLoading ? (
              <PageSkeleton rows={3} />
            ) : !configs?.length ? (
              <StatePanel message="No event configurations yet. Add a 239 conference, hearing, or BI demand event to get started." />
            ) : (
              configs.map((config) => (
                <div key={config.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{config.event_label}</div>
                      <Badge variant="outline" className="mt-1">{config.event_type}</Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!aiStatus.data?.configured || runAssembly.isPending}
                        onClick={() => void handleRunAssembly(config.event_type)}
                      >
                        <Play className="mr-1 size-3" />
                        {runAssembly.isPending ? "Running…" : "Run"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEditDialog(config)}>Edit</Button>
                      <Button size="sm" variant="outline" aria-label="Delete event config" onClick={() => void handleDelete(config.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {config.instructions ? (
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-2 text-xs">
                      {config.instructions}
                    </pre>
                  ) : (
                    <div className="text-xs text-muted-foreground">No instructions set</div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent AI jobs</CardTitle>
            <CardDescription>Results from AI assembly runs. Expand a job to see the recommended exhibits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobsLoading ? (
              <PageSkeleton rows={3} />
            ) : !jobs?.length ? (
              <StatePanel message="No AI jobs have been run yet." />
            ) : (
              jobs.map((job) => {
                const exhibits = parseAIOutput(job);
                const expanded = expandedJobId === job.id;
                return (
                  <div key={job.id} className="rounded-lg border p-4 space-y-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                      onClick={() => setExpandedJobId(expanded ? null : job.id)}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <Bot className="size-4 text-muted-foreground" />
                          <span className="font-medium">{job.event_type}</span>
                          <Badge
                            variant={job.status === "completed" ? "outline" : job.status === "failed" ? "destructive" : "secondary"}
                          >
                            {job.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(job.completed_at ?? job.created_at)}
                          {job.model ? ` • ${job.model}` : ""}
                          {job.prompt_tokens ? ` • ${job.prompt_tokens + (job.completion_tokens ?? 0)} tokens` : ""}
                        </div>
                      </div>
                      <Badge variant="outline">{exhibits.length} exhibits</Badge>
                    </button>
                    {expanded ? (
                      <div className="space-y-2 pt-2">
                        {job.error_message ? (
                          <StatePanel variant="error" message={job.error_message} />
                        ) : null}
                        {exhibits.map((exhibit, index) => (
                          <div key={index} className="rounded border bg-muted/20 p-3 text-sm space-y-1">
                            <div className="font-medium">Exhibit {exhibit.exhibit_label}: {exhibit.title}</div>
                            <div className="text-xs text-muted-foreground">{exhibit.rationale}</div>
                            <div className="text-xs text-muted-foreground">
                              {exhibit.source_item_ids?.length ?? 0} document(s)
                            </div>
                          </div>
                        ))}
                        {exhibits.length === 0 && !job.error_message ? (
                          <div className="text-sm text-muted-foreground">No exhibit recommendations in output.</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingConfig ? "Edit event configuration" : "Add event configuration"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label htmlFor="ai-event-type" className="text-sm font-medium">Event type</label>
              {editingConfig ? (
                <Input id="ai-event-type" value={eventType} disabled />
              ) : (
                <Select value={eventType} onValueChange={(value) => {
                  setEventType(value);
                  const preset = PRESET_EVENT_TYPES.find((p) => p.value === value);
                  if (preset && !eventLabel) setEventLabel(preset.label);
                }}>
                  <SelectTrigger id="ai-event-type">
                    <SelectValue placeholder="Choose event type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_EVENT_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="ai-event-label" className="text-sm font-medium">Label</label>
              <Input
                id="ai-event-label"
                value={eventLabel}
                onChange={(e) => setEventLabel(e.target.value)}
                placeholder="e.g. 239 Conference — Medical Request"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="ai-event-instructions" className="text-sm font-medium">
                Instructions for the AI
              </label>
              <textarea
                id="ai-event-instructions"
                className={textareaClass}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={`Describe what documents to include and how to order them.\n\nExample:\nFor a 239 conference, include:\n- All medical records ordered by date\n- The most recent QRC report\n- Any wage/employment docs\n- The demand letter if one exists\n\nDo NOT include correspondence or internal memos.`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!eventType.trim() || !eventLabel.trim() || upsertConfig.isPending}
              onClick={() => void handleSaveConfig()}
            >
              {upsertConfig.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
