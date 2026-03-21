import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOcrWorkerHealth, probeBoxJwt } from "@/lib/api-client";

export function useProbeBoxJwt(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: probeBoxJwt,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cases"] }),
        queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] })
      ]);
    }
  });
}

export function useOcrWorkerHealth() {
  return useQuery({
    queryKey: ["ocr-worker-health"],
    queryFn: getOcrWorkerHealth,
    refetchInterval: 15_000
  });
}
