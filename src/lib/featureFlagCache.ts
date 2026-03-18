interface CachedFeatureFlag {
  enabled: boolean;
  fetchedAt: number;
}

const featureFlagCache = new Map<string, CachedFeatureFlag>();

export function getCachedFeatureFlag(key: string): CachedFeatureFlag | undefined {
  return featureFlagCache.get(key);
}

export function setCachedFeatureFlag(key: string, enabled: boolean): void {
  featureFlagCache.set(key, { enabled, fetchedAt: Date.now() });
}

export function isFeatureFlagEnabled(key: string, fallback = false): boolean {
  return featureFlagCache.get(key)?.enabled ?? fallback;
}
