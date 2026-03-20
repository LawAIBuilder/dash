import { useEffect, useMemo, useState } from "react";
import type {
  MatterProjection,
  ProjectionBranchStageStatus,
  ProjectionCanonicalDocument,
  ProjectionCanonicalPage,
  ProjectionProofRequirement,
  ProjectionSourceItem,
  ProjectionWatermark
} from "@wc/domain-core";
import { loadDesktopProjectionState, saveDesktopProjectionState, type DesktopProjectionState } from "./localState.js";
import { API_BASE, buildApiHeaders } from "./config.js";
import { officeFormatHintFromTitle } from "./officeHints.js";
import { DetailRow, EmptyState, SectionCard, StatusBadge } from "./ui/components.js";
import {
  countLabels,
  formatConfidence,
  formatDateTime,
  formatLabel,
  summarizeCountRecord,
  summarizeKeyValueRecord,
  summarizeRawJson,
  toneForStatus,
  truncateMiddle
} from "./ui/formatters.js";
import {
  cardStyle,
  inputStyle,
  pageStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  shellGridStyle,
  subtleCardStyle
} from "./ui/styles.js";

type ViewSource = "none" | "cache" | "remote";

function resolveCanonicalDocumentState(document: ProjectionCanonicalDocument): string {
  return document.state ?? document.status ?? "unknown";
}

function resolveCanonicalPageState(page: ProjectionCanonicalPage): string {
  return page.state ?? page.status ?? page.extraction_status ?? page.ocr_status ?? "unknown";
}

function resolveCanonicalDocumentType(document: ProjectionCanonicalDocument): string | null {
  return document.canonical_name ?? document.document_type_name ?? null;
}

function resolveCanonicalDocumentSourceItemId(document: ProjectionCanonicalDocument): string | null {
  return document.primary_source_item_id ?? document.source_item_id ?? document.source_item_ids?.[0] ?? null;
}

function resolveCanonicalDocumentTitle(
  document: ProjectionCanonicalDocument,
  fallbackTitle?: string | null
): string {
  return (
    document.title ??
    document.display_title ??
    fallbackTitle ??
    resolveCanonicalDocumentType(document) ??
    "Untitled canonical document"
  );
}

function summarizeIdList(ids: string[] | null | undefined): string | null {
  if (!ids || ids.length === 0) {
    return null;
  }

  const preview = ids.slice(0, 2).map((value) => truncateMiddle(value)).join(", ");
  return ids.length > 2 ? `${preview} +${ids.length - 2} more` : preview;
}

function loadInitialAppState(): {
  desktopState: DesktopProjectionState;
  storedMatter: DesktopProjectionState["matters"][string] | null;
  status: string;
  viewSource: ViewSource;
} {
  const desktopState = loadDesktopProjectionState();
  const storedMatter =
    desktopState.active_case_id !== "" ? desktopState.matters[desktopState.active_case_id] ?? null : null;

  return {
    desktopState,
    storedMatter,
    status: storedMatter
      ? `Loaded cached snapshot ${truncateMiddle(storedMatter.watermark.authoritative_snapshot_id)} for ${storedMatter.case_id}.`
      : "Enter a matter ID to load a projection.",
    viewSource: storedMatter ? "cache" : "none"
  };
}

