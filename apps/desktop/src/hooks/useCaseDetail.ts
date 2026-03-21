import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCase, updateCase } from "@/lib/api-client";
import type { CreateCaseInput } from "@/types/cases";

export function useCaseDetail(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["case", normalizedCaseId],
    enabled: normalizedCaseId.length > 0,
    queryFn: ({ signal }) => getCase(normalizedCaseId, { signal })
  });
}

export function useUpdateCase(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input: Partial<CreateCaseInput>) => updateCase(normalizedCaseId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["case", normalizedCaseId] }),
        queryClient.invalidateQueries({ queryKey: ["cases"] }),
        queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] })
      ]);
    }
  });
}
