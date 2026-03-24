export const RELEASE_CHANNELS = ["beta", "rc", "main"] as const;

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "beta";

export function isReleaseChannel(value: string): value is ReleaseChannel {
  return RELEASE_CHANNELS.includes(value as ReleaseChannel);
}

export function coerceReleaseChannel(value: unknown): ReleaseChannel {
  if (typeof value === "string" && isReleaseChannel(value)) {
    return value;
  }
  return DEFAULT_RELEASE_CHANNEL;
}
