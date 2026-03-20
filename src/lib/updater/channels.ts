export const RELEASE_CHANNELS = ["main", "rc", "beta"] as const;

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "main";

export function isReleaseChannel(value: string): value is ReleaseChannel {
  return RELEASE_CHANNELS.includes(value as ReleaseChannel);
}

export function coerceReleaseChannel(value: unknown): ReleaseChannel {
  if (typeof value === "string" && isReleaseChannel(value)) {
    return value;
  }
  return DEFAULT_RELEASE_CHANNEL;
}
