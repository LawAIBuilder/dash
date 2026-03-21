import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getReviewQueue, overrideClassification, resolveOcrReview } from "@/lib/api-client";

export function useReviewQueue(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["review-queue", normalizedCaseId],
    enabled: normalizedCaseId.length > 0,
    queryFn: ({ signal }) => getReviewQueue(normalizedCaseId, { signal })
  });
}

export function useResolveOcrReview(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({ pageId, acceptEmpty }: { pageId: string; acceptEmpty?: boolean }) =>
      resolveOcrReview(normalizedCaseId, pageId, acceptEmpty),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review-queue", normalizedCaseId] }),
        queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] })
      ]);
    }
  });
}

export function useOverrideClassification(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({ sourceItemId, documentTypeId }: { sourceItemId: string; documentTypeId: string | null }) =>
      overrideClassification(normalizedCaseId, sourceItemId, documentTypeId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review-queue", normalizedCaseId] }),
        queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] })
      ]);
    }
  });
}
