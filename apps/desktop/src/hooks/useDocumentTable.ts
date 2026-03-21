import { useMemo, useState } from "react";
import type {
  MatterProjection,
  ProjectionCanonicalDocument,
  ProjectionCanonicalPage,
  ProjectionSourceItem
} from "@wc/domain-core";

export type DocumentTableRow = {
  id: string;
  canonicalDocumentId: string;
  title: string;
  documentType: string | null;
  category: string | null;
  ocrStatus: string | null;
  pageCount: number;
  updatedAt: string | null;
  sourceItemId: string | null;
  sourceKind: string | null;
  classificationMethod: string | null;
  reviewRequired: boolean;
  previewSupported: boolean;
};

type SortKey = "title" | "documentType" | "category" | "ocrStatus" | "pageCount" | "updatedAt";

function normalizeValue(value: string | null | undefined) {
  return value?.toLowerCase().trim() ?? "";
}

function isPdfLikeTitle(title: string | null | undefined) {
  return /\.pdf$/i.test(title ?? "");
}

export function useDocumentTable(projection: MatterProjection | null) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [ocrFilter, setOcrFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const rows = useMemo<DocumentTableRow[]>(() => {
    if (!projection?.slices) {
      return [];
    }

    const sourceItems = projection.slices.document_inventory_slice?.source_items ?? [];
    const sourceItemsByCanonicalId = new Map<string, ProjectionSourceItem>();
    for (const item of sourceItems) {
      if (item.canonical_document_id) {
        sourceItemsByCanonicalId.set(item.canonical_document_id, item);
      }
    }

    const pagesByDoc = new Map<string, ProjectionCanonicalPage[]>();
    const pages = projection.slices.canonical_spine_slice?.pages ?? projection.slices.canonical_page_slice?.pages ?? [];
    for (const page of pages) {
      const docId = page.canonical_document_id ?? page.document_id;
      if (!docId) {
        continue;
      }
      const current = pagesByDoc.get(docId) ?? [];
      current.push(page);
      pagesByDoc.set(docId, current);
    }

    const docs = projection.slices.canonical_spine_slice?.documents ?? projection.slices.canonical_document_slice?.documents ?? [];
    return docs.map((document: ProjectionCanonicalDocument) => {
      const sourceItem =
        (document.source_item_id ? sourceItems.find((item) => item.id === document.source_item_id) : null) ??
        sourceItemsByCanonicalId.get(document.id) ??
        null;
      const documentPages = pagesByDoc.get(document.id) ?? [];
      return {
        id: document.id,
        canonicalDocumentId: document.id,
        title: document.title ?? sourceItem?.title ?? "Untitled document",
        documentType: document.document_type_name ?? sourceItem?.document_type_name ?? null,
        category: sourceItem?.document_category ?? null,
        ocrStatus: document.ocr_status ?? null,
        pageCount: document.page_count ?? documentPages.length,
        updatedAt: document.updated_at ?? sourceItem?.updated_at ?? null,
        sourceItemId: sourceItem?.id ?? document.source_item_id ?? null,
        sourceKind: sourceItem?.source_kind ?? document.source_kind ?? null,
        classificationMethod: sourceItem?.classification_method ?? null,
        reviewRequired: documentPages.some((page) => page.review_status && page.review_status !== "resolved"),
        previewSupported: isPdfLikeTitle(sourceItem?.title ?? document.title ?? null)
      };
    });
  }, [projection]);

  const filteredRows = useMemo(() => {
    const needle = normalizeValue(search);
    const next = rows.filter((row) => {
      if (needle) {
        const haystacks = [
          row.title,
          row.documentType,
          row.category,
          row.ocrStatus,
          row.sourceKind
        ].map(normalizeValue);
        if (!haystacks.some((value) => value.includes(needle))) {
          return false;
        }
      }
      if (categoryFilter !== "all" && normalizeValue(row.category) !== normalizeValue(categoryFilter)) {
        return false;
      }
      if (ocrFilter !== "all" && normalizeValue(row.ocrStatus) !== normalizeValue(ocrFilter)) {
        return false;
      }
      return true;
    });

    next.sort((left, right) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortKey) {
        case "pageCount":
          return (left.pageCount - right.pageCount) * dir;
        case "updatedAt":
          return (normalizeValue(left.updatedAt).localeCompare(normalizeValue(right.updatedAt)) || normalizeValue(left.title).localeCompare(normalizeValue(right.title))) * dir;
        default:
          return normalizeValue(String(left[sortKey] ?? "")).localeCompare(normalizeValue(String(right[sortKey] ?? ""))) * dir;
      }
    });
    return next;
  }, [categoryFilter, ocrFilter, rows, search, sortDirection, sortKey]);

  const categories = useMemo(
    () => Array.from(new Set(rows.map((row) => row.category).filter((value): value is string => Boolean(value)))).sort(),
    [rows]
  );

  const ocrStatuses = useMemo(
    () => Array.from(new Set(rows.map((row) => row.ocrStatus).filter((value): value is string => Boolean(value)))).sort(),
    [rows]
  );

  return {
    rows: filteredRows,
    rawRows: rows,
    categories,
    ocrStatuses,
    search,
    setSearch,
    categoryFilter,
    setCategoryFilter,
    ocrFilter,
    setOcrFilter,
    sortKey,
    sortDirection,
    setSort: (nextKey: SortKey) => {
      if (nextKey === sortKey) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(nextKey);
        setSortDirection(nextKey === "title" || nextKey === "documentType" ? "asc" : "desc");
      }
    }
  };
}
