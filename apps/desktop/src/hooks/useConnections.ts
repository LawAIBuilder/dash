import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOcrWorkerHealth,
  getPracticePantherStatus,
  listPracticePantherMatters,
  probeBoxJwt,
  startPracticePantherAuth,
  syncPracticePanther
} from "@/lib/api-client";

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
    queryFn: ({ signal }) => getOcrWorkerHealth({ signal }),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  });
}

export function usePracticePantherStatus() {
  return useQuery({
    queryKey: ["practicepanther-status"],
    queryFn: ({ signal }) => getPracticePantherStatus({ signal })
  });
}

export function usePracticePantherMatters(enabled: boolean, searchText?: string) {
  return useQuery({
    queryKey: ["practicepanther-matters", searchText?.trim() || ""],
    enabled,
    queryFn: ({ signal }) => listPracticePantherMatters(searchText, { signal })
  });
}

export function useStartPracticePantherAuth(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input?: { account_label?: string; return_to?: string | null }) => startPracticePantherAuth(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["practicepanther-status"] }),
        queryClient.invalidateQueries({ queryKey: ["case", normalizedCaseId] })
      ]);
    }
  });
}

export function useSyncPracticePanther(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input?: { pp_matter_id?: string | null }) => syncPracticePanther(normalizedCaseId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["practicepanther-status"] }),
        queryClient.invalidateQueries({ queryKey: ["practicepanther-matters"] }),
        queryClient.invalidateQueries({ queryKey: ["cases"] }),
        queryClient.invalidateQueries({ queryKey: ["case", normalizedCaseId] }),
        queryClient.invalidateQueries({ queryKey: ["projection", normalizedCaseId] }),
        queryClient.invalidateQueries({ queryKey: ["review-queue", normalizedCaseId] })
      ]);
    }
  });
}
