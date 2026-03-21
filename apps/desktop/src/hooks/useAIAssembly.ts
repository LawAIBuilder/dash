import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAIEventConfig,
  getAIStatus,
  listAIEventConfigs,
  listAIJobs,
  runAIAssembly,
  upsertAIEventConfig
} from "@/lib/api-client";

export function useAIStatus() {
  return useQuery({
    queryKey: ["ai-status"],
    queryFn: ({ signal }) => getAIStatus({ signal })
  });
}

export function useAIEventConfigs(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["ai-event-configs", normalizedCaseId],
    queryFn: ({ signal }) => listAIEventConfigs(normalizedCaseId, { signal }),
    enabled: normalizedCaseId.length > 0
  });
}

export function useAIJobs(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["ai-jobs", normalizedCaseId],
    queryFn: ({ signal }) => listAIJobs(normalizedCaseId, { signal }),
    enabled: normalizedCaseId.length > 0
  });
}

export function useUpsertAIEventConfig(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input: { event_type: string; event_label: string; instructions: string }) =>
      upsertAIEventConfig(normalizedCaseId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ai-event-configs", normalizedCaseId] });
    }
  });
}

export function useDeleteAIEventConfig(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (configId: string) => deleteAIEventConfig(normalizedCaseId, configId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ai-event-configs", normalizedCaseId] });
    }
  });
}

export function useRunAIAssembly(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (eventType: string) => runAIAssembly(normalizedCaseId, eventType),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ai-jobs", normalizedCaseId] });
    }
  });
}
