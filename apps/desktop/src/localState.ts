import type { MatterProjection, ProjectionWatermark } from "@wc/domain-core";

const DESKTOP_PROJECTION_STATE_KEY = "desktop_projection_state_v1";

export interface StoredMatterProjection {
  case_id: string;
  fetched_at: string;
  projection: MatterProjection;
  watermark: ProjectionWatermark;
}

export interface DesktopProjectionState {
  active_case_id: string;
  matters: Record<string, StoredMatterProjection>;
}

const EMPTY_STATE: DesktopProjectionState = {
  active_case_id: "",
  matters: {}
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredMatterProjection(value: unknown): value is StoredMatterProjection {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.case_id !== "string" || typeof value.fetched_at !== "string") {
    return false;
  }
  if (!isRecord(value.projection) || typeof value.projection.snapshot_id !== "string" || !isRecord(value.projection.slices)) {
    return false;
  }
  if (
    !isRecord(value.watermark) ||
    typeof value.watermark.case_id !== "string" ||
    typeof value.watermark.authoritative_snapshot_id !== "string"
  ) {
    return false;
  }
  return true;
}

export function loadDesktopProjectionState(): DesktopProjectionState {
  if (typeof window === "undefined") {
    return EMPTY_STATE;
  }

  try {
    const raw = window.localStorage.getItem(DESKTOP_PROJECTION_STATE_KEY);
    if (!raw) {
      return EMPTY_STATE;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return EMPTY_STATE;
    }

    const matters: Record<string, StoredMatterProjection> = {};
    if (isRecord(parsed.matters)) {
      for (const [key, value] of Object.entries(parsed.matters)) {
        if (isStoredMatterProjection(value)) {
          matters[key] = value;
        }
      }
    }

    return {
      active_case_id: typeof parsed.active_case_id === "string" ? parsed.active_case_id : "",
      matters
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function saveDesktopProjectionState(state: DesktopProjectionState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DESKTOP_PROJECTION_STATE_KEY, JSON.stringify(state));
}
