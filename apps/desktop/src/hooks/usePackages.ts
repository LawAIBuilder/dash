import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
    queryFn: () => listPackageRules(caseId!, packageType)
  });
}

export function usePackageRuns(packetId: string | undefined) {
  return useQuery({
    queryKey: ["package-runs", packetId],
    enabled: Boolean(packetId),
    queryFn: () => listPackageRuns(packetId!)
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
    mutationFn: (ruleId: string) => deletePackageRule(ruleId),
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
    }
  });
}

export function useTriggerPackageRun(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { packetId: string; wholeFileSourceItemIds?: string[] }) =>
      triggerPackageRun(caseId, input.packetId, input.wholeFileSourceItemIds),
    onSuccess: (_, v) => {
      void qc.invalidateQueries({ queryKey: ["package-runs", v.packetId] });
      void qc.invalidateQueries({ queryKey: ["exhibits", caseId] });
    }
  });
}

export function useUpdatePackageRunDraft(packetId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; markdown: string }) => updatePackageRunDraft(input.runId, input.markdown),
    onSuccess: () => {
      if (packetId) void qc.invalidateQueries({ queryKey: ["package-runs", packetId] });
    }
  });
}
