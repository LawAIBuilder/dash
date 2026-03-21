import { useQuery } from "@tanstack/react-query";
import { getCaseActivity } from "@/lib/api-client";

export function useCaseActivity(caseId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  return useQuery({
    queryKey: ["case-activity", normalizedCaseId],
    enabled: normalizedCaseId.length > 0,
    queryFn: ({ signal }) => getCaseActivity(normalizedCaseId, { signal })
  });
}
