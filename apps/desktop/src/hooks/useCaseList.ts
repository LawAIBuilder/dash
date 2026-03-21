import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCase, listCases } from "@/lib/api-client";
import type { CreateCaseInput } from "@/types/cases";

export function useCaseList() {
  return useQuery({
    queryKey: ["cases"],
    queryFn: listCases
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCaseInput) => createCase(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cases"] });
    }
  });
}
