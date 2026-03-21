import { useQuery } from "@tanstack/react-query";
import { getCasePeople, getCaseTimeline } from "@/lib/api-client";

/** People & timeline backed by dedicated case routes */
export function usePeopleTimeline(caseId: string | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  const query = useQuery({
    queryKey: ["people-timeline", normalizedCaseId],
    enabled: normalizedCaseId.length > 0,
    queryFn: async ({ signal }) => {
      const [people, timeline] = await Promise.all([
        getCasePeople(normalizedCaseId, { signal }),
        getCaseTimeline(normalizedCaseId, { signal })
      ]);
      return { people, timeline };
    }
  });

  return {
    people: query.data?.people ?? [],
    timeline: query.data?.timeline ?? [],
    refresh: () => query.refetch(),
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null
  };
}
