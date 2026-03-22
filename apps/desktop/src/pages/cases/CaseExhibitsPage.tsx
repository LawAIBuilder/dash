import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, FileJson, FolderOpen, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjection } from "@/hooks/useProjection";
import {
  useAddExhibitItem,
  useCreateExhibitPacket,
  useCreateExhibitSlot,
  useExhibitHistory,
  useExhibitSuggestions,
  useExhibitWorkspace,
  useFinalizeExhibitPacket,
  useGeneratePacketPdf,
  usePacketPdfExports,
  useRemoveExhibitItem,
  useReorderExhibitSections,
  useReorderSectionExhibits,
  useResolveExhibitSuggestion,
  useUpdateExhibitItemPageRules,
  useUpdateExhibitPacket
} from "@/hooks/useExhibits";
import { formatDateTime, formatLabel } from "@/ui/formatters";
import { PageSkeleton } from "@/components/case/PageSkeleton";
import { StatePanel } from "@/components/case/StatePanel";
import type { ExhibitItem, ExhibitSection, ExhibitSlot, PacketPdfExportLayout } from "@/types/exhibits";
import { downloadPacketExportPdf, getDisplayErrorMessage } from "@/lib/api-client";

function canGeneratePacketPdf(status: string) {
  return status === "finalized" || status === "needs_review" || status === "exported";
}

type SourceItem = NonNullable<ReturnType<typeof useProjection>["projection"]>["slices"]["document_inventory_slice"]["source_items"][number];

function groupSourceItemsByFolder(sourceItems: SourceItem[]) {
  return sourceItems
    .filter((item) => item.source_kind === "file" || item.source_kind === "upload")
    .reduce<Record<string, SourceItem[]>>((acc, item) => {
      const key = item.folder_path || "Root";
      acc[key] ??= [];
      acc[key].push(item);
      return acc;
    }, {});
}

