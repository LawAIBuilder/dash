import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentTemplate,
  deleteDocumentTemplate,
  deleteDocumentTemplateFill,
  listDocumentTemplateFills,
  listDocumentTemplates,
  renderDocumentTemplate,
  updateDocumentTemplate
} from "@/lib/api-client";

export function useDocumentTemplates(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["document-templates", normalizedCaseId],
    enabled: normalizedCaseId.length > 0,
    queryFn: () => listDocumentTemplates(normalizedCaseId)
  });
}

export function useDocumentTemplateFills(caseId: string | null | undefined, templateId?: string | null) {
  const normalizedCaseId = caseId?.trim() || "";
  const normalizedTemplateId = templateId?.trim() || "";
  return useQuery({
    queryKey: ["document-template-fills", normalizedCaseId, normalizedTemplateId || "all"],
    enabled: normalizedCaseId.length > 0,
    queryFn: () => listDocumentTemplateFills(normalizedCaseId, normalizedTemplateId || undefined)
  });
}

function useInvalidateDocumentTemplates(caseId: string | null | undefined) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document-templates", normalizedCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["document-template-fills", normalizedCaseId] })
    ]);
  };
}

export function useCreateDocumentTemplate(caseId: string | null | undefined) {
  const invalidate = useInvalidateDocumentTemplates(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (input: Parameters<typeof createDocumentTemplate>[1]) => createDocumentTemplate(normalizedCaseId, input),
    onSuccess: () => invalidate()
  });
}

export function useUpdateDocumentTemplate(caseId: string | null | undefined) {
  const invalidate = useInvalidateDocumentTemplates(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      templateId,
      input
    }: {
      templateId: string;
      input: Parameters<typeof updateDocumentTemplate>[2];
    }) => updateDocumentTemplate(normalizedCaseId, templateId, input),
    onSuccess: () => invalidate()
  });
}

export function useDeleteDocumentTemplate(caseId: string | null | undefined) {
  const invalidate = useInvalidateDocumentTemplates(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (templateId: string) => deleteDocumentTemplate(normalizedCaseId, templateId),
    onSuccess: () => invalidate()
  });
}

export function useRenderDocumentTemplate(caseId: string | null | undefined) {
  const invalidate = useInvalidateDocumentTemplates(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: ({
      templateId,
      input
    }: {
      templateId: string;
      input: Parameters<typeof renderDocumentTemplate>[2];
    }) => renderDocumentTemplate(normalizedCaseId, templateId, input),
    onSuccess: () => invalidate()
  });
}

export function useDeleteDocumentTemplateFill(caseId: string | null | undefined) {
  const invalidate = useInvalidateDocumentTemplates(caseId);
  const normalizedCaseId = caseId?.trim() || "";
  return useMutation({
    mutationFn: (fillId: string) => deleteDocumentTemplateFill(normalizedCaseId, fillId),
    onSuccess: () => invalidate()
  });
}
