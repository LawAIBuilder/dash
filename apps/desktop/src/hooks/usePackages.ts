import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvePackageRun,
  createPackageRule,
  deletePackageRule,
  listPackageRules,
  listPackageRuns,
  runPackageWorker as triggerPackageRun,
  updatePackageRunDraft,
  uploadCaseFile
} from "@/lib/api-client";

export function usePackageRules(caseId: string | undefined, packageType: string) {
  return useQuery({
    queryKey: ["package-rules", caseId, packageType],
    enabled: Boolean(caseId && packageType),
    queryFn: ({ signal }) => listPackageRules(caseId!, packageType, { signal })
  });
}

export function usePackageRuns(caseId: string | undefined, packetId: string | undefined) {
  return useQuery({
    queryKey: ["package-runs", caseId, packetId],
    enabled: Boolean(caseId && packetId),
    queryFn: ({ signal }) => listPackageRuns(caseId!, packetId!, { signal })
  });
}

export function useCreatePackageRule(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { package_type: string; rule_key: string; rule_label: string; instructions?: string }) =>
      createPackageRule(caseId, input),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ["package-rules", caseId, v.package_type] });
    }
  });
}

export function useDeletePackageRule(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => deletePackageRule(caseId, ruleId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["package-rules", caseId] });
    }
  });
}

export function useUploadToCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadCaseFile(caseId, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projection", caseId] });
      void qc.invalidateQueries({ queryKey: ["exhibits", caseId] });
      void qc.invalidateQueries({ queryKey: ["hearing-prep-snapshot", caseId] });
    }
  });
}

export function useTriggerPackageRun(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { packetId: string; wholeFileSourceItemIds?: string[] }) =>
      triggerPackageRun(caseId, input.packetId, input.wholeFileSourceItemIds),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ["package-runs", caseId, v.packetId] });
      void qc.invalidateQueries({ queryKey: ["exhibits", caseId] });
      void qc.invalidateQueries({ queryKey: ["hearing-prep-snapshot", caseId, v.packetId] });
    }
  });
}

export function useUpdatePackageRunDraft(caseId: string, packetId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; markdown: string }) => updatePackageRunDraft(caseId, input.runId, input.markdown),
    onSuccess: () => {
      if (packetId) void qc.invalidateQueries({ queryKey: ["package-runs", caseId, packetId] });
    }
  });
}

export function useApprovePackageRun(caseId: string, packetId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; note?: string }) => approvePackageRun(caseId, input.runId, input.note),
    onSuccess: () => {
      if (packetId) void qc.invalidateQueries({ queryKey: ["package-runs", caseId, packetId] });
    }
  });
}
