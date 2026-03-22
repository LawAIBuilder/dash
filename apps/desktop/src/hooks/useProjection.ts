import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MatterProjection } from "@wc/domain-core";
import { buildWatermark, getProjection } from "@/lib/api-client";
import {
  loadDesktopProjectionState,
  saveDesktopProjectionState,
  type DesktopProjectionState
} from "@/localState";
import type { ProjectionCacheEntry } from "@/types/cases";

export function useProjection(caseId: string | null | undefined, options?: { enabled?: boolean }) {
  const [desktopState, setDesktopState] = useState<DesktopProjectionState>(() => loadDesktopProjectionState());
  const normalizedCaseId = caseId?.trim() || "";
  const queryEnabled = options?.enabled ?? true;

  const cachedMatter = useMemo(() => {
    if (!normalizedCaseId) {
      return null;
    }
    return desktopState.matters[normalizedCaseId] ?? null;
  }, [desktopState.matters, normalizedCaseId]);

  const query = useQuery<MatterProjection>({
    queryKey: ["projection", normalizedCaseId],
    enabled: queryEnabled && normalizedCaseId.length > 0,
    queryFn: ({ signal }) => getProjection(normalizedCaseId, { signal }),
    initialData: cachedMatter?.projection
  });

  useEffect(() => {
    if (!normalizedCaseId || !query.data) {
      return;
    }
    const existing = desktopState.matters[normalizedCaseId];
    if (
      existing?.projection.snapshot_id === query.data.snapshot_id &&
      existing?.projection.matter_version_token === query.data.matter_version_token
    ) {
      return;
    }
    const watermark = buildWatermark(normalizedCaseId, query.data, cachedMatter?.watermark ?? null);
    const nextState: DesktopProjectionState = {
      active_case_id: normalizedCaseId,
      matters: {
        ...desktopState.matters,
        [normalizedCaseId]: {
          case_id: normalizedCaseId,
          fetched_at: new Date().toISOString(),
          projection: query.data,
          watermark
        }
      }
    };
    setDesktopState(nextState);
    saveDesktopProjectionState(nextState);
  }, [cachedMatter?.watermark, desktopState.matters, normalizedCaseId, query.data]);

  const entry: ProjectionCacheEntry | null = useMemo(() => {
    if (!normalizedCaseId) {
      return null;
    }
    if (query.data) {
      const saved = desktopState.matters[normalizedCaseId];
      return {
        projection: query.data,
        watermark: saved?.watermark ?? buildWatermark(normalizedCaseId, query.data, null),
        viewSource: query.isFetchedAfterMount ? "remote" : "cache"
      };
    }
    if (cachedMatter) {
      return {
        projection: cachedMatter.projection,
        watermark: cachedMatter.watermark,
        viewSource: "cache"
      };
    }
    return null;
  }, [cachedMatter, desktopState.matters, normalizedCaseId, query.data, query.isFetchedAfterMount]);

  return {
    projection: entry?.projection ?? null,
    watermark: entry?.watermark ?? null,
    viewSource: entry?.viewSource ?? "none",
    recentMatters: Object.values(desktopState.matters).sort((left, right) =>
      right.fetched_at.localeCompare(left.fetched_at)
    ),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => query.refetch(),
    openCachedMatter: (targetCaseId: string) => {
      const saved = desktopState.matters[targetCaseId];
      if (!saved) {
        return null;
      }
      const nextState: DesktopProjectionState = {
        ...desktopState,
        active_case_id: targetCaseId
      };
      setDesktopState(nextState);
      saveDesktopProjectionState(nextState);
      return saved;
    }
  };
}
