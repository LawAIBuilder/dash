import { useProjection } from "@/hooks/useProjection";

/** People & timeline from projection slices (refresh via projection) */
export function usePeopleTimeline(caseId: string | undefined) {
  const { projection, refresh, isFetching } = useProjection(caseId);

  const people = projection?.slices.case_people_slice?.people ?? [];
  const timeline = projection?.slices.case_timeline_slice?.entries ?? [];

  return {
    people,
    timeline,
    refresh,
    isFetching,
    isLoading: !projection && Boolean(caseId)
  };
}
