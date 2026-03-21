import { useQuery } from "@tanstack/react-query";
import { getHearingPrepSnapshot } from "@/lib/api-client";

export function useHearingPrepSnapshot(caseId: string | null | undefined, packetId: string | null | undefined) {
  const normalizedCaseId = caseId?.trim() || "";
  const normalizedPacketId = packetId?.trim() || "";
  return useQuery({
    queryKey: ["hearing-prep-snapshot", normalizedCaseId, normalizedPacketId],
    enabled: normalizedCaseId.length > 0,
    queryFn: ({ signal }) => getHearingPrepSnapshot(normalizedCaseId, normalizedPacketId || null, { signal })
  });
}
