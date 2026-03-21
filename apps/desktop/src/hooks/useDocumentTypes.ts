import { useQuery } from "@tanstack/react-query";
import { listDocumentTypes } from "@/lib/api-client";

export function useDocumentTypes() {
  return useQuery({
    queryKey: ["document-types"],
    queryFn: listDocumentTypes,
    staleTime: 5 * 60_000
  });
}
