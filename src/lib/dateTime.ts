/**
 * App-wide date/time formatting using the timezone from Settings → General.
 * All timestamps (including UTC) are displayed in the selected timezone.
 */

import { useSettingsStore } from "@/stores/settingsStore";

/** Options for the timezone dropdown in Settings → General. value "" = system local. */
export const APP_TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Local (system)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Toronto", label: "America/Toronto" },
  { value: "America/Vancouver", label: "America/Vancouver" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Europe/Warsaw", label: "Europe/Warsaw" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland" },
];

/** Resolved IANA timezone: from settings or system local when setting is "". */
export function getAppTimezone(): string {
  const tz = useSettingsStore.getState().timezone;
  if (tz) return tz;
  return typeof Intl !== "undefined" && Intl.DateTimeFormat
    ? new Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";
}

/** Whether to show times in 12-hour (AM/PM) format. From Settings → General. */
export function getAppHour12(): boolean {
  return (useSettingsStore.getState().timeFormat ?? "24h") === "12h";
}

export interface FormatDateTimeOptions {
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
  timeZone?: string;
  hour12?: boolean;
}

/**
 * Format an ISO timestamp in the app timezone.
 * Use for "date + time" display (e.g. "Jan 15, 2025, 2:30:00 PM").
 */
export function formatDateTime(
  iso: string | undefined | null,
  options: FormatDateTimeOptions = {}
): string {
  if (iso == null || iso === "") return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const tz = options.timeZone ?? getAppTimezone();
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: options.dateStyle ?? "short",
      timeStyle: options.timeStyle ?? "medium",
      hour12: options.hour12 ?? getAppHour12(),
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * Time only (e.g. "14:30:00" or "2:30:00 PM") in app timezone.
 */
export function formatTime(
  iso: string | undefined | null,
  options: { timeZone?: string; hour12?: boolean } = {}
): string {
  if (iso == null || iso === "") return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const tz = options.timeZone ?? getAppTimezone();
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: options.hour12 ?? getAppHour12(),
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * Date only in app timezone (e.g. "1/15/2025").
 */
export function formatDate(
  iso: string | undefined | null,
  options: { timeZone?: string } = {}
): string {
  if (iso == null || iso === "") return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const tz = options.timeZone ?? getAppTimezone();
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: "short",
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * Compact timestamp for packet lists: time with milliseconds (e.g. "14:30:05.123") in app timezone.
 * Millisecond is the same in all timezones for a given instant.
 */
export function formatTimestampCompact(iso: string | undefined | null): string {
  if (iso == null || iso === "") return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const tz = getAppTimezone();
    const timeStr = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: getAppHour12(),
    }).format(date);
    const ms = date.getUTCMilliseconds().toString().padStart(3, "0");
    return `${timeStr}.${ms}`;
  } catch {
    return iso ?? "—";
  }
}

/**
 * Format a timestamp as relative time (e.g. "2m ago", "3h ago", "yesterday").
 */
export function formatRelativeTime(iso: string | undefined | null): string {
  if (iso == null || iso === "") return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return "yesterday";
    if (diffDay < 7) return `${diffDay}d ago`;
    
    // Fall back to short date for older
    return formatDate(iso);
  } catch {
    return iso ?? "—";
  }
}
