import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthSession, loginWithPassword, logoutSession } from "@/lib/api-client";

export function useAuthSession() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: ({ signal }) => getAuthSession({ signal }),
    staleTime: 10_000
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => loginWithPassword(input.email, input.password),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    }
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logoutSession(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
    }
  });
}
