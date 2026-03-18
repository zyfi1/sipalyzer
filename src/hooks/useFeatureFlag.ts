import { useQuery } from "@tanstack/react-query";
import { getFeatureFlag } from "@/api/admin";
import { getCachedFeatureFlag, setCachedFeatureFlag } from "@/lib/featureFlagCache";

const CACHE_TTL_MS = 30_000;

export function useFeatureFlag(key: string): { enabled: boolean; loading: boolean } {
  const cached = getCachedFeatureFlag(key);
  const isCacheFresh = cached ? Date.now() - cached.fetchedAt <= CACHE_TTL_MS : false;
  const query = useQuery<boolean>({
    queryKey: ["feature-flag", key],
    queryFn: async () => {
      const value = await getFeatureFlag(key);
      setCachedFeatureFlag(key, value);
      return value;
    },
    initialData: cached?.enabled,
    staleTime: CACHE_TTL_MS,
    refetchInterval: CACHE_TTL_MS,
    enabled: Boolean(key),
  });

  return {
    enabled: query.data ?? false,
    loading: !isCacheFresh && query.isLoading,
  };
}
