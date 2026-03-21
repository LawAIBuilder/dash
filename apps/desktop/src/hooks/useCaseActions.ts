import { useMutation, useQueryClient } from "@tanstack/react-query";
import { normalizeDocuments, queueOcr, runHeuristicExtractions, syncBox } from "@/lib/api-client";

export function useCaseActions(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cases"] }),
      queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["review-queue", normalizedCaseId] })
    ]);
  };

  const syncMutation = useMutation({
    mutationFn: () => syncBox(normalizedCaseId),
    onSuccess: invalidate
  });

  const normalizeMutation = useMutation({
    mutationFn: () => normalizeDocuments(normalizedCaseId),
    onSuccess: invalidate
  });

  const queueOcrMutation = useMutation({
    mutationFn: () => queueOcr(normalizedCaseId),
    onSuccess: invalidate
  });

  const heuristicMutation = useMutation({
    mutationFn: () => runHeuristicExtractions(normalizedCaseId),
    onSuccess: invalidate
  });

  return {
    syncMutation,
    normalizeMutation,
    queueOcrMutation,
    heuristicMutation
  };
}