function PageRulesDialog({
  open,
  title,
  pageIds,
  excludedPageIds,
  onToggle,
  onSave,
  onOpenChange,
  isSaving
}: {
  open: boolean;
  title: string;
  pageIds: string[];
  excludedPageIds: string[];
  onToggle: (pageId: string) => void;
  onSave: () => void;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            Toggle pages to exclude them from the exhibit while keeping the source document attached to the slot.
          </div>
          <div className="grid max-h-80 grid-cols-4 gap-2 overflow-auto">
            {pageIds.map((pageId, index) => {
              const excluded = excludedPageIds.includes(pageId);
              return (
                <Button
                  key={pageId}
                  type="button"
                  size="sm"
                  variant={excluded ? "destructive" : "outline"}
                  onClick={() => onToggle(pageId)}
                >
                  P{index + 1}
                </Button>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={isSaving} onClick={onSave}>
            {isSaving ? "Saving…" : "Save page rules"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  open,
  sourceTitle,
  exhibits,
  selectedExhibitId,
  onSelectExhibit,
  onAssign,
  onOpenChange,
  isAssigning
}: {
  open: boolean;
  sourceTitle: string;
  exhibits: Array<{ id: string; label: string; title: string }>;
  selectedExhibitId: string;
  onSelectExhibit: (value: string) => void;
  onAssign: () => void;
  onOpenChange: (open: boolean) => void;
  isAssigning: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to exhibit</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">{sourceTitle}</div>
          <Select value={selectedExhibitId} onValueChange={onSelectExhibit}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an exhibit slot" />
            </SelectTrigger>
            <SelectContent>
              {exhibits.map((exhibit) => (
                <SelectItem key={exhibit.id} value={exhibit.id}>
                  {exhibit.label} • {exhibit.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selectedExhibitId || isAssigning} onClick={onAssign}>
            {isAssigning ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExhibitSlotCard({
  slot,
  pagesByDocument,
  onDropSourceItem,
  onRemoveItem,
  onEditPages,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}: {
  slot: ExhibitSlot;
  pagesByDocument: Record<string, string[]>;
  onDropSourceItem: (slotId: string, sourceItemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onEditPages: (item: ExhibitItem, pageIds: string[]) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div
      className="rounded-xl border bg-card p-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const sourceItemId = event.dataTransfer.getData("text/source-item-id");
        if (sourceItemId) {
          onDropSourceItem(slot.id, sourceItemId);
        }
      }}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge>{slot.exhibit_label}</Badge>
            <Badge variant="outline">{formatLabel(slot.status)}</Badge>
          </div>
          <div className="mt-2 text-base font-semibold">{slot.title ?? `${slot.exhibit_label} Exhibit`}</div>
          {slot.purpose ? <div className="mt-1 text-sm text-muted-foreground">{slot.purpose}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">
            {slot.items.length} doc{slot.items.length === 1 ? "" : "s"}
          </div>
          <Button size="icon" variant="ghost" disabled={!canMoveUp} onClick={onMoveUp}>
            <ArrowUp className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" disabled={!canMoveDown} onClick={onMoveDown}>
            <ArrowDown className="size-4" />
          </Button>
        </div>
      </div>

      {slot.items.length ? (
        <div className="space-y-3">
          {slot.items.map((item) => {
            const pageIds = item.canonical_document_id ? pagesByDocument[item.canonical_document_id] ?? [] : [];
            const excludedPageIds = item.page_rules
              .filter((rule) => rule.rule_type === "exclude")
              .map((rule) => rule.canonical_page_id);
            return (
              <div key={item.id} className="rounded-lg border bg-background/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{item.source_item_title ?? item.canonical_document_title ?? "Untitled source item"}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.document_type_name ? formatLabel(item.document_type_name) : "Unclassified"}
                      {item.document_category ? ` • ${formatLabel(item.document_category)}` : ""}
                      {item.page_count ? ` • ${item.page_count} pages` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pageIds.length > 0 ? (
                      <Button size="sm" variant="outline" onClick={() => onEditPages(item, pageIds)}>
                        Pages{excludedPageIds.length > 0 ? ` (${excludedPageIds.length} excluded)` : ""}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => onRemoveItem(item.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Drag documents here to build this exhibit slot.
        </div>
      )}
    </div>
  );
}

export function CaseExhibitsPage() {
  const { caseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projection, isLoading: projectionLoading, error: projectionError } = useProjection(caseId);
  const workspace = useExhibitWorkspace(caseId);
  const createPacket = useCreateExhibitPacket(caseId);
  const updatePacket = useUpdateExhibitPacket(caseId);
  const createSlot = useCreateExhibitSlot(caseId);
  const addItem = useAddExhibitItem(caseId);
  const removeItem = useRemoveExhibitItem(caseId);
  const updatePageRules = useUpdateExhibitItemPageRules(caseId);
  const finalizePacket = useFinalizeExhibitPacket(caseId);
  const generatePacketPdf = useGeneratePacketPdf(caseId);
  const resolveSuggestion = useResolveExhibitSuggestion(caseId);
  const reorderSections = useReorderExhibitSections(caseId);
  const reorderExhibits = useReorderSectionExhibits(caseId);

  const packets = workspace.data ?? [];
  const selectedPacketId = searchParams.get("packetId")?.trim() || "";
  const packet = useMemo(
    () => packets.find((candidate) => candidate.id === selectedPacketId) ?? packets[0] ?? null,
    [packets, selectedPacketId]
  );
  const suggestions = useExhibitSuggestions(caseId, packet?.id);
  const history = useExhibitHistory(caseId, packet?.id);
  const packetExports = usePacketPdfExports(caseId, packet?.id);

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotDialogSectionId, setSlotDialogSectionId] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState({ exhibit_label: "", title: "" });
  const [assignState, setAssignState] = useState<{
    sourceItemId: string | null;
    sourceTitle: string;
    selectedExhibitId: string;
    open: boolean;
  }>({
    sourceItemId: null,
    sourceTitle: "",
    selectedExhibitId: "",
    open: false
  });
  const [pageRuleState, setPageRuleState] = useState<{
    item: ExhibitItem | null;
    pageIds: string[];
    excludedPageIds: string[];
    open: boolean;
  }>({
    item: null,
    pageIds: [],
    excludedPageIds: [],
    open: false
  });
  const [manifestDialog, setManifestDialog] = useState<{ open: boolean; title: string; body: string }>({
    open: false,
    title: "",
    body: ""
  });
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);
  const [pdfExportLayout, setPdfExportLayout] = useState({
    cover_sheet: true,
    section_separators: true,
    exhibit_separators: true,
    batesEnabled: false,
    batesPrefix: "WC",
    batesStart: 1,
    batesPadding: 6
  });

  const sourceItems = projection?.slices.document_inventory_slice?.source_items ?? [];
  const groupedSourceItems = useMemo(() => groupSourceItemsByFolder(sourceItems), [sourceItems]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const assignedSourceItemIds = useMemo(
    () =>
      new Set(
        packet?.sections.flatMap((section) =>
          section.exhibits.flatMap((slot) => slot.items.map((item) => item.source_item_id).filter(Boolean))
        ) ?? []
      ),
    [packet]
  );
  const pagesByDocument = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    const pages = projection?.slices.canonical_spine_slice?.pages ?? [];
    for (const page of pages) {
      const docId = page.canonical_document_id ?? page.document_id;
      if (!docId) {
        continue;
      }
      grouped[docId] ??= [];
      grouped[docId].push(page.id);
    }
    return grouped;
  }, [projection]);
  const allExhibits = useMemo(
    () =>
      packet?.sections.flatMap((section) =>
        section.exhibits.map((slot) => ({
          id: slot.id,
          label: slot.exhibit_label,
          title: slot.title ?? `${slot.exhibit_label} Exhibit`,
          sectionId: section.id
        }))
      ) ?? [],
    [packet]
  );

  if (projectionError || workspace.error) {
    return (
      <StatePanel
        variant="error"
        message={projectionError ?? getDisplayErrorMessage(workspace.error, "Failed to load exhibit workspace.")}
      />
    );
  }

  if (projectionLoading || workspace.isLoading) {
    return <PageSkeleton rows={6} />;
  }

  async function handleCreatePacket() {
    try {
      await createPacket.mutateAsync({ packet_name: "Hearing Packet", packet_mode: "full", naming_scheme: "letters" });
      toast.success("Exhibit packet created");
    } catch (createError) {
      toast.error(getDisplayErrorMessage(createError, "Failed to create exhibit packet"));
    }
  }

  async function handleModeChange(value: string) {
    if (!packet) {
      return;
    }
    try {
      await updatePacket.mutateAsync({
        packetId: packet.id,
        input: { packet_mode: value === "compact" ? "compact" : "full" }
      });
    } catch (updateError) {
      toast.error(getDisplayErrorMessage(updateError, "Failed to update packet mode"));
    }
  }

  async function handleCreateSlot() {
    if (!slotDialogSectionId) {
      return;
    }
    try {
      await createSlot.mutateAsync({
        sectionId: slotDialogSectionId,
        input: {
          exhibit_label: slotForm.exhibit_label.trim() || null,
          title: slotForm.title.trim() || null
        }
      });
      toast.success("Exhibit slot created");
      setSlotDialogOpen(false);
      setSlotDialogSectionId(null);
      setSlotForm({ exhibit_label: "", title: "" });
    } catch (createError) {
      toast.error(getDisplayErrorMessage(createError, "Failed to create exhibit slot"));
    }
  }

  async function handleDropSourceItem(slotId: string, sourceItemId: string) {
    try {
      await addItem.mutateAsync({ exhibitId: slotId, sourceItemId });
      toast.success("Document added to exhibit");
    } catch (addError) {
      toast.error(getDisplayErrorMessage(addError, "Failed to add document to exhibit"));
    }
  }

  async function handleRemoveItem(itemId: string) {
    try {
      await removeItem.mutateAsync(itemId);
      toast.success("Document removed from exhibit");
    } catch (removeError) {
      toast.error(getDisplayErrorMessage(removeError, "Failed to remove exhibit item"));
    }
  }

  async function handleSavePageRules() {
    if (!pageRuleState.item) {
      return;
    }
    try {
      await updatePageRules.mutateAsync({
        itemId: pageRuleState.item.id,
        excludeCanonicalPageIds: pageRuleState.excludedPageIds
      });
      toast.success("Page exclusions updated");
      setPageRuleState({ item: null, pageIds: [], excludedPageIds: [], open: false });
    } catch (saveError) {
      toast.error(getDisplayErrorMessage(saveError, "Failed to update page exclusions"));
    }
  }

  async function handleFinalize() {
    if (!packet) {
      return;
    }
    try {
      const result = await finalizePacket.mutateAsync(packet.id);
      toast.success(
        result.suggestions.length > 0
          ? `Packet finalized with ${result.suggestions.length} suggestion(s) to review`
          : "Packet finalized"
      );
    } catch (finalizeError) {
      toast.error(getDisplayErrorMessage(finalizeError, "Packet finalization failed"));
    }
  }

  async function handleGeneratePacketPdf() {
    if (!packet) {
      return;
    }
    try {
      const layout: PacketPdfExportLayout = {
        cover_sheet: pdfExportLayout.cover_sheet,
        section_separators: pdfExportLayout.section_separators,
        exhibit_separators: pdfExportLayout.exhibit_separators,
        bates: pdfExportLayout.batesEnabled
          ? {
              prefix: pdfExportLayout.batesPrefix.trim() || "WC",
              start_at: pdfExportLayout.batesStart,
              padding: pdfExportLayout.batesPadding
            }
          : null
      };
      const result = await generatePacketPdf.mutateAsync({ packetId: packet.id, layout });
      toast.success(`Combined PDF ready — ${result.page_count} page${result.page_count === 1 ? "" : "s"}`);
    } catch (genError) {
      toast.error(getDisplayErrorMessage(genError, "Packet PDF generation failed"));
    }
  }

  async function handleDownloadExport(exportId: string) {
    if (!caseId) {
      toast.error("Case context missing for export download");
      return;
    }
    setDownloadingExportId(exportId);
    try {
      const blob = await downloadPacketExportPdf(caseId, exportId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `exhibit-packet-${exportId.slice(0, 8)}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Download started");
    } catch (downloadError) {
      toast.error(getDisplayErrorMessage(downloadError, "Download failed"));
    } finally {
      setDownloadingExportId(null);
    }
  }

  function openManifestDialog(title: string, manifestJson: string | null) {
    if (!manifestJson?.trim()) {
      toast.error("No manifest stored for this export");
      return;
    }
    try {
      const parsed = JSON.parse(manifestJson) as unknown;
      const body = JSON.stringify(parsed, null, 2);
      setManifestDialog({ open: true, title, body });
    } catch {
      setManifestDialog({ open: true, title, body: manifestJson });
    }
  }

  async function handleResolveSuggestion(suggestionId: string, action: "accept" | "dismiss") {
    if (!packet) {
      return;
    }
    try {
      await resolveSuggestion.mutateAsync({ packetId: packet.id, suggestionId, action });
      toast.success(action === "accept" ? "Suggestion accepted" : "Suggestion dismissed");
    } catch (resolveError) {
      toast.error(getDisplayErrorMessage(resolveError, "Failed to resolve suggestion"));
    }
  }

  async function handleAssignSourceItem() {
    if (!assignState.sourceItemId || !assignState.selectedExhibitId) {
      return;
    }
    try {
      await addItem.mutateAsync({
        exhibitId: assignState.selectedExhibitId,
        sourceItemId: assignState.sourceItemId
      });
      toast.success("Document assigned to exhibit");
      setAssignState({ sourceItemId: null, sourceTitle: "", selectedExhibitId: "", open: false });
    } catch (assignError) {
      toast.error(getDisplayErrorMessage(assignError, "Failed to assign document"));
    }
  }

  async function moveSection(sectionId: string, direction: -1 | 1) {
    if (!packet) {
      return;
    }
    const currentIndex = packet.sections.findIndex((section) => section.id === sectionId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= packet.sections.length) {
      return;
    }
    const next = [...packet.sections];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, moved);
    try {
      await reorderSections.mutateAsync({
        packetId: packet.id,
        sectionIds: next.map((section) => section.id)
      });
    } catch (reorderError) {
      toast.error(getDisplayErrorMessage(reorderError, "Failed to reorder sections"));
    }
  }

  async function moveSlot(section: ExhibitSection, slotId: string, direction: -1 | 1) {
    const currentIndex = section.exhibits.findIndex((slot) => slot.id === slotId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= section.exhibits.length) {
      return;
    }
    const next = [...section.exhibits];
    const [moved] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, moved);
    try {
      await reorderExhibits.mutateAsync({
        sectionId: section.id,
        exhibitIds: next.map((slot) => slot.id)
      });
    } catch (reorderError) {
      toast.error(getDisplayErrorMessage(reorderError, "Failed to reorder exhibits"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Exhibits</h2>
          <p className="text-sm text-muted-foreground">
            Assemble party-specific and joint exhibits by dragging documents from the source tray into named slots.
          </p>
        </div>
        {!packet ? (
          <Button onClick={() => void handleCreatePacket()} disabled={createPacket.isPending}>
            {createPacket.isPending ? "Creating…" : "Create hearing packet"}
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{formatLabel(packet.status)}</Badge>
            <Button variant="outline" disabled={finalizePacket.isPending} onClick={() => void handleFinalize()}>
              {finalizePacket.isPending ? "Finalizing…" : "Finalize packet"}
            </Button>
            <Button
              variant="secondary"
              disabled={!canGeneratePacketPdf(packet.status) || generatePacketPdf.isPending}
              onClick={() => void handleGeneratePacketPdf()}
            >
              {generatePacketPdf.isPending ? "Generating…" : "Generate packet PDF"}
            </Button>
          </div>
        )}
      </div>

      {!packet ? (
        <Card>
          <CardContent className="p-8">
            <StatePanel
              message="Create the first packet to begin arranging exhibits into employee, employer, and joint sections."
              className="text-center"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{packet.packet_name}</CardTitle>
              <CardDescription>
                Multi-document exhibit slots with packet sections, page exclusions, and finalization suggestions.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                {packets.length > 1 ? (
                  <div className="min-w-[240px] space-y-1">
                    <div className="text-xs text-muted-foreground">Active packet</div>
                    <Select
                      value={packet.id}
                      onValueChange={(value) => {
                        const next = new URLSearchParams(searchParams);
                        next.set("packetId", value);
                        setSearchParams(next, { replace: true });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select packet" />
                      </SelectTrigger>
                      <SelectContent>
                        {packets.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.packet_name} ({formatLabel(candidate.package_type ?? "hearing_packet")})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <Tabs value={packet.packet_mode} onValueChange={handleModeChange}>
                  <TabsList>
                    <TabsTrigger value="compact">Compact</TabsTrigger>
                    <TabsTrigger value="full">Full workspace</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <span>{packet.sections.length} sections</span>
                <span>•</span>
                <span>
                  {packet.sections.reduce((sum, section) => sum + section.exhibits.length, 0)} slots
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hearing readiness QA</CardTitle>
              <CardDescription>Quick checks before finalize or export.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                <li>Every exhibit slot has at least one assigned document or an intentional blank.</li>
                <li>Page exclusions are reviewed for privileged or irrelevant pages.</li>
                <li>OCR/review queue is clear for documents you are submitting.</li>
                <li>Packet order matches your hearing outline (sections → slots).</li>
                <li>After finalize, generate the combined packet PDF and spot-check pagination and exhibit labels before filing.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Packet PDF</CardTitle>
              <CardDescription>
                Combined PDF follows section order, slot order, item order, and page exclusion rules. Each run stores a
                machine-readable manifest for provenance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!canGeneratePacketPdf(packet.status) ? (
                <div className="text-sm text-muted-foreground">
                  Finalize the packet first to enable PDF generation (status is currently {formatLabel(packet.status)}).
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div className="mb-2 font-medium">Layout for next export</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfExportLayout.cover_sheet}
                        onChange={(event) =>
                          setPdfExportLayout((current) => ({ ...current, cover_sheet: event.target.checked }))
                        }
                        className="size-4 rounded border-input"
                      />
                      Cover sheet
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfExportLayout.section_separators}
                        onChange={(event) =>
                          setPdfExportLayout((current) => ({ ...current, section_separators: event.target.checked }))
                        }
                        className="size-4 rounded border-input"
                      />
                      Section divider pages
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfExportLayout.exhibit_separators}
                        onChange={(event) =>
                          setPdfExportLayout((current) => ({ ...current, exhibit_separators: event.target.checked }))
                        }
                        className="size-4 rounded border-input"
                      />
                      Exhibit divider pages
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfExportLayout.batesEnabled}
                        onChange={(event) =>
                          setPdfExportLayout((current) => ({ ...current, batesEnabled: event.target.checked }))
                        }
                        className="size-4 rounded border-input"
                      />
                      Bates stamp (footer)
                    </label>
                  </div>
                  {pdfExportLayout.batesEnabled ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Prefix</span>
                        <Input
                          className="h-8 w-24"
                          value={pdfExportLayout.batesPrefix}
                          onChange={(event) =>
                            setPdfExportLayout((current) => ({ ...current, batesPrefix: event.target.value }))
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Start #</span>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          min={1}
                          value={pdfExportLayout.batesStart}
                          onChange={(event) =>
                            setPdfExportLayout((current) => ({
                              ...current,
                              batesStart: Math.max(1, Number.parseInt(event.target.value, 10) || 1)
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Digits</span>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          min={1}
                          max={12}
                          value={pdfExportLayout.batesPadding}
                          onChange={(event) =>
                            setPdfExportLayout((current) => ({
                              ...current,
                              batesPadding: Math.min(12, Math.max(1, Number.parseInt(event.target.value, 10) || 6))
                            }))
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              {packetExports.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading export history…</div>
              ) : packetExports.error ? (
                <div className="text-sm text-destructive">
                  {getDisplayErrorMessage(packetExports.error, "Failed to load exports")}
                </div>
              ) : !packetExports.data?.length ? (
                <div className="text-sm text-muted-foreground">No exports yet. Generate a combined packet PDF to see it here.</div>
              ) : (
                <div className="grid gap-2">
                  {packetExports.data.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant={row.status === "complete" ? "default" : row.status === "failed" ? "destructive" : "outline"}>
                            {formatLabel(row.status)}
                          </Badge>
                          {row.page_count != null ? (
                            <span className="text-muted-foreground">{row.page_count} pages</span>
                          ) : null}
                          <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>
                        </div>
                        {row.status === "failed" && row.error_text ? (
                          <div className="text-xs text-destructive">{row.error_text}</div>
                        ) : null}
                      </div>
                      <div className="flex flex-shrink-0 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={row.status !== "complete" || downloadingExportId === row.id}
                          onClick={() => void handleDownloadExport(row.id)}
                        >
                          <Download className="mr-1 size-4" />
                          {downloadingExportId === row.id ? "…" : "Download"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!row.manifest_json}
                          onClick={() => openManifestDialog(`Export ${row.id.slice(0, 8)}`, row.manifest_json)}
                        >
                          <FileJson className="mr-1 size-4" />
                          Manifest
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {suggestions.data?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-5" />
                  Packet suggestions
                </CardTitle>
                <CardDescription>Current heuristic packet guidance for grouping, gaps, and duplicates.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {suggestions.data.slice(0, 8).map((suggestion) => (
                  <div key={suggestion.id} className="rounded-lg border p-4">
                    <div className="flex items-center gap-2">
                      <Badge variant={suggestion.severity === "warn" ? "destructive" : "outline"}>
                        {formatLabel(suggestion.suggestion_type)}
                      </Badge>
                      {suggestion.severity === "warn" ? <AlertTriangle className="size-4 text-destructive" /> : null}
                    </div>
                    <div className="mt-2 font-medium">{suggestion.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{suggestion.detail}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolveSuggestion.isPending}
                        onClick={() => void handleResolveSuggestion(suggestion.id, "accept")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolveSuggestion.isPending}
                        onClick={() => void handleResolveSuggestion(suggestion.id, "dismiss")}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className={packet.packet_mode === "compact" ? "grid gap-6" : "grid gap-6 xl:grid-cols-[0.95fr_1.05fr]"}>
            <Card>
              <CardHeader>
                <CardTitle>Source tray</CardTitle>
                <CardDescription>
                  Documents grouped by Box folder. Collapse folders to focus on relevant categories. Drag or assign to exhibit slots.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(groupedSourceItems)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([folder, items]) => {
                    const collapsed = collapsedFolders.has(folder);
                    const assignedCount = items.filter((i) => assignedSourceItemIds.has(i.id)).length;
                    return (
                      <div key={folder} className="rounded-lg border">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/50"
                          onClick={() =>
                            setCollapsedFolders((prev) => {
                              const next = new Set(prev);
                              if (next.has(folder)) next.delete(folder);
                              else next.add(folder);
                              return next;
                            })
                          }
                        >
                          {collapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
                          <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{folder}</span>
                          <Badge variant="outline" className="ml-auto shrink-0">
                            {assignedCount > 0 ? `${assignedCount}/` : ""}{items.length}
                          </Badge>
                        </button>
                        {!collapsed ? (
                          <div className="grid gap-1.5 px-3 pb-3">
                            {items.map((item) => {
                              const assigned = assignedSourceItemIds.has(item.id);
                              return (
                                <div
                                  key={item.id}
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData("text/source-item-id", item.id);
                                  }}
                                  className="cursor-grab rounded-lg border bg-background/70 px-3 py-2 active:cursor-grabbing"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{item.title ?? "Untitled"}</div>
                                      <div className="truncate text-xs text-muted-foreground">
                                        {item.document_type_name ? formatLabel(item.document_type_name) : "Unclassified"}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <Badge variant={assigned ? "secondary" : "outline"} className="text-xs">
                                        {assigned ? "Assigned" : "Available"}
                                      </Badge>
                                      {allExhibits.length > 0 ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 px-2 text-xs"
                                          disabled={assigned}
                                          onClick={() =>
                                            setAssignState({
                                              sourceItemId: item.id,
                                              sourceTitle: item.title ?? "Untitled",
                                              selectedExhibitId: "",
                                              open: true
                                            })
                                          }
                                        >
                                          Assign
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </CardContent>
            </Card>

            <div className="space-y-6">
              {packet.sections.map((section: ExhibitSection) => (
                <Card key={section.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle>{section.section_label}</CardTitle>
                        <CardDescription>
                          {section.exhibits.length} slot{section.exhibits.length === 1 ? "" : "s"} in this section
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="icon" variant="ghost" disabled={section.sort_order <= 0} onClick={() => void moveSection(section.id, -1)}>
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={section.sort_order >= packet.sections.length - 1}
                          onClick={() => void moveSection(section.id, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSlotDialogSectionId(section.id);
                            setSlotDialogOpen(true);
                          }}
                        >
                          <Plus className="mr-2 size-4" />
                          Add slot
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {section.exhibits.length ? (
                      section.exhibits.map((slot, slotIndex) => (
                        <ExhibitSlotCard
                          key={slot.id}
                          slot={slot}
                          pagesByDocument={pagesByDocument}
                          onDropSourceItem={handleDropSourceItem}
                          onRemoveItem={handleRemoveItem}
                          onMoveUp={() => void moveSlot(section, slot.id, -1)}
                          onMoveDown={() => void moveSlot(section, slot.id, 1)}
                          canMoveUp={slotIndex > 0}
                          canMoveDown={slotIndex < section.exhibits.length - 1}
                          onEditPages={(item, pageIds) =>
                            setPageRuleState({
                              item,
                              pageIds,
                              excludedPageIds: item.page_rules
                                .filter((rule) => rule.rule_type === "exclude")
                                .map((rule) => rule.canonical_page_id),
                              open: true
                            })
                          }
                        />
                      ))
                    ) : (
                      <StatePanel message="No exhibit slots yet in this section." />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create exhibit slot</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <Input
                  placeholder="Exhibit label (optional)"
                  value={slotForm.exhibit_label}
                  onChange={(event) => setSlotForm((current) => ({ ...current, exhibit_label: event.target.value }))}
                />
                <Input
                  placeholder="Slot title (optional)"
                  value={slotForm.title}
                  onChange={(event) => setSlotForm((current) => ({ ...current, title: event.target.value }))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSlotDialogOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={createSlot.isPending} onClick={() => void handleCreateSlot()}>
                  {createSlot.isPending ? "Creating…" : "Create slot"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AssignDialog
            open={assignState.open}
            sourceTitle={assignState.sourceTitle}
            exhibits={allExhibits}
            selectedExhibitId={assignState.selectedExhibitId}
            onSelectExhibit={(value) => setAssignState((current) => ({ ...current, selectedExhibitId: value }))}
            onAssign={() => void handleAssignSourceItem()}
            onOpenChange={(open) => setAssignState((current) => ({ ...current, open }))}
            isAssigning={addItem.isPending}
          />

          <PageRulesDialog
            open={pageRuleState.open}
            title={pageRuleState.item?.source_item_title ?? pageRuleState.item?.canonical_document_title ?? "Edit page exclusions"}
            pageIds={pageRuleState.pageIds}
            excludedPageIds={pageRuleState.excludedPageIds}
            onToggle={(pageId) =>
              setPageRuleState((current) => ({
                ...current,
                excludedPageIds: current.excludedPageIds.includes(pageId)
                  ? current.excludedPageIds.filter((value) => value !== pageId)
                  : [...current.excludedPageIds, pageId]
              }))
            }
            onSave={() => void handleSavePageRules()}
            onOpenChange={(open) => setPageRuleState((current) => ({ ...current, open }))}
            isSaving={updatePageRules.isPending}
          />

          <Dialog
            open={manifestDialog.open}
            onOpenChange={(open) => setManifestDialog((current) => ({ ...current, open }))}
          >
            <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
              <DialogHeader>
                <DialogTitle>{manifestDialog.title}</DialogTitle>
              </DialogHeader>
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {manifestDialog.body}
              </pre>
              <DialogFooter>
                <Button variant="outline" onClick={() => setManifestDialog((current) => ({ ...current, open: false }))}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Card>
            <CardHeader>
              <CardTitle>Packet history</CardTitle>
              <CardDescription>Audit trail for exhibit assembly and review decisions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.isLoading ? (
                <PageSkeleton rows={3} />
              ) : history.data?.length ? (
                history.data.slice(0, 12).map((entry) => (
                  <div key={entry.id} className="rounded-lg border p-3">
                    <div className="font-medium">{formatLabel(entry.action_type)}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatLabel(entry.target_type)}
                      {entry.target_id ? ` • ${entry.target_id}` : ""}
                      {` • ${formatDateTime(entry.created_at)}`}
                    </div>
                  </div>
                ))
              ) : (
                <StatePanel message="No packet history yet." />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