export function App() {
  const [initialAppState] = useState(loadInitialAppState);

  const [desktopState, setDesktopState] = useState<DesktopProjectionState>(initialAppState.desktopState);
  const [caseIdInput, setCaseIdInput] = useState(initialAppState.desktopState.active_case_id);
  const initialStoredMatter = initialAppState.storedMatter;
  const [projection, setProjection] = useState<MatterProjection | null>(initialStoredMatter?.projection ?? null);
  const [watermark, setWatermark] = useState<ProjectionWatermark | null>(initialStoredMatter?.watermark ?? null);
  const [viewSource, setViewSource] = useState<ViewSource>(initialAppState.viewSource);
  const [status, setStatus] = useState(initialAppState.status);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dogfoodLoading, setDogfoodLoading] = useState<"none" | "sync" | "normalize" | "ocr" | "heuristics">("none");
  const [dogfoodMessage, setDogfoodMessage] = useState<string | null>(null);
  const [reviewBusyPageId, setReviewBusyPageId] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    return () => {
      setFilePreview((prev) => {
        if (prev?.url.startsWith("blob:")) {
          URL.revokeObjectURL(prev.url);
        }
        return null;
      });
    };
  }, []);

  const activeMatterId = watermark?.case_id ?? desktopState.active_case_id;
  const currentInputMatterId = caseIdInput.trim();
  const currentStoredMatter = currentInputMatterId ? desktopState.matters[currentInputMatterId] ?? null : null;
  const activeStoredMatter = activeMatterId ? desktopState.matters[activeMatterId] ?? null : null;

  const recentMatters = useMemo(
    () => Object.values(desktopState.matters).sort((left, right) => right.fetched_at.localeCompare(left.fetched_at)),
    [desktopState.matters]
  );

  const canonicalDocuments = projection?.slices.canonical_spine_slice?.documents ?? projection?.slices.canonical_document_slice?.documents ?? [];
  const canonicalPages = projection?.slices.canonical_spine_slice?.pages ?? projection?.slices.canonical_page_slice?.pages ?? [];
  const sourceConnections = projection?.slices.source_connection_slice?.connections ?? [];
  const canonicalStateSummary =
    projection?.slices.canonical_spine_slice?.state_summary ??
    projection?.slices.canonical_document_slice?.state_summary ??
    projection?.slices.canonical_page_slice?.state_summary ??
    null;

  const proofRequirementsByIssue = useMemo(() => {
    const grouped: Record<string, ProjectionProofRequirement[]> = {};

    for (const requirement of projection?.slices.issue_proof_slice.proof_requirements ?? []) {
      grouped[requirement.issue_id] ??= [];
      grouped[requirement.issue_id].push(requirement);
    }

    return grouped;
  }, [projection]);

  const branchStagesByInstance = useMemo(() => {
    const grouped: Record<string, ProjectionBranchStageStatus[]> = {};

    for (const stageStatus of projection?.slices.branch_state_slice.branch_stage_status ?? []) {
      grouped[stageStatus.matter_branch_instance_id] ??= [];
      grouped[stageStatus.matter_branch_instance_id].push(stageStatus);
    }

    return grouped;
  }, [projection]);

  const sourceItemsById = useMemo(() => {
    const grouped: Record<string, ProjectionSourceItem> = {};

    for (const item of projection?.slices.document_inventory_slice.source_items ?? []) {
      grouped[item.id] = item;
    }

    return grouped;
  }, [projection]);

  const canonicalDocumentsById = useMemo(() => {
    const grouped: Record<string, ProjectionCanonicalDocument> = {};

    for (const document of canonicalDocuments) {
      grouped[document.id] = document;
    }

    return grouped;
  }, [canonicalDocuments]);

  const canonicalPagesByDocument = useMemo(() => {
    const grouped: Record<string, ProjectionCanonicalPage[]> = {};

    for (const page of canonicalPages) {
      const documentId = page.canonical_document_id ?? page.document_id;
      if (!documentId) {
        continue;
      }

      grouped[documentId] ??= [];
      grouped[documentId].push(page);
    }

    for (const pages of Object.values(grouped)) {
      pages.sort((left, right) => (left.page_number ?? Number.MAX_SAFE_INTEGER) - (right.page_number ?? Number.MAX_SAFE_INTEGER));
    }

    return grouped;
  }, [canonicalPages]);

  const canonicalDocumentStateCounts = useMemo(() => {
    return canonicalStateSummary?.document_state_counts ?? countLabels(canonicalDocuments.map(resolveCanonicalDocumentState));
  }, [canonicalDocuments, canonicalStateSummary]);

  const canonicalPageStateCounts = useMemo(() => {
    return canonicalStateSummary?.page_state_counts ?? countLabels(canonicalPages.map(resolveCanonicalPageState));
  }, [canonicalPages, canonicalStateSummary]);

  const sortedCanonicalPages = useMemo(() => {
    const pages = [...canonicalPages];
    pages.sort((left, right) => {
      const leftDocumentId = left.canonical_document_id ?? left.document_id ?? "";
      const rightDocumentId = right.canonical_document_id ?? right.document_id ?? "";
      if (leftDocumentId !== rightDocumentId) {
        return leftDocumentId.localeCompare(rightDocumentId);
      }

      return (left.page_number ?? Number.MAX_SAFE_INTEGER) - (right.page_number ?? Number.MAX_SAFE_INTEGER);
    });
    return pages;
  }, [canonicalPages]);

  const pagesNeedingReview = useMemo(() => {
    return canonicalPages.filter((page) => {
      if (page.ocr_status === "review_required") {
        return true;
      }
      const rs = page.review_status;
      return rs !== null && rs !== undefined && String(rs).trim().length > 0;
    });
  }, [canonicalPages]);

  function commitDesktopState(nextState: DesktopProjectionState) {
    setDesktopState(nextState);
    saveDesktopProjectionState(nextState);
  }

  function openCachedMatter(caseId: string) {
    const cachedMatter = desktopState.matters[caseId];
    if (!cachedMatter) {
      setStatus(`No cached snapshot is available for ${caseId}.`);
      return;
    }

    const nextState: DesktopProjectionState = {
      ...desktopState,
      active_case_id: caseId
    };

    commitDesktopState(nextState);
    setCaseIdInput(caseId);
    setProjection(cachedMatter.projection);
    setWatermark(cachedMatter.watermark);
    setViewSource("cache");
    setErrorMessage("");
    setStatus(
      `Loaded cached snapshot ${truncateMiddle(cachedMatter.watermark.authoritative_snapshot_id)} for ${caseId}.`
    );
  }

  async function refreshProjection() {
    const targetCaseId = caseIdInput.trim();
    if (!targetCaseId) {
      setErrorMessage("Enter a matter ID before requesting the projection.");
      setStatus("Matter ID is required.");
      return;
    }

    const cachedMatter = desktopState.matters[targetCaseId] ?? null;
    const nextActiveState: DesktopProjectionState = {
      ...desktopState,
      active_case_id: targetCaseId
    };

    commitDesktopState(nextActiveState);
    setIsLoading(true);
    setErrorMessage("");
    setStatus(`Fetching projection for ${targetCaseId}...`);

    try {
      const response = await fetch(`${API_BASE}/api/cases/${targetCaseId}/projection`, {
        headers: buildApiHeaders()
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Projection request failed with status ${response.status}.`);
      }

      const nextProjection = (await response.json()) as MatterProjection;
      const pulledAt = new Date().toISOString();
      const nextWatermark: ProjectionWatermark = {
        case_id: targetCaseId,
        authoritative_snapshot_id: nextProjection.snapshot_id,
        matter_version_token: nextProjection.matter_version_token,
        last_pull_at: pulledAt,
        last_push_at: cachedMatter?.watermark.last_push_at ?? null
      };

      const nextState: DesktopProjectionState = {
        active_case_id: targetCaseId,
        matters: {
          ...nextActiveState.matters,
          [targetCaseId]: {
            case_id: targetCaseId,
            fetched_at: pulledAt,
            projection: nextProjection,
            watermark: nextWatermark
          }
        }
      };

      commitDesktopState(nextState);
      setProjection(nextProjection);
      setWatermark(nextWatermark);
      setViewSource("remote");
      setStatus(`Projection refreshed at snapshot ${nextProjection.snapshot_id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown projection error.";
      setErrorMessage(message);

      if (cachedMatter) {
        setProjection(cachedMatter.projection);
        setWatermark(cachedMatter.watermark);
        setViewSource("cache");
        setStatus(
          `Remote projection failed. Showing cached snapshot ${truncateMiddle(cachedMatter.watermark.authoritative_snapshot_id)} instead.`
        );
      } else {
        setProjection(null);
        setWatermark(null);
        setViewSource("none");
        setStatus(`Unable to load a projection for ${targetCaseId}.`);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function runBoxSync() {
    const targetCaseId = caseIdInput.trim();
    if (!targetCaseId) {
      setDogfoodMessage("Enter a matter ID before syncing Box.");
      return;
    }
    setDogfoodLoading("sync");
    setDogfoodMessage(null);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/connectors/box/sync`, {
        method: "POST",
        headers: buildApiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ case_id: targetCaseId })
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : `Box sync failed (${response.status}).`
        );
      }
      const boxSync = payload.box_sync as Record<string, unknown> | undefined;
      const inv = payload.inventory as Record<string, unknown> | undefined;
      const parts: string[] = [];
      if (boxSync) {
        parts.push(
          `files ${String(boxSync.files_discovered ?? "?")}, folders ${String(boxSync.folders_visited ?? "?")}` +
            (boxSync.truncated ? " (truncated)" : "")
        );
      }
      if (inv?.inventoried_count != null) {
        parts.push(`hydrated ${String(inv.inventoried_count)} items`);
      }
      setDogfoodMessage(parts.length > 0 ? `Box sync: ${parts.join("; ")}.` : "Box sync completed.");
      await refreshProjection();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Box sync failed.";
      setDogfoodMessage(message);
    } finally {
      setDogfoodLoading("none");
    }
  }

  async function runNormalizeDocuments() {
    const targetCaseId = caseIdInput.trim();
    if (!targetCaseId) {
      setDogfoodMessage("Enter a matter ID before normalizing.");
      return;
    }
    setDogfoodLoading("normalize");
    setDogfoodMessage(null);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE}/dev/cases/${encodeURIComponent(targetCaseId)}/normalize-documents`, {
        method: "POST",
        headers: buildApiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : `Normalize failed (${response.status}).`
        );
      }
      const normalized = payload.normalized_count ?? payload.normalizedCount;
      const requested = payload.requested_count ?? payload.requestedCount;
      setDogfoodMessage(
        `Normalize: ${String(normalized ?? "?")} of ${String(requested ?? "?")} source items normalized.`
      );
      await refreshProjection();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Normalize failed.";
      setDogfoodMessage(message);
    } finally {
      setDogfoodLoading("none");
    }
  }

  async function runQueueOcr() {
    const targetCaseId = caseIdInput.trim();
    if (!targetCaseId) {
      setDogfoodMessage("Enter a matter ID before queueing OCR.");
      return;
    }
    setDogfoodLoading("ocr");
    setDogfoodMessage(null);
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(targetCaseId)}/ocr/queue`, {
        method: "POST",
        headers: buildApiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : `OCR queue failed (${response.status}).`
        );
      }
      const queued = payload.queued_page_count ?? payload.queuedPageCount;
      setDogfoodMessage(`OCR queue: ${String(queued ?? 0)} page(s) queued.`);
      await refreshProjection();
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR queue failed.";
      setDogfoodMessage(message);
    } finally {
      setDogfoodLoading("none");
    }
  }

  async function runHeuristicExtractions() {
    const targetCaseId = caseIdInput.trim();
    if (!targetCaseId) {
      setDogfoodMessage("Enter a matter ID before running heuristic extractions.");
      return;
    }
    if (!API_BASE) {
      setDogfoodMessage("Set VITE_API_BASE_URL to run extractions.");
      return;
    }
    setDogfoodLoading("heuristics");
    setDogfoodMessage(null);
    setErrorMessage("");
    try {
      const response = await fetch(
        `${API_BASE}/api/cases/${encodeURIComponent(targetCaseId)}/extractions/run-heuristics`,
        {
          method: "POST",
          headers: buildApiHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({})
        }
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : `Heuristic extractions failed (${response.status}).`
        );
      }
      const inserted = payload.extractions_inserted ?? payload.extractionsInserted;
      const scanned = payload.pages_scanned ?? payload.pagesScanned;
      setDogfoodMessage(
        `Heuristic extractions: inserted ${String(inserted ?? "?")} row(s) across ${String(scanned ?? "?")} page(s) with text.`
      );
      await refreshProjection();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Heuristic extractions failed.";
      setDogfoodMessage(message);
    } finally {
      setDogfoodLoading("none");
    }
  }

  async function requeueOcrForPage(pageId: string) {
    const targetCaseId = caseIdInput.trim();
    if (!targetCaseId || !API_BASE) {
      setDogfoodMessage("Enter a matter ID and set VITE_API_BASE_URL to re-queue OCR.");
      return;
    }
    setReviewBusyPageId(pageId);
    setDogfoodMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(targetCaseId)}/ocr/queue`, {
        method: "POST",
        headers: buildApiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ canonical_page_ids: [pageId], force_rerun: true })
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : `Re-queue OCR failed (${response.status}).`
        );
      }
      const queued = payload.queued_page_count ?? payload.queuedPageCount;
      setDogfoodMessage(`Re-queued OCR for page: ${String(queued ?? 0)} job(s).`);
      await refreshProjection();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Re-queue OCR failed.";
      setDogfoodMessage(message);
    } finally {
      setReviewBusyPageId(null);
    }
  }

  async function resolveOcrReviewForPage(pageId: string, acceptEmpty: boolean) {
    if (!API_BASE) {
      setDogfoodMessage("Set VITE_API_BASE_URL to resolve review.");
      return;
    }
    setReviewBusyPageId(pageId);
    setDogfoodMessage(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/canonical-pages/${encodeURIComponent(pageId)}/ocr-review/resolve`,
        {
          method: "POST",
          headers: buildApiHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ accept_empty: acceptEmpty })
        }
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : `Resolve review failed (${response.status}).`
        );
      }
      setDogfoodMessage("Review resolved for page.");
      await refreshProjection();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resolve review failed.";
      setDogfoodMessage(message);
    } finally {
      setReviewBusyPageId(null);
    }
  }

  function closeFilePreview() {
    setFilePreview((prev) => {
      if (prev?.url.startsWith("blob:")) {
        URL.revokeObjectURL(prev.url);
      }
      return null;
    });
  }

  async function openBoxPreview(sourceItemId: string, title: string | null | undefined) {
    if (!API_BASE) {
      setDogfoodMessage("Set VITE_API_BASE_URL to preview files.");
      return;
    }
    setDogfoodMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/files/${encodeURIComponent(sourceItemId)}/content`, {
        headers: buildApiHeaders()
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Download failed (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setFilePreview((prev) => {
        if (prev?.url.startsWith("blob:")) {
          URL.revokeObjectURL(prev.url);
        }
        return { url, title: title ?? sourceItemId };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview failed.";
      setDogfoodMessage(message);
    }
  }

  const projectionCaseHeader = projection?.slices.case_header ?? null;
  const projectionMetadata = projection?.snapshot_metadata ?? null;
  const issueCount = projection?.slices.issue_proof_slice.issues.length ?? 0;
  const proofCount = projection?.slices.issue_proof_slice.proof_requirements.length ?? 0;
  const branchCount = projection?.slices.branch_state_slice.branch_instances.length ?? 0;
  const sourceItemCount = projection?.slices.document_inventory_slice.source_items.length ?? 0;
  const canonicalDocumentCount = canonicalStateSummary?.document_count ?? canonicalDocuments.length;
  const canonicalPageCount = canonicalStateSummary?.page_count ?? canonicalPages.length;
  const canonicalSpineAvailable = canonicalDocumentCount > 0 || canonicalPageCount > 0;
  const projectionSnapshotCreatedAt = projection?.snapshot_created_at ?? projectionMetadata?.snapshot_created_at ?? null;
  const projectionVersion = projection?.projection_version ?? projectionMetadata?.projection_version ?? null;
  const sliceChecksum = projection?.slice_checksum ?? projectionMetadata?.slice_checksum ?? null;
  const assetManifestVersion = projection?.asset_manifest_version ?? projectionMetadata?.asset_manifest_version ?? null;
  const documentInventoryClassificationSummary =
    projection?.slices.document_inventory_slice.classification_summary ?? null;
  const ocrSummary = projection?.slices.document_inventory_slice.ocr_summary ?? null;
  const sourceSnapshotSummary = summarizeKeyValueRecord(projectionMetadata?.latest_source_snapshot_ids);
  const canonicalDocumentStateSummary = summarizeCountRecord(canonicalDocumentStateCounts);
  const canonicalPageStateSummary = summarizeCountRecord(canonicalPageStateCounts);
  const classificationMethodSummary = summarizeCountRecord(documentInventoryClassificationSummary?.by_method);
  const classificationCategorySummary = summarizeCountRecord(documentInventoryClassificationSummary?.by_category);
  const ocrStatusSummary = summarizeCountRecord(ocrSummary?.by_ocr_status);
  const extractionStatusSummary = summarizeCountRecord(ocrSummary?.by_extraction_status);
  const canonicalDocumentsWithPages = canonicalDocuments.filter((document) => {
    const pageCount = document.page_count ?? canonicalPagesByDocument[document.id]?.length ?? 0;
    return pageCount > 0;
  }).length;
  const projectionEndpointPreview =
    API_BASE === "" ? "/api/cases/:caseId/projection" : `${API_BASE}/api/cases/:caseId/projection`;

  return (
    <div style={pageStyle}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <StatusBadge label="Slice 02 Desktop" tone="good" />
          <StatusBadge label="Dogfood actions" tone="neutral" />
          <StatusBadge
            label={viewSource === "remote" ? "Remote Projection" : viewSource === "cache" ? "Local Cached Snapshot" : "No Projection"}
            tone={viewSource === "remote" ? "good" : viewSource === "cache" ? "warn" : "neutral"}
          />
          <StatusBadge
            label={
              !projection
                ? "Canonical Spine Unavailable"
                : canonicalSpineAvailable
                  ? "Canonical Spine Visible"
                  : "Canonical Spine Pending API"
            }
            tone={!projection ? "neutral" : canonicalSpineAvailable ? "good" : "warn"}
          />
        </div>
        <h1 style={{ margin: "0 0 10px", fontSize: 30 }}>Matter Dashboard</h1>
        <p style={{ margin: 0, color: "#b2c0d9", lineHeight: 1.65, maxWidth: 920 }}>
          This shell opens a matter from the projection endpoint, renders the active matter read model in a lawyer-friendly
          layout, and now exposes the canonical document or page spine alongside source inventory and local snapshot
          caching.
        </p>
      </header>

      {errorMessage ? (
        <div
          style={{
            ...cardStyle,
            borderColor: "rgba(248, 113, 113, 0.28)",
            background: "rgba(69, 10, 10, 0.26)",
            marginBottom: 18,
            color: "#ffd0d0"
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>Projection Error</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div style={shellGridStyle}>
        <aside style={{ display: "grid", gap: 16 }}>
          <SectionCard title="Open Matter" subtitle="Use an existing matter ID and refresh from the projection endpoint.">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void refreshProjection();
              }}
              style={{ display: "grid", gap: 12 }}
            >
              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#9fb0cc" }}>Matter ID</span>
                <input
                  value={caseIdInput}
                  onChange={(event) => setCaseIdInput(event.target.value)}
                  placeholder="e.g. 7b4f7c31-..."
                  style={inputStyle}
                />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="submit" style={primaryButtonStyle} disabled={isLoading}>
                  {isLoading ? "Refreshing..." : "Refresh Projection"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={!currentStoredMatter}
                  onClick={() => {
                    if (currentInputMatterId !== "") {
                      openCachedMatter(currentInputMatterId);
                    }
                  }}
                >
                  Open Cached
                </button>
              </div>
            </form>
            <div style={{ ...subtleCardStyle, marginTop: 14, padding: 14 }}>
              <div style={{ fontSize: 13, color: "#9fb0cc", marginBottom: 8 }}>Read Path</div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                Endpoint: <code>{projectionEndpointPreview}</code>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 6 }}>
                Local storage: cached projection plus watermark metadata per matter
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Box & spine (dogfood)"
            subtitle="Calls the API on this matter ID, then refreshes projection. Case needs box_root_folder_id for sync."
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={dogfoodLoading !== "none" || isLoading}
                  onClick={() => void runBoxSync()}
                >
                  {dogfoodLoading === "sync" ? "Syncing Box…" : "Sync Box"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={dogfoodLoading !== "none" || isLoading}
                  onClick={() => void runNormalizeDocuments()}
                >
                  {dogfoodLoading === "normalize" ? "Normalizing…" : "Normalize documents"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={dogfoodLoading !== "none" || isLoading}
                  onClick={() => void runQueueOcr()}
                >
                  {dogfoodLoading === "ocr" ? "Queueing OCR…" : "Queue OCR"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={dogfoodLoading !== "none" || isLoading}
                  onClick={() => void runHeuristicExtractions()}
                >
                  {dogfoodLoading === "heuristics" ? "Running…" : "Run heuristic extractions"}
                </button>
              </div>
              {dogfoodMessage ? (
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.55,
                    color:
                      /failed|required|not found/i.test(dogfoodMessage) && !/completed|queued|hydrated/i.test(dogfoodMessage)
                        ? "#fca5a5"
                        : "#b8d4ff"
                  }}
                >
                  {dogfoodMessage}
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Snapshot State" subtitle="Durable local metadata plus additive projection metadata for the active matter read model.">
            {watermark ? (
              <div>
                <DetailRow label="Matter ID" value={<code>{watermark.case_id}</code>} />
                <DetailRow
                  label="Snapshot ID"
                  value={<code title={watermark.authoritative_snapshot_id}>{truncateMiddle(watermark.authoritative_snapshot_id)}</code>}
                />
                <DetailRow
                  label="Version Token"
                  value={<code title={watermark.matter_version_token}>{watermark.matter_version_token ?? "Unavailable"}</code>}
                />
                <DetailRow label="Last Pull" value={formatDateTime(watermark.last_pull_at)} />
                <DetailRow label="Last Push" value={formatDateTime(watermark.last_push_at)} />
                <DetailRow label="Cached At" value={formatDateTime(activeStoredMatter?.fetched_at ?? null)} />
                <DetailRow label="Projection Version" value={projectionVersion ?? "Unavailable"} />
                <DetailRow label="Snapshot Created" value={formatDateTime(projectionSnapshotCreatedAt)} />
                <DetailRow
                  label="Slice Checksum"
                  value={sliceChecksum ? <code title={sliceChecksum}>{truncateMiddle(sliceChecksum)}</code> : "Unavailable"}
                />
                <DetailRow
                  label="Asset Manifest"
                  value={
                    assetManifestVersion ? (
                      <code title={assetManifestVersion}>{truncateMiddle(assetManifestVersion)}</code>
                    ) : (
                      "Unavailable"
                    )
                  }
                />
                <DetailRow label="Source Snapshots" value={sourceSnapshotSummary} />
              </div>
            ) : (
              <EmptyState message="No projection has been cached yet for this desktop shell." />
            )}
          </SectionCard>

          <SectionCard
            title="Source Connections"
            subtitle="Connector mode, latest case sync, and current inventory coverage."
          >
            {sourceConnections.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {sourceConnections.map((connection) => (
                  <div key={connection.id} style={subtleCardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <strong>{formatLabel(connection.provider)}</strong>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <StatusBadge label={connection.status} tone={toneForStatus(connection.status)} />
                        <StatusBadge label={formatLabel(connection.auth_mode)} tone="neutral" />
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6, color: "#c8d5eb", fontSize: 13, lineHeight: 1.55 }}>
                      <div>Account: {connection.account_label ?? "Unnamed connection"}</div>
                      <div>
                        External account: {connection.external_account_id ?? "Not completed yet"}
                        {connection.callback_state ? <> | Callback <code>{truncateMiddle(connection.callback_state)}</code></> : null}
                      </div>
                      <div>Last verified: {formatDateTime(connection.last_verified_at)}</div>
                      <div>
                        Latest sync:{" "}
                        {connection.latest_sync_status
                          ? `${formatLabel(connection.latest_sync_status)} (${formatLabel(connection.latest_sync_type ?? "unknown")})`
                          : "No case sync yet"}
                      </div>
                      <div>Sync started: {formatDateTime(connection.latest_sync_started_at)}</div>
                      <div>Sync completed: {formatDateTime(connection.latest_sync_completed_at)}</div>
                      <div>
                        Case inventory: {connection.source_item_count ?? 0} source items | {connection.snapshot_count ?? 0} snapshots
                      </div>
                      {connection.authorization_url ? (
                        <div>
                          Pending auth URL: <code title={connection.authorization_url}>{truncateMiddle(connection.authorization_url, 20, 12)}</code>
                        </div>
                      ) : null}
                      {connection.last_error_message ? (
                        <div style={{ color: "#ffd0d0" }}>Connection error: {connection.last_error_message}</div>
                      ) : null}
                      {connection.latest_sync_error ? (
                        <div style={{ color: "#ffd0d0" }}>Latest error: {connection.latest_sync_error}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No source connections have been exercised for this matter yet." />
            )}
          </SectionCard>

          <SectionCard title="Recent Matters" subtitle="Recently opened local projections that can be re-opened without another round trip.">
            {recentMatters.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {recentMatters.map((matter) => (
                  <button
                    key={matter.case_id}
                    type="button"
                    onClick={() => openCachedMatter(matter.case_id)}
                    style={{
                      ...subtleCardStyle,
                      cursor: "pointer",
                      padding: 14,
                      textAlign: "left"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <strong>{matter.projection.slices.case_header?.name ?? "Untitled Matter"}</strong>
                      <StatusBadge label={matter.case_id === activeMatterId ? "Active" : "Cached"} tone={matter.case_id === activeMatterId ? "good" : "neutral"} />
                    </div>
                    <div style={{ fontSize: 13, color: "#9fb0cc", marginBottom: 6 }}>
                      <code>{matter.case_id}</code>
                    </div>
                    <div style={{ fontSize: 13, color: "#c7d3ea" }}>
                      Snapshot {truncateMiddle(matter.watermark.authoritative_snapshot_id)} | {formatDateTime(matter.fetched_at)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState message="No local matter projections have been stored yet." />
            )}
          </SectionCard>

          <SectionCard title="Slice Boundaries" subtitle="Kept intentionally small and additive for Slice 02 acceptance.">
            <div style={{ display: "grid", gap: 10 }}>
              <div style={subtleCardStyle}>
                <strong style={{ display: "block", marginBottom: 8 }}>Included</strong>
                <div style={{ color: "#c9d6ee", lineHeight: 1.6 }}>
                  Case header, issue and proof slice, branch state slice, document inventory slice, additive projection
                  metadata, and optional canonical document or page state when the API provides it.
                </div>
              </div>
              <div style={subtleCardStyle}>
                <strong style={{ display: "block", marginBottom: 8 }}>Deferred</strong>
                <div style={{ color: "#c9d6ee", lineHeight: 1.6 }}>
                  Annotation workflows, local FTS or vector search, and write-back beyond placeholder pull or push
                  metadata. (Basic OCR review + heuristic extractions are wired via API and this shell.)
                </div>
              </div>
            </div>
          </SectionCard>
        </aside>

        <main style={{ display: "grid", gap: 16 }}>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12
            }}
          >
            {[
              {
                label: "Matter",
                value: projectionCaseHeader?.name ?? "No matter loaded",
                detail: activeMatterId || "Awaiting selection"
              },
              {
                label: "Issues / Proof",
                value: `${issueCount} / ${proofCount}`,
                detail: "issues and proof requirements"
              },
              {
                label: "Branches",
                value: String(branchCount),
                detail: "branch instances in projection"
              },
              {
                label: "Source Items",
                value: String(sourceItemCount),
                detail: "source items inventoried"
              },
              {
                label: "Canonical Docs",
                value: String(canonicalDocumentCount),
                detail: canonicalSpineAvailable ? "documents in canonical spine" : "awaiting additive API slice"
              },
              {
                label: "Canonical Pages",
                value: String(canonicalPageCount),
                detail: canonicalSpineAvailable ? "pages in canonical spine" : "awaiting additive API slice"
              }
            ].map((metric) => (
              <div key={metric.label} style={cardStyle}>
                <div style={{ fontSize: 13, color: "#9fb0cc", marginBottom: 10 }}>{metric.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{metric.value}</div>
                <div style={{ fontSize: 13, color: "#bfd0ea", lineHeight: 1.5 }}>{metric.detail}</div>
              </div>
            ))}
          </section>

          <div
            style={{
              ...cardStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap"
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: "#9fb0cc", marginBottom: 4 }}>Shell Status</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{status}</div>
            </div>
            {projectionCaseHeader ? (
              <StatusBadge label={projectionCaseHeader.status} tone={toneForStatus(projectionCaseHeader.status)} />
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <SectionCard title="Case Header" subtitle="Core matter identity and top-level status.">
              {projectionCaseHeader ? (
                <div>
                  <DetailRow label="Matter Name" value={projectionCaseHeader.name} />
                  <DetailRow label="Matter ID" value={<code>{projectionCaseHeader.id}</code>} />
                  <DetailRow label="Case Type" value={formatLabel(projectionCaseHeader.case_type)} />
                  <DetailRow label="Status" value={<StatusBadge label={projectionCaseHeader.status} tone={toneForStatus(projectionCaseHeader.status)} />} />
                  <DetailRow label="PracticePanther" value={projectionCaseHeader.pp_matter_id ?? "Not linked"} />
                  <DetailRow label="Box Root Folder" value={projectionCaseHeader.box_root_folder_id ?? "Not linked"} />
                </div>
              ) : (
                <EmptyState message="Load a matter projection to view the case header." />
              )}
            </SectionCard>

            <SectionCard title="Canonical Spine" subtitle="Optional Slice 02 document/page read model for the active matter.">
              {projection ? (
                canonicalSpineAvailable ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: 10
                      }}
                    >
                      {[
                        { label: "Canonical Documents", value: String(canonicalDocumentCount) },
                        { label: "Canonical Pages", value: String(canonicalPageCount) },
                        { label: "Docs With Pages", value: String(canonicalDocumentsWithPages) },
                        { label: "Projection Version", value: projectionVersion ?? "Pending" }
                      ].map((metric) => (
                        <div key={metric.label} style={{ ...subtleCardStyle, padding: 12 }}>
                          <div style={{ fontSize: 12, color: "#93a7cd", marginBottom: 6 }}>{metric.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{metric.value}</div>
                        </div>
                      ))}
                    </div>
                    <DetailRow label="Document States" value={canonicalDocumentStateSummary} />
                    <DetailRow label="Page States" value={canonicalPageStateSummary} />
                    <DetailRow label="OCR Status" value={ocrStatusSummary} />
                    <DetailRow label="Extraction Status" value={extractionStatusSummary} />
                    <DetailRow label="Source Snapshots" value={sourceSnapshotSummary} />
                  </div>
                ) : (
                  <EmptyState message="This projection does not yet include canonical document/page slices." />
                )
              ) : (
                <EmptyState message="Load a matter projection to inspect canonical document/page state." />
              )}
            </SectionCard>

            <SectionCard
              title="OCR review queue"
              subtitle="Pages in review_required or with an active ocr_review_queue row. Re-run OCR or acknowledge review via API."
            >
              {pagesNeedingReview.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {pagesNeedingReview.map((page) => {
                    const documentId = page.canonical_document_id ?? page.document_id ?? null;
                    const linkedDocument = documentId ? canonicalDocumentsById[documentId] ?? null : null;
                    const sourceItemId =
                      page.source_item_id ?? (linkedDocument ? resolveCanonicalDocumentSourceItemId(linkedDocument) : null);
                    const sourceItem = sourceItemId ? sourceItemsById[sourceItemId] ?? null : null;
                    const officeHint = officeFormatHintFromTitle(sourceItem?.title ?? null);
                    const busy = reviewBusyPageId === page.id;
                    return (
                      <div key={page.id} style={{ ...subtleCardStyle, display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>
                          Page {page.page_number ?? "?"} · <code style={{ fontSize: 12 }}>{truncateMiddle(page.id)}</code>
                        </div>
                        <div style={{ fontSize: 13, color: "#c8d5eb", lineHeight: 1.55 }}>
                          {linkedDocument
                            ? resolveCanonicalDocumentTitle(linkedDocument, sourceItem?.title ?? null)
                            : "Unlinked page"}
                          {page.ocr_status ? (
                            <>
                              {" "}
                              | OCR <strong>{formatLabel(page.ocr_status)}</strong>
                            </>
                          ) : null}
                          {page.review_status ? (
                            <>
                              {" "}
                              | Review <strong>{formatLabel(String(page.review_status))}</strong>
                            </>
                          ) : null}
                        </div>
                        {officeHint ? <div style={{ fontSize: 13, color: "#fcd34d" }}>{officeHint}</div> : null}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={{ ...secondaryButtonStyle, padding: "8px 12px", fontSize: 12 }}
                            disabled={busy || dogfoodLoading !== "none"}
                            onClick={() => void requeueOcrForPage(page.id)}
                          >
                            {busy ? "Working…" : "Re-queue OCR"}
                          </button>
                          <button
                            type="button"
                            style={{ ...secondaryButtonStyle, padding: "8px 12px", fontSize: 12 }}
                            disabled={busy || dogfoodLoading !== "none"}
                            onClick={() => void resolveOcrReviewForPage(page.id, false)}
                          >
                            Resolve (has text)
                          </button>
                          <button
                            type="button"
                            style={{ ...secondaryButtonStyle, padding: "8px 12px", fontSize: 12 }}
                            disabled={busy || dogfoodLoading !== "none"}
                            onClick={() => void resolveOcrReviewForPage(page.id, true)}
                          >
                            Resolve empty OK
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No pages are waiting on OCR review in this projection." />
              )}
            </SectionCard>

            <SectionCard title="Canonical Documents" subtitle="Read-only canonical document state with linked page coverage when the API provides it.">
              {canonicalDocuments.length > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {canonicalDocuments.map((document) => {
                    const state = resolveCanonicalDocumentState(document);
                    const typeName = resolveCanonicalDocumentType(document);
                    const primarySourceItemId = resolveCanonicalDocumentSourceItemId(document);
                    const primarySourceItem = primarySourceItemId ? sourceItemsById[primarySourceItemId] ?? null : null;
                    const linkedPages = canonicalPagesByDocument[document.id] ?? [];
                    const pageCountForDocument = document.page_count ?? linkedPages.length;
                    const additionalSourceItems = summarizeIdList(document.source_item_ids);
                    const providerLabel = document.provider ?? primarySourceItem?.provider ?? null;
                    const sourceKindLabel = document.source_kind ?? primarySourceItem?.source_kind ?? null;
                    return (
                      <div key={document.id} style={{ ...subtleCardStyle, display: "grid", gap: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>
                              {resolveCanonicalDocumentTitle(document, primarySourceItem?.title ?? null)}
                            </div>
                            <div style={{ fontSize: 12, color: "#92a6cb", marginTop: 4 }}>
                              <code>{document.id}</code>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                            <StatusBadge label={formatLabel(state)} tone={toneForStatus(state)} />
                            {document.ocr_status ? (
                              <StatusBadge label={`OCR ${formatLabel(document.ocr_status)}`} tone={toneForStatus(document.ocr_status)} />
                            ) : null}
                            {document.ingestion_status ? (
                              <StatusBadge
                                label={`Ingest ${formatLabel(document.ingestion_status)}`}
                                tone={toneForStatus(document.ingestion_status)}
                              />
                            ) : null}
                            {typeName ? <StatusBadge label={formatLabel(typeName)} tone="neutral" /> : null}
                            {providerLabel ? <StatusBadge label={formatLabel(providerLabel)} tone="neutral" /> : null}
                            {sourceKindLabel ? <StatusBadge label={formatLabel(sourceKindLabel)} tone="neutral" /> : null}
                            {document.mandatory_vlm_ocr === 1 ? <StatusBadge label="VLM Required" tone="warn" /> : null}
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 6, color: "#c8d5eb", fontSize: 13, lineHeight: 1.55 }}>
                          <div>
                            Source item: {primarySourceItemId ? <code>{primarySourceItemId}</code> : "No primary source item linked yet."}
                          </div>
                          <div>
                            Canonical pages: {pageCountForDocument > 0 ? String(pageCountForDocument) : "No canonical pages linked yet."}
                          </div>
                          <div>
                            OCR coverage: {document.complete_pages ?? 0} complete | {document.queued_pages ?? 0} queued |{" "}
                            {document.processing_pages ?? 0} processing | {document.review_required_pages ?? 0} review
                          </div>
                          <div>Updated: {formatDateTime(document.updated_at)}</div>
                          {document.latest_version_token ? (
                            <div>
                              Version token: <code title={document.latest_version_token}>{truncateMiddle(document.latest_version_token)}</code>
                            </div>
                          ) : null}
                          {additionalSourceItems && document.source_item_ids && document.source_item_ids.length > 1 ? (
                            <div>Additional source items: {additionalSourceItems}</div>
                          ) : null}
                        </div>
                        {linkedPages.length > 0 ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {linkedPages.map((page) => {
                              const pageState = resolveCanonicalPageState(page);
                              return (
                                <div
                                  key={page.id}
                                  style={{
                                    borderRadius: 10,
                                    padding: "8px 10px",
                                    background: "rgba(37, 99, 235, 0.12)",
                                    border: "1px solid rgba(96, 165, 250, 0.18)",
                                    fontSize: 13,
                                    lineHeight: 1.5
                                  }}
                                >
                                  <strong style={{ display: "block", marginBottom: 2 }}>
                                    Page {page.page_number ?? "?"}
                                  </strong>
                                  <span style={{ color: "#c4d3ec" }}>{formatLabel(pageState)}</span>
                                  {page.ocr_status ? <span style={{ color: "#93a7cd" }}> | OCR {formatLabel(page.ocr_status)}</span> : null}
                                  {page.review_status ? (
                                    <span style={{ color: "#fcd34d" }}> | Review {formatLabel(page.review_status)}</span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ color: "#9fb0cc", fontSize: 13 }}>No canonical page rows are linked to this document yet.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No canonical document rows are present in the current projection." />
              )}
            </SectionCard>

            <SectionCard title="Canonical Pages" subtitle="Per-page state across the canonical spine for the active matter.">
              {sortedCanonicalPages.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {sortedCanonicalPages.map((page) => {
                    const documentId = page.canonical_document_id ?? page.document_id ?? null;
                    const linkedDocument = documentId ? canonicalDocumentsById[documentId] ?? null : null;
                    const sourceItemId = page.source_item_id ?? (linkedDocument ? resolveCanonicalDocumentSourceItemId(linkedDocument) : null);
                    const sourceItem = sourceItemId ? sourceItemsById[sourceItemId] ?? null : null;
                    const pageState = resolveCanonicalPageState(page);
                    return (
                      <div key={page.id} style={{ ...subtleCardStyle, display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>Page {page.page_number ?? "?"}</div>
                            <div style={{ fontSize: 13, color: "#9fb0cc", marginTop: 4 }}>
                              {linkedDocument
                                ? resolveCanonicalDocumentTitle(linkedDocument, sourceItem?.title ?? null)
                                : sourceItem?.title ?? "Unlinked canonical page"}
                            </div>
                            <div style={{ fontSize: 12, color: "#92a6cb", marginTop: 4 }}>
                              <code>{page.id}</code>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                            <StatusBadge label={formatLabel(pageState)} tone={toneForStatus(pageState)} />
                            {page.extraction_status && page.extraction_status !== pageState ? (
                              <StatusBadge label={`Extract ${formatLabel(page.extraction_status)}`} tone={toneForStatus(page.extraction_status)} />
                            ) : null}
                            {page.ocr_status ? <StatusBadge label={`OCR ${formatLabel(page.ocr_status)}`} tone={toneForStatus(page.ocr_status)} /> : null}
                            {page.review_status ? (
                              <StatusBadge label={`Review ${formatLabel(page.review_status)}`} tone={toneForStatus(page.review_status)} />
                            ) : null}
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 6, color: "#c8d5eb", fontSize: 13, lineHeight: 1.55 }}>
                          <div>
                            Canonical document: {documentId ? <code>{documentId}</code> : "Not linked yet."}
                          </div>
                          <div>Source item: {sourceItemId ? <code>{sourceItemId}</code> : "Unavailable"}</div>
                          <div>OCR engine: {page.ocr_method ?? "Not recorded"}</div>
                          <div>OCR confidence: {formatConfidence(page.ocr_confidence)}</div>
                          <div>
                            Review severity: {page.review_severity ? formatLabel(page.review_severity) : "No active review"}
                            {Number(page.blocker_for_branch ?? 0) === 1 ? " | Branch blocker" : ""}
                          </div>
                          <div>Updated: {formatDateTime(page.updated_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No canonical page rows are present in the current projection." />
              )}
            </SectionCard>

            <SectionCard title="Issue And Proof" subtitle="Issue tracking with the linked proof requirements beneath each issue.">
              {projection && issueCount > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {projection.slices.issue_proof_slice.issues.map((issue) => {
                    const requirements = proofRequirementsByIssue[issue.id] ?? [];
                    return (
                      <div key={issue.id} style={subtleCardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{formatLabel(issue.issue_type)}</div>
                            <div style={{ fontSize: 12, color: "#92a6cb", marginTop: 4 }}>
                              <code>{issue.id}</code>
                            </div>
                          </div>
                          <StatusBadge label={issue.status} tone={toneForStatus(issue.status)} />
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ color: "#d6e2f5", fontSize: 14 }}>
                            {issue.requested_relief ? `Requested relief: ${issue.requested_relief}` : "No requested relief captured yet."}
                          </div>
                          <div style={{ color: "#9fb0cc", fontSize: 13 }}>
                            {requirements.length} proof requirement{requirements.length === 1 ? "" : "s"}
                          </div>
                          {requirements.length > 0 ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {requirements.map((requirement) => (
                                <div
                                  key={requirement.id}
                                  style={{
                                    borderRadius: 10,
                                    padding: "8px 10px",
                                    background: "rgba(37, 99, 235, 0.12)",
                                    border: "1px solid rgba(96, 165, 250, 0.18)",
                                    fontSize: 13,
                                    lineHeight: 1.5
                                  }}
                                >
                                  <strong style={{ display: "block", marginBottom: 2 }}>{formatLabel(requirement.requirement_key)}</strong>
                                  <span style={{ color: "#c4d3ec" }}>{formatLabel(requirement.requirement_policy)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No issues are present in the current projection slice." />
              )}
            </SectionCard>

            <SectionCard title="Branch State" subtitle="Branch instances and their current stage progression for the loaded matter.">
              {projection && branchCount > 0 ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {projection.slices.branch_state_slice.branch_instances.map((branch) => {
                    const stageRows = branchStagesByInstance[branch.id] ?? [];
                    return (
                      <div key={branch.id} style={subtleCardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>
                              {formatLabel(branch.current_stage_key ?? "unassigned stage")}
                            </div>
                            <div style={{ fontSize: 12, color: "#92a6cb", marginTop: 4 }}>
                              <code>{branch.id}</code>
                            </div>
                          </div>
                          <StatusBadge label={branch.status} tone={toneForStatus(branch.status)} />
                        </div>
                        <div style={{ color: "#9fb0cc", fontSize: 13, marginBottom: 10 }}>
                          Started {formatDateTime(branch.started_at)} | {stageRows.length} stage row{stageRows.length === 1 ? "" : "s"}
                        </div>
                        {stageRows.length > 0 ? (
                          <div style={{ display: "grid", gap: 8 }}>
                            {stageRows.map((stage) => (
                              <div
                                key={stage.id}
                                style={{
                                  display: "grid",
                                  gap: 8,
                                  gridTemplateColumns: "minmax(0, 160px) minmax(0, 1fr)",
                                  alignItems: "center",
                                  paddingTop: 8,
                                  borderTop: "1px solid rgba(148, 163, 184, 0.1)"
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 600 }}>{formatLabel(stage.stage_key)}</div>
                                  <div style={{ fontSize: 12, color: "#91a4c9", marginTop: 4 }}>
                                    {formatDateTime(stage.entered_at)}
                                  </div>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                  <div style={{ color: "#c8d5eb", fontSize: 13 }}>
                                    {stage.progress_summary ?? stage.blocker_summary ?? "No stage summary available."}
                                  </div>
                                  <StatusBadge label={stage.status} tone={toneForStatus(stage.status)} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: "#9fb0cc", fontSize: 13 }}>No stage status rows are present for this branch instance.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No branch state has been projected for this matter." />
              )}
            </SectionCard>

            <SectionCard title="Document Inventory" subtitle="Read-only source inventory, kept separate from the canonical spine.">
              {projection && sourceItemCount > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ ...subtleCardStyle, display: "grid", gap: 8 }}>
                    <DetailRow
                      label="Classification"
                      value={
                        documentInventoryClassificationSummary
                          ? `${documentInventoryClassificationSummary.classified} classified / ${documentInventoryClassificationSummary.unclassified} unclassified`
                          : "Summary unavailable"
                      }
                    />
                    <DetailRow label="Methods" value={classificationMethodSummary} />
                    <DetailRow label="Categories" value={classificationCategorySummary} />
                    <DetailRow
                      label="OCR Work"
                      value={
                        ocrSummary
                          ? `${ocrSummary.review_required_count} review required | ${ocrSummary.blocking_review_count} blockers`
                          : "No OCR summary yet"
                      }
                    />
                  </div>
                  {projection.slices.document_inventory_slice.source_items.map((item: ProjectionSourceItem) => {
                    const rawSummary = summarizeRawJson(item.raw_json);
                    const officeHint = officeFormatHintFromTitle(item.title);
                    return (
                      <div
                        key={item.id}
                        style={{
                          ...subtleCardStyle,
                          display: "grid",
                          gap: 8
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{item.title ?? "Untitled source item"}</div>
                            <div style={{ fontSize: 12, color: "#92a6cb", marginTop: 4 }}>
                              <code>{item.id}</code>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <StatusBadge label={item.provider} tone="neutral" />
                            <StatusBadge label={item.source_kind} tone="neutral" />
                            {item.document_type_name ? <StatusBadge label={formatLabel(item.document_type_name)} tone="neutral" /> : null}
                            {item.classification_method ? (
                              <StatusBadge label={formatLabel(item.classification_method)} tone={toneForStatus(item.classification_method)} />
                            ) : null}
                            {item.mandatory_vlm_ocr === 1 ? <StatusBadge label="VLM Required" tone="warn" /> : null}
                            {item.provider === "box" && API_BASE ? (
                              <button
                                type="button"
                                style={{ ...secondaryButtonStyle, padding: "6px 10px", fontSize: 12 }}
                                onClick={() => void openBoxPreview(item.id, item.title)}
                              >
                                Preview file
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: "#9fb0cc" }}>Updated {formatDateTime(item.updated_at)}</div>
                        <div style={{ color: "#c8d5eb", fontSize: 13, lineHeight: 1.55 }}>
                          Category: {item.document_category ? formatLabel(item.document_category) : "Uncategorized"} | Relevance:{" "}
                          {item.hearing_relevance ? formatLabel(item.hearing_relevance) : "Unrated"} | Confidence:{" "}
                          {formatConfidence(item.classification_confidence)}
                        </div>
                        <div style={{ color: "#c8d5eb", fontSize: 13, lineHeight: 1.55 }}>
                          Normalization: {item.normalization_status ? formatLabel(item.normalization_status) : "Not normalized"}
                          {item.canonical_document_id ? (
                            <>
                              {" "}
                              | Canonical doc <code>{truncateMiddle(item.canonical_document_id)}</code>
                            </>
                          ) : null}
                        </div>
                        <div style={{ color: "#d6e2f5", fontSize: 14, lineHeight: 1.55 }}>
                          {rawSummary ?? "No raw source metadata was returned for this item."}
                        </div>
                        {officeHint ? (
                          <div style={{ color: "#fcd34d", fontSize: 13, lineHeight: 1.55 }}>{officeHint}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No source items are present in the current projection slice." />
              )}
            </SectionCard>

            <SectionCard
              title="Structured extractions"
              subtitle="Append-only page_extractions: manual POST /api/canonical-pages/:id/extractions or POST /api/cases/:caseId/extractions/run-heuristics (wc_letterhead_dates.v1, wc_medical_identifiers.v1)."
            >
              {projection?.slices.extraction_slice?.extractions?.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {projection.slices.extraction_slice.extractions.map((row) => (
                    <div key={row.id} style={subtleCardStyle}>
                      <div style={{ fontSize: 13, color: "#9fb0cc" }}>
                        <code>{row.schema_key}</code> · page <code>{truncateMiddle(row.canonical_page_id)}</code>
                      </div>
                      <pre style={{ margin: "8px 0 0", fontSize: 12, color: "#d6e2f5", overflow: "auto", maxHeight: 160 }}>
                        {JSON.stringify(row.payload ?? {}, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No page_extractions rows for this matter yet." />
              )}
            </SectionCard>

            <SectionCard
              title="Exhibits & artifacts"
              subtitle="Packet builder and template-driven outputs will plug into wc-rules here."
            >
              <EmptyState message="Exhibit mapping and hearing artifacts are not wired in this slice." />
            </SectionCard>
          </div>
        </main>
      </div>

      {filePreview ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 8, 23, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 24
          }}
          onClick={closeFilePreview}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              closeFilePreview();
            }
          }}
        >
          <div
            style={{
              ...cardStyle,
              maxWidth: "min(960px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              position: "relative"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{filePreview.title}</div>
              <button type="button" style={secondaryButtonStyle} onClick={closeFilePreview}>
                Close
              </button>
            </div>
            <object
              data={filePreview.url}
              type="application/pdf"
              title={filePreview.title}
              style={{ width: "100%", minHeight: 480, border: "none", borderRadius: 12 }}
            >
              <p style={{ color: "#9fb0cc" }}>PDF preview not supported in this browser — open the API file route directly.</p>
            </object>
          </div>
        </div>
      ) : null}
    </div>
  );
}

