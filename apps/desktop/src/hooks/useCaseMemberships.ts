import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  backfillCaseMemberships,
  listAuthUsers,
  listCaseMemberships,
  removeCaseMembership,
  setCaseMembership
} from "@/lib/api-client";
import type { CaseMembershipRole } from "@/types/cases";

export function useCaseMemberships(caseId: string | null | undefined, options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const normalizedCaseId = caseId?.trim() || "";
  const enabled = Boolean(options?.enabled) && normalizedCaseId.length > 0;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["case-memberships", normalizedCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["auth", "users"] })
    ]);
  };

  const membershipsQuery = useQuery({
    queryKey: ["case-memberships", normalizedCaseId],
    enabled,
    queryFn: ({ signal }) => listCaseMemberships(normalizedCaseId, { signal })
  });

  const usersQuery = useQuery({
    queryKey: ["auth", "users"],
    enabled,
    queryFn: ({ signal }) => listAuthUsers({ signal })
  });

  const setMembershipMutation = useMutation({
    mutationFn: (input: { userId: string; role: CaseMembershipRole }) =>
      setCaseMembership(normalizedCaseId, input.userId, input.role),
    onSuccess: invalidate
  });

  const removeMembershipMutation = useMutation({
    mutationFn: (userId: string) => removeCaseMembership(normalizedCaseId, userId),
    onSuccess: invalidate
  });

  const backfillMembershipsMutation = useMutation({
    mutationFn: () => backfillCaseMemberships(normalizedCaseId),
    onSuccess: invalidate
  });

  return {
    membershipsQuery,
    usersQuery,
    setMembershipMutation,
    removeMembershipMutation,
    backfillMembershipsMutation
  };
}
