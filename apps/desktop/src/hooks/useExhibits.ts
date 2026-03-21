import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addExhibitItem,
  createExhibitPacket,
  createExhibitSlot,
  finalizeExhibitPacket,
  generatePacketPdf,
  getExhibitHistory,
  getExhibitSuggestions,
  getExhibitWorkspace,
  listPacketPdfExports,
  removeExhibitItem,
  reorderExhibitSections,
  reorderSectionExhibits,
  resolveExhibitSuggestion,
  updateExhibitItemPageRules,
  updateExhibitPacket,
  updateExhibitSlot
} from "@/lib/api-client";
import type { PacketPdfExportLayout } from "@/types/exhibits";

export function useExhibitWorkspace(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["exhibits", normalizedCaseId],
    enabled: normalizedCaseId.length > 0,
    queryFn: ({ signal }) => getExhibitWorkspace(normalizedCaseId, { signal })
  });
}

export function useExhibitSuggestions(caseId: string | null | undefined, packetId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["exhibit-suggestions", normalizedCaseId, normalizedPacketId],
    enabled: normalizedCaseId.length > 0 && normalizedPacketId.length > 0,
    queryFn: ({ signal }) => getExhibitSuggestions(normalizedCaseId, normalizedPacketId, { signal })
  });
}

export function useExhibitHistory(caseId: string | null | undefined, packetId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["exhibit-history", normalizedCaseId, normalizedPacketId],
    enabled: normalizedCaseId.length > 0 && normalizedPacketId.length > 0,
    queryFn: ({ signal }) => getExhibitHistory(normalizedCaseId, normalizedPacketId, { signal })
  });
}

function useExhibitInvalidation(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return async (packetId?: string | null) => {
    const normalizedPacketId = packetId?.trim() || "";
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["exhibits", normalizedCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["hearing-prep-snapshot", normalizedCaseId] }),
      normalizedPacketId
        ? Promise.all([
            queryClient.invalidateQueries({ queryKey: ["exhibit-suggestions", normalizedCaseId, normalizedPacketId] }),
            queryClient.invalidateQueries({ queryKey: ["exhibit-history", normalizedCaseId, normalizedPacketId] }),
            queryClient.invalidateQueries({ queryKey: ["packet-exports", normalizedCaseId, normalizedPacketId] })
          ])
        : Promise.resolve()
    ]);
  };
}

export function useCreateExhibitPacket(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input?: {
      packet_name?: string;
      packet_mode?: "compact" | "full";
      naming_scheme?: string;
      package_type?: string;
      package_label?: string;
      target_document_source_item_id?: string;
      starter_slot_count?: number;
    }) => createExhibitPacket(normalizedCaseId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useUpdateExhibitPacket(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      packetId,
      input
    }: {
      packetId: string;
      input: {
        packet_name?: string;
        packet_mode?: "compact" | "full";
        naming_scheme?: string;
        status?: string;
        package_type?: string;
        package_label?: string | null;
        target_document_source_item_id?: string | null;
        run_status?: string | null;
      };
    }) => updateExhibitPacket(normalizedCaseId, packetId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useCreateExhibitSlot(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      sectionId,
      input
    }: {
      sectionId: string;
      input?: {
        exhibit_label?: string | null;
        title?: string | null;
        purpose?: string | null;
        objection_risk?: string | null;
        notes?: string | null;
      };
    }) => createExhibitSlot(normalizedCaseId, sectionId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useReorderExhibitSections(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({ packetId, sectionIds }: { packetId: string; sectionIds: string[] }) =>
      reorderExhibitSections(normalizedCaseId, packetId, sectionIds),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useReorderSectionExhibits(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({ sectionId, exhibitIds }: { sectionId: string; exhibitIds: string[] }) =>
      reorderSectionExhibits(normalizedCaseId, sectionId, exhibitIds),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useUpdateExhibitSlot(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      exhibitId,
      input
    }: {
      exhibitId: string;
      input: {
        exhibit_label?: string | null;
        title?: string | null;
        status?: string | null;
        purpose?: string | null;
        objection_risk?: string | null;
        notes?: string | null;
      };
    }) => updateExhibitSlot(normalizedCaseId, exhibitId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useAddExhibitItem(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      exhibitId,
      sourceItemId
    }: {
      exhibitId: string;
      sourceItemId: string;
    }) => addExhibitItem(normalizedCaseId, exhibitId, { source_item_id: sourceItemId }),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useRemoveExhibitItem(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (itemId: string) => removeExhibitItem(normalizedCaseId, itemId),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useUpdateExhibitItemPageRules(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      itemId,
      excludeCanonicalPageIds
    }: {
      itemId: string;
      excludeCanonicalPageIds: string[];
    }) => updateExhibitItemPageRules(normalizedCaseId, itemId, excludeCanonicalPageIds),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useFinalizeExhibitPacket(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (packetId: string) => finalizeExhibitPacket(normalizedCaseId, packetId),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useResolveExhibitSuggestion(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      packetId,
      suggestionId,
      action,
      note
    }: {
      packetId: string;
      suggestionId: string;
      action: "accept" | "dismiss";
      note?: string | null;
    }) => resolveExhibitSuggestion(normalizedCaseId, packetId, suggestionId, { action, note }),
    onSuccess: async (result, variables) => invalidate(result.packet?.id ?? variables.packetId)
  });
}

export function usePacketPdfExports(caseId: string | null | undefined, packetId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["packet-exports", normalizedCaseId, normalizedPacketId],
    enabled: normalizedCaseId.length > 0 && normalizedPacketId.length > 0,
    queryFn: ({ signal }) => listPacketPdfExports(normalizedCaseId, normalizedPacketId, { signal })
  });
}

export function useGeneratePacketPdf(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({ packetId, layout }: { packetId: string; layout?: PacketPdfExportLayout }) =>
      generatePacketPdf(normalizedCaseId, packetId, layout),
    onSuccess: async (_result, variables) => invalidate(variables.packetId)
  });
}
