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
    queryFn: () => getExhibitWorkspace(normalizedCaseId)
  });
}

export function useExhibitSuggestions(packetId: string | null | undefined) {
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["exhibit-suggestions", normalizedPacketId],
    enabled: normalizedPacketId.length > 0,
    queryFn: () => getExhibitSuggestions(normalizedPacketId)
  });
}

export function useExhibitHistory(packetId: string | null | undefined) {
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["exhibit-history", normalizedPacketId],
    enabled: normalizedPacketId.length > 0,
    queryFn: () => getExhibitHistory(normalizedPacketId)
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
      normalizedPacketId
        ? Promise.all([
            queryClient.invalidateQueries({ queryKey: ["exhibit-suggestions", normalizedPacketId] }),
            queryClient.invalidateQueries({ queryKey: ["exhibit-history", normalizedPacketId] }),
            queryClient.invalidateQueries({ queryKey: ["packet-exports", normalizedPacketId] })
          ])
        : Promise.resolve()
    ]);
  };
}

export function useCreateExhibitPacket(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input?: { packet_name?: string; packet_mode?: "compact" | "full"; naming_scheme?: string }) =>
      createExhibitPacket(normalizedCaseId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useUpdateExhibitPacket(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: ({
      packetId,
      input
    }: {
      packetId: string;
      input: { packet_name?: string; packet_mode?: "compact" | "full"; naming_scheme?: string; status?: string };
    }) => updateExhibitPacket(packetId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useCreateExhibitSlot(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
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
    }) => createExhibitSlot(sectionId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useReorderExhibitSections(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: ({ packetId, sectionIds }: { packetId: string; sectionIds: string[] }) =>
      reorderExhibitSections(packetId, sectionIds),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useReorderSectionExhibits(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: ({ sectionId, exhibitIds }: { sectionId: string; exhibitIds: string[] }) =>
      reorderSectionExhibits(sectionId, exhibitIds),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useUpdateExhibitSlot(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
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
    }) => updateExhibitSlot(exhibitId, input),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useAddExhibitItem(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: ({
      exhibitId,
      sourceItemId
    }: {
      exhibitId: string;
      sourceItemId: string;
    }) => addExhibitItem(exhibitId, { source_item_id: sourceItemId }),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useRemoveExhibitItem(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: (itemId: string) => removeExhibitItem(itemId),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useUpdateExhibitItemPageRules(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: ({
      itemId,
      excludeCanonicalPageIds
    }: {
      itemId: string;
      excludeCanonicalPageIds: string[];
    }) => updateExhibitItemPageRules(itemId, excludeCanonicalPageIds),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useFinalizeExhibitPacket(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: (packetId: string) => finalizeExhibitPacket(packetId),
    onSuccess: async (result) => invalidate(result.packet?.id ?? null)
  });
}

export function useResolveExhibitSuggestion(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
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
    }) => resolveExhibitSuggestion(packetId, suggestionId, { action, note }),
    onSuccess: async (result, variables) => invalidate(result.packet?.id ?? variables.packetId)
  });
}

export function usePacketPdfExports(packetId: string | null | undefined) {
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["packet-exports", normalizedPacketId],
    enabled: normalizedPacketId.length > 0,
    queryFn: () => listPacketPdfExports(normalizedPacketId)
  });
}

export function useGeneratePacketPdf(caseId: string | null | undefined) {
  const invalidate = useExhibitInvalidation(caseId);
  return useMutation({
    mutationFn: ({ packetId, layout }: { packetId: string; layout?: PacketPdfExportLayout }) =>
      generatePacketPdf(packetId, layout),
    onSuccess: async (_result, variables) => invalidate(variables.packetId)
  });
}
