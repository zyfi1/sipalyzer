/**
 * HomeView — customizable "new tab" landing page with a fixed weather/time hero
 * and a drag-and-drop grid of toggleable sections below.
 */

import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef, useId } from "react";
import SunCalc from "suncalc";
import { motion } from "framer-motion";
import { useSettingsStore } from "@/stores/settingsStore";
import type { DateFormatSetting, TemperatureUnit } from "@/stores/settingsStore";
import { useHomeStore, DEFAULT_HERO, type HomePreset } from "@/stores/homeStore";
import { useToolStore } from "@/stores/toolStore";
import { HOME_TOOL_ID } from "@/lib/toolRegistry";
import {
  Activity,
  Wind,
  Loader2,
  Drop,
  Thermometer,
  Upload,
  StickyNote,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { fetchUrl } from "@/api/provision";
import { importPcap, importPcapFromBase64, importPcapFromPath } from "@/api/packetCapture";
import { useNotifications } from "@/hooks/useNotifications";
import { navigateTo } from "@/lib/navigation";
import { useNoteStore } from "@/stores/noteStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ViewFooter, ViewFooterItem, ViewFooterSpacer } from "@/components/layout/ViewFooter";

const WeatherEffects = lazy(() =>
  import("./WeatherEffects").then((m) => ({ default: m.WeatherEffects }))
);
const ActivityMonitorSection = lazy(() =>
  import("./sections/ActivityMonitorSection").then((m) => ({ default: m.ActivityMonitorSection }))
);
const HomeQuickActionsPanel = lazy(() =>
  import("./sections/HomeQuickActionsPanel").then((m) => ({ default: m.HomeQuickActionsPanel }))
);

const MOON_EASTER_EGG_AUDIO_URL =
  "/audio/moon-small-step.m4a";
const MOON_EASTER_EGG_STOP_MS = 6200;
const CAPTURE_FILE_RE = /\.(pcap|pcapng|cap)$/i;
const HOME_QUICK_NOTE_TITLE = "Home Quick Note";
const HOME_QUICK_NOTE_PROTECTED_TAG = "home-quick-note-protected";
const HOME_QUICK_NOTE_CATEGORY = "Home";


function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

// ── Weather types & helpers ──────────────────────────────────────

interface ForecastDay {
  date: string;
  maxTemp: number;
  minTemp: number;
  weatherCode: number;
  weatherDesc: string;
  chanceOfRain: number;
  windMax?: number;
  humidityMean?: number;
}

interface AstronomyData {
  sunrise: string;
  sunset: string;
}

interface WeatherData {
  temp: number;
  weatherDesc: string;
  weatherCode: number;
  humidity: number;
  windSpeed: number;
  windGust: number;
  windDirection: number;
  feelsLike: number;
  pressureMsl: number;
  surfacePressure: number;
  cloudCover: number;
  precipitation: number;
  visibility: number;
  location: string;
  lat: number;
  lon: number;
  forecast: ForecastDay[];
  astronomy: AstronomyData | null;
  isDay: boolean;
  timezone: string | null;
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  56: "Light freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Light freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Heavy showers",
  85: "Light snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm",
};

async function fetchWeather(
  lat: number | null,
  lon: number | null,
  locationName: string,
  unit: TemperatureUnit,
): Promise<WeatherData | null> {
  try {
    let useLat = lat;
    let useLon = lon;
    let resolvedName = locationName.trim();

    if (useLat == null || useLon == null) {
      if (resolvedName) {
        const geoRaw = await fetchUrl(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(resolvedName)}&count=1`,
        );
        const geoData = JSON.parse(geoRaw);
        const result = geoData.results?.[0];
        if (!result) return null;
        useLat = result.latitude;
        useLon = result.longitude;
        resolvedName = result.name ?? resolvedName;
      } else {
        const ipRaw = await fetchUrl("https://ipapi.co/json/");
        const ipData = JSON.parse(ipRaw);
        if (ipData.latitude && ipData.longitude) {
          useLat = ipData.latitude;
          useLon = ipData.longitude;
          resolvedName = [ipData.city, ipData.region].filter(Boolean).join(", ") || "Your Location";
        } else {
          return null;
        }
      }
    }

    const tempUnit = unit === "fahrenheit" ? "fahrenheit" : "celsius";
    const windUnit = unit === "fahrenheit" ? "mph" : "kmh";
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,surface_pressure,cloud_cover,precipitation,visibility,is_day` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,wind_speed_10m_max,relative_humidity_2m_mean,sunrise,sunset` +
      `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto&forecast_days=8`;

    const raw = await fetchUrl(url);
    const data = JSON.parse(raw);
    const current = data.current;
    const daily = data.daily;
    if (!current) return null;

    const forecast: ForecastDay[] = (daily?.time ?? []).map((_: string, i: number) => ({
      date: daily.time[i],
      maxTemp: daily.temperature_2m_max[i],
      minTemp: daily.temperature_2m_min[i],
      weatherCode: daily.weather_code[i],
      weatherDesc: WMO_DESCRIPTIONS[daily.weather_code[i] as number] ?? "Unknown",
      chanceOfRain: daily.precipitation_probability_max?.[i] ?? 0,
      windMax: daily.wind_speed_10m_max?.[i],
      humidityMean: daily.relative_humidity_2m_mean?.[i],
    }));

    let astronomy: AstronomyData | null = null;
    if (daily?.sunrise?.[0] && daily?.sunset?.[0]) {
      astronomy = {
        sunrise: daily.sunrise[0],
        sunset: daily.sunset[0],
      };
    }

    return {
      temp: current.temperature_2m,
      weatherDesc: WMO_DESCRIPTIONS[current.weather_code as number] ?? "Unknown",
      weatherCode: current.weather_code,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      windGust: current.wind_gusts_10m ?? current.wind_speed_10m,
      windDirection: current.wind_direction_10m ?? 0,
      feelsLike: current.apparent_temperature,
      pressureMsl: current.pressure_msl ?? 0,
      surfacePressure: current.surface_pressure ?? 0,
      cloudCover: current.cloud_cover ?? 0,
      precipitation: current.precipitation ?? 0,
      visibility: current.visibility ?? 0,
      location: resolvedName || "Unknown",
      lat: useLat!,
      lon: useLon!,
      forecast,
      astronomy,
      isDay: current.is_day === 1,
      timezone: data.timezone ?? null,
    };
  } catch {
    return null;
  }
}

// ── Astronomical moon phase ──────────────────────────────────────

const SYNODIC_MONTH = 29.53058770576;

interface MoonInfo {
  phase: string;
  illumination: number;
  age: number;
  phaseValue: number;
}

function computeMoonPhase(date: Date): MoonInfo {
  // Use SunCalc's astronomical model for accurate live illumination/phase.
  const illum = SunCalc.getMoonIllumination(date);
  const phase = ((illum.phase % 1) + 1) % 1; // 0=new, 0.5=full, ~1=new
  const age = phase * SYNODIC_MONTH;
  const illumination = Math.round(illum.fraction * 100);

  // Calendar-style phase naming: split lunation into 8 equal octants.
  // This aligns better with standard lunar calendars.
  let phaseName: string;
  if (phase < 0.0625 || phase >= 0.9375) phaseName = "New Moon";
  else if (phase < 0.1875) phaseName = "Waxing Crescent";
  else if (phase < 0.3125) phaseName = "First Quarter";
  else if (phase < 0.4375) phaseName = "Waxing Gibbous";
  else if (phase < 0.5625) phaseName = "Full Moon";
  else if (phase < 0.6875) phaseName = "Waning Gibbous";
  else if (phase < 0.8125) phaseName = "Last Quarter";
  else phaseName = "Waning Crescent";

  return { phase: phaseName, illumination, age, phaseValue: phase };
}

// ── Clock & date formatting ──────────────────────────────────────

function useCurrentTime(enabled: boolean, showSeconds: boolean) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), showSeconds ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [enabled, showSeconds]);
  return now;
}

function formatTime(date: Date, format: "12h" | "24h", showSeconds = false) {
  const opts: Intl.DateTimeFormatOptions = {
    hour: format === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: format !== "24h",
  };
  if (showSeconds) opts.second = "2-digit";
  return date.toLocaleTimeString([], opts);
}

function formatDate(date: Date, format: DateFormatSetting) {
  if (format === "system") {
    return date.toLocaleDateString([], {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const weekday = date.toLocaleDateString([], { weekday: "long" });
  const monthName = date.toLocaleDateString([], { month: "long" });

  switch (format) {
    case "MM/DD/YYYY": return `${weekday}, ${monthName} ${date.getDate()}, ${y}`;
    case "DD/MM/YYYY": return `${weekday}, ${date.getDate()} ${monthName} ${y}`;
    case "YYYY-MM-DD": return `${weekday}, ${y}-${m}-${d}`;
    case "DD.MM.YYYY": return `${weekday}, ${d}.${m}.${y}`;
    default: return date.toLocaleDateString();
  }
}

function formatTimestampShort(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRecency(ms: number, nowMs: number): string {
  const deltaSeconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (deltaSeconds < 15) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getGreeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function displayTemp(weather: WeatherData, unit: TemperatureUnit): string {
  return `${Math.round(weather.temp)}°${unit === "fahrenheit" ? "F" : "C"}`;
}

function displayFeelsLike(weather: WeatherData, unit: TemperatureUnit): string {
  return `${Math.round(weather.feelsLike)}°${unit === "fahrenheit" ? "F" : "C"}`;
}

function displayWind(weather: WeatherData, unit: TemperatureUnit): string {
  return unit === "fahrenheit"
    ? `${Math.round(weather.windSpeed)} mph`
    : `${Math.round(weather.windSpeed)} km/h`;
}

function degreesToCompass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const normalized = ((deg % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx] ?? "N";
}

function forecastDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short" });
}

function isThunderCode(code: number): boolean {
  return code >= 95;
}

function isSnowCode(code: number): boolean {
  return code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86;
}

function isRainCode(code: number): boolean {
  return code === 51 || code === 53 || code === 55 || code === 56 || code === 57 || code === 61 || code === 63 || code === 65 || code === 66 || code === 67 || code === 80 || code === 81 || code === 82;
}

function isClearCode(code: number): boolean {
  return code === 0 || code === 1;
}

function rainLevel(code: number): 0 | 1 | 2 {
  if (!isRainCode(code)) return 0;
  if (code === 65 || code === 67 || code === 82) return 2;
  if (code === 55 || code === 57 || code === 63 || code === 66 || code === 81) return 1;
  return 0;
}

function snowLevel(code: number): 0 | 1 | 2 {
  if (!isSnowCode(code)) return 0;
  if (code === 75) return 2;
  if (code === 73 || code === 77 || code === 86) return 1;
  return 0;
}

function thunderLevel(code: number): 0 | 1 | 2 {
  if (!isThunderCode(code)) return 0;
  if (code === 99) return 2;
  if (code === 96) return 1;
  return 0;
}

function weatherIntensityLabel(code: number): "Light" | "Moderate" | "Heavy" | "Severe" | null {
  if (isThunderCode(code)) {
    const level = thunderLevel(code);
    if (level >= 2) return "Severe";
    if (level === 1) return "Heavy";
    return "Moderate";
  }
  if (isRainCode(code)) {
    const level = rainLevel(code);
    if (level >= 2) return "Heavy";
    if (level === 1) return "Moderate";
    return "Light";
  }
  if (isSnowCode(code)) {
    const level = snowLevel(code);
    if (level >= 2) return "Heavy";
    if (level === 1) return "Moderate";
    return "Light";
  }
  return null;
}

function AnimatedWeatherIcon({
  code,
  isNight = false,
  size = 24,
  moonPhaseValue = 0.5,
}: {
  code: number;
  isNight?: boolean;
  size?: number;
  moonPhaseValue?: number;
}) {
  const cloudMaskId = useId().replace(/:/g, "");
  const moonClipId = `${cloudMaskId}-moonclip`;
  const thunder = isThunderCode(code);
  const snow = isSnowCode(code);
  const rain = isRainCode(code);
  const freezingPrecip = code === 56 || code === 57 || code === 66 || code === 67;
  const hailStorm = code === 96 || code === 99;
  const fog = code === 45 || code === 48;
  const partlyCloud = code === 2;
  const overcast = code === 3;
  const clear = isClearCode(code);
  const hasCloudBody = partlyCloud || overcast || rain || snow || thunder;
  const hasCloudOccluder = partlyCloud || overcast || rain || snow || thunder || fog;
  const rainIntensity = rainLevel(code);
  const snowIntensity = snowLevel(code);
  const thunderIntensity = thunderLevel(code);
  const box = Math.max(26, size + 12);
  const stroke = 2.35;
  const clearDay = clear && !isNight;
  const moonR = 9.8;
  const moonCx = hasCloudOccluder ? 16 : 22;
  const moonCy = hasCloudOccluder ? 11 : 21;
  const sunCx = moonCx;
  const sunCy = moonCy;
  const sunR = moonR;
  const rayInner = 14.2;
  const rayOuter = 19.2;
  const cloudPathD = "M19 33h24a7 7 0 0 0 0-14a10 10 0 0 0-19-2a8 8 0 0 0-5 16z";
  const cloudStroke = "rgba(218,232,255,0.98)";
  const cloudFill = "rgba(132,170,220,0.34)";
  const sunStroke = "rgba(255,220,142,1)";
  const moonStroke = "rgba(204,214,255,1)";
  const precipStroke = "rgba(156,232,255,1)";
  const phase = ((moonPhaseValue % 1) + 1) % 1;
  const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase)); // 0=new, 1=full
  const iconIllumination = Math.min(1, 0.24 + illumination * 0.76);
  const waxing = phase < 0.5;

  return (
    <span className="relative inline-flex items-center justify-center overflow-visible" style={{ width: box, height: box }}>
      <motion.span
        className="pointer-events-none absolute rounded-full bg-[radial-gradient(circle,rgba(120,185,255,0.30)_0%,rgba(120,185,255,0)_72%)]"
        style={{ width: box, height: box }}
        animate={clear ? { opacity: [0.2, 0.45, 0.2], scale: [0.92, 1.03, 0.92] } : { opacity: [0.12, 0.28, 0.12], scale: [0.95, 1.02, 0.95] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <svg viewBox="0 0 64 64" className="drop-shadow-[0_0_10px_rgba(110,170,255,0.22)]" style={{ width: box, height: box }}>
        <defs>
          <mask id={cloudMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
            <rect x="0" y="0" width="64" height="64" fill="white" />
            {hasCloudOccluder && (
              <motion.g
                animate={{ x: [-0.9, 0.9, -0.9] }}
                transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <path d={cloudPathD} fill="black" />
              </motion.g>
            )}
          </mask>
          <clipPath id={moonClipId}>
            <circle cx={moonCx} cy={moonCy} r={moonR} />
          </clipPath>
        </defs>
        {!isNight && (clear || partlyCloud || overcast || fog || rain || thunder) && (
          <g mask={hasCloudOccluder ? `url(#${cloudMaskId})` : undefined}>
            <motion.circle
              cx={sunCx}
              cy={sunCy}
              r={sunR}
              fill="rgba(255,194,96,0.42)"
              stroke={sunStroke}
              strokeWidth={stroke}
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 42, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: `${sunCx}px ${sunCy}px` }}
            />
            {!rain && !thunder && clearDay && (
              <motion.g
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: `${sunCx}px ${sunCy}px` }}
              >
                {Array.from({ length: 8 }).map((_, i) => {
                  const a = (Math.PI / 4) * i;
                  const x1 = sunCx + Math.cos(a) * rayInner;
                  const y1 = sunCy + Math.sin(a) * rayInner;
                  const x2 = sunCx + Math.cos(a) * rayOuter;
                  const y2 = sunCy + Math.sin(a) * rayOuter;
                  return (
                    <line
                      key={`sun-ray-${i}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={sunStroke}
                      strokeWidth={2.15}
                      strokeLinecap="round"
                    />
                  );
                })}
              </motion.g>
            )}
          </g>
        )}

        {isNight && (clear || partlyCloud || overcast || fog || rain || snow || thunder) && (
          <motion.g
            mask={hasCloudOccluder ? `url(#${cloudMaskId})` : undefined}
            animate={{ y: [0, -0.8, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: `${moonCx}px ${moonCy}px` }}
          >
            <circle cx={moonCx} cy={moonCy} r={moonR} fill="rgba(120,135,175,0.62)" stroke={moonStroke} strokeWidth={stroke} />
            <g clipPath={`url(#${moonClipId})`}>
              <ellipse
                cx={moonCx + (waxing ? moonR - (Math.max(0.08, iconIllumination) * (moonR * 2)) / 2 : -moonR + (Math.max(0.08, iconIllumination) * (moonR * 2)) / 2)}
                cy={moonCy}
                rx={Math.max(0.08, iconIllumination) * moonR}
                ry={moonR}
                fill="rgba(208,219,255,0.95)"
              />
            </g>
          </motion.g>
        )}

        {hasCloudBody && (
          <motion.g
            animate={{ x: [-0.9, 0.9, -0.9] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d={cloudPathD}
              fill={cloudFill}
              stroke={cloudStroke}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
        )}
        {overcast && (
          <motion.g
            animate={{ x: [-0.7, 0.7, -0.7] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <path
              d="M15 36h30a7 7 0 0 0 0-14a10 10 0 0 0-17-2.8A8 8 0 0 0 15 36z"
              fill="rgba(120,158,210,0.30)"
              stroke={cloudStroke}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19 40h24a6 6 0 0 0 0-12a8 8 0 0 0-14.5-2.2A6.6 6.6 0 0 0 19 40z"
              fill="rgba(156,186,226,0.40)"
              stroke="rgba(228,238,255,0.95)"
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
        )}

        {rain && (
          <g>
            {(rainIntensity === 0 ? [0, 1] : rainIntensity === 1 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5]).map((i) => (
              <motion.line
                key={`rain-${i}`}
                x1={rainIntensity === 2 ? 21 + i * 4 : 24 + i * 5}
                y1={39}
                x2={rainIntensity === 2 ? 19 + i * 4 : 22 + i * 5}
                y2={rainIntensity === 0 ? 43 : rainIntensity === 1 ? 45 : 47}
                stroke={precipStroke}
                strokeWidth={rainIntensity === 0 ? 1.7 : rainIntensity === 1 ? 1.95 : 2.2}
                strokeLinecap="round"
                animate={{ y: [-2, 7], opacity: [0, 1, 0] }}
                transition={{
                  duration: rainIntensity === 0 ? 1.05 : rainIntensity === 1 ? 0.92 : 0.78,
                  repeat: Infinity,
                  ease: "linear",
                  delay: i * (rainIntensity === 2 ? 0.1 : 0.14),
                }}
              />
            ))}
            {freezingPrecip && (
              <>
                <motion.path
                  d="M24 41l2 2m0-2l-2 2"
                  stroke="rgba(196,234,255,0.95)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  animate={{ opacity: [0.2, 0.95, 0.2], y: [-0.5, 1, -0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.path
                  d="M38 43l2 2m0-2l-2 2"
                  stroke="rgba(196,234,255,0.95)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  animate={{ opacity: [0.2, 0.95, 0.2], y: [-0.5, 1, -0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.35 }}
                />
              </>
            )}
          </g>
        )}

        {snow && (
          <g>
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={`snow-${i}`}
                cx={26 + i * 6}
                cy={41}
                r={1.35}
                fill="rgba(238,245,255,0.98)"
                animate={{ y: [-1, 6], x: [0, i % 2 === 0 ? 1 : -1, 0], opacity: [0, 1, 0] }}
                transition={{
                  duration: 1.7 - snowIntensity * 0.15,
                  repeat: Infinity,
                  ease: "linear",
                  delay: i * 0.22,
                }}
              />
            ))}
          </g>
        )}

        {thunder && (
          <>
            <motion.path
              d="M33 38l-4 7h4l-2 7l8-10h-4l2-4z"
              fill="rgba(255,206,110,0.42)"
              stroke="rgba(255,221,153,1)"
              strokeWidth={1.6}
              strokeLinejoin="round"
              animate={{ opacity: [0.2, 1, 0.15] }}
              transition={{ duration: 0.8 - thunderIntensity * 0.08, repeat: Infinity, ease: "easeInOut" }}
            />
            {thunderIntensity >= 1 && (
              <motion.path
                d="M27 40l-3 6h3l-2 5l6-8h-3l1-3z"
                fill="rgba(255,206,110,0.28)"
                stroke="rgba(255,221,153,0.95)"
                strokeWidth={1.2}
                strokeLinejoin="round"
                animate={{ opacity: [0.1, 0.9, 0.1] }}
                transition={{ duration: 0.72, repeat: Infinity, ease: "easeInOut", delay: 0.18 }}
              />
            )}
            <motion.circle
              cx="34"
              cy="42"
              r={thunderIntensity >= 2 ? 12 : 10}
              fill="none"
              stroke="rgba(255,214,130,0.4)"
              strokeWidth={thunderIntensity >= 2 ? "1.6" : "1.3"}
              animate={{ opacity: [0, thunderIntensity >= 2 ? 0.9 : 0.6, 0], scale: [0.9, thunderIntensity >= 2 ? 1.28 : 1.2, thunderIntensity >= 2 ? 1.4 : 1.3] }}
              transition={{ duration: thunderIntensity >= 2 ? 0.85 : 1.1, repeat: Infinity, ease: "easeOut" }}
            />
            {thunderIntensity >= 2 && (
              <motion.g>
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.line
                    key={`storm-rain-${i}`}
                    x1={22 + i * 4}
                    y1={40}
                    x2={20 + i * 4}
                    y2={47}
                    stroke="rgba(160,232,255,0.95)"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    animate={{ y: [-2, 7], opacity: [0, 1, 0] }}
                    transition={{ duration: 0.72, repeat: Infinity, ease: "linear", delay: i * 0.1 }}
                  />
                ))}
              </motion.g>
            )}
            {hailStorm && (
              <motion.g>
                {(code === 99 ? [0, 1, 2, 3, 4] : [0, 1, 2]).map((i) => (
                  <motion.circle
                    key={`hail-${i}`}
                    cx={(code === 99 ? 22 : 25) + i * 4.2}
                    cy={46}
                    r={code === 99 ? 1.45 : 1.2}
                    fill="rgba(220,245,255,0.96)"
                    stroke="rgba(178,225,245,0.92)"
                    strokeWidth="1"
                    animate={{ y: [-2, 6], opacity: [0, 1, 0] }}
                    transition={{ duration: code === 99 ? 0.78 : 0.92, repeat: Infinity, ease: "linear", delay: i * 0.12 }}
                  />
                ))}
              </motion.g>
            )}
          </>
        )}

        {fog && (
          <g>
            <motion.path
              d="M23 30h18a5 5 0 0 0 0-10a6.8 6.8 0 0 0-12-1.8A5.5 5.5 0 0 0 23 30z"
              fill="rgba(176,194,218,0.24)"
              stroke="rgba(216,228,246,0.75)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
            />
            {[0, 1, 2].map((i) => (
              <motion.path
                key={`fog-${i}`}
                d={`M${16 + i * 2} ${39 + i * 4}h${30 - i * 6}`}
                stroke="rgba(216,228,246,0.9)"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
                animate={{ x: [-1.6, 1.6, -1.6], opacity: [0.35, 0.85, 0.35] }}
                transition={{ duration: 2.6 - i * 0.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.16 }}
              />
            ))}
          </g>
        )}
      </svg>
    </span>
  );
}

function parseLocalIsoMinutes(value: string): number | null {
  const m = value.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function minutesInTimeZone(date: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function celestialArcPositionForCard(
  w: number,
  h: number,
  progress: number,
): { x: number; y: number } {
  const margin = w * 0.12;
  const x = margin + progress * (w - margin * 2);
  const horizonY = h * 0.65;
  const peakY = h < 180 ? h * 0.18 : h * 0.12;
  const t = (progress - 0.5) * 2;
  const y = peakY + (horizonY - peakY) * t * t;
  return { x, y };
}

function weatherDayPanelBackground(code: number): string {
  // Daytime mood map tuned by weather condition, with partial transparency
  // so the home background can still subtly come through.
  if (code >= 95) return "linear-gradient(160deg, hsl(220 28% 36% / 0.72) 0%, hsl(224 24% 30% / 0.68) 52%, hsl(229 20% 24% / 0.64) 100%)";
  if (code >= 61 || code === 51 || code === 53 || code === 55) {
    return "linear-gradient(160deg, hsl(206 30% 56% / 0.7) 0%, hsl(212 24% 47% / 0.66) 52%, hsl(219 20% 39% / 0.62) 100%)";
  }
  if (code === 45 || code === 48) {
    return "linear-gradient(160deg, hsl(205 18% 72% / 0.66) 0%, hsl(210 16% 62% / 0.62) 55%, hsl(219 16% 50% / 0.58) 100%)";
  }
  if (code >= 71 && code <= 86) {
    return "linear-gradient(160deg, hsl(206 22% 82% / 0.72) 0%, hsl(212 18% 72% / 0.68) 52%, hsl(219 16% 62% / 0.62) 100%)";
  }
  if (code >= 2) {
    return "linear-gradient(160deg, hsl(203 42% 70% / 0.72) 0%, hsl(210 32% 59% / 0.66) 52%, hsl(219 24% 47% / 0.6) 100%)";
  }
  return "linear-gradient(160deg, hsl(201 70% 76% / 0.74) 0%, hsl(209 58% 67% / 0.68) 52%, hsl(220 44% 55% / 0.62) 100%)";
}

// ── Component ────────────────────────────────────────────────────

export function HomeView() {
  const isActive = useToolStore((s) => s.activeToolId) === HOME_TOOL_ID;
  const timeFormat = useSettingsStore((s) => s.timeFormat) ?? "12h";
  const dateFormat = useSettingsStore((s) => s.dateFormat) ?? "system";
  const temperatureUnit = useSettingsStore((s) => s.temperatureUnit) ?? "celsius";
  const weatherLocation = useSettingsStore((s) => s.weatherLocation) ?? "";
  const weatherLat = useSettingsStore((s) => s.weatherLat);
  const weatherLon = useSettingsStore((s) => s.weatherLon);
  const hero = useHomeStore((s) => s.hero);
  const homePreset = useHomeStore((s) => s.homePreset);
  const mergedHero = useMemo(() => ({ ...DEFAULT_HERO, ...hero }), [hero]);
  const clockEnabled =
    isActive &&
    (mergedHero.showClock ||
      mergedHero.showDate ||
      mergedHero.showGreeting ||
      mergedHero.showMoonPhase ||
      mergedHero.showWeatherEffects);
  const now = useCurrentTime(clockEnabled, mergedHero.showSeconds);
  const greeting = getGreeting(now.getHours());
  const { notify } = useNotifications();
  const notes = useNoteStore((s) => s.notes);
  const fetchAllNotes = useNoteStore((s) => s.fetchAllNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNoteQuiet = useNoteStore((s) => s.updateNoteQuiet);
  const setSelectedNoteId = useNoteStore((s) => s.setSelectedNoteId);
  const setNotesCenterOpen = useLayoutStore((s) => s.setNotesCenterOpen);

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [heroDragOver, setHeroDragOver] = useState(false);
  const [heroImporting, setHeroImporting] = useState(false);
  const moonAudioStopTimerRef = useRef<number | null>(null);
  const moonAudioContextRef = useRef<AudioContext | null>(null);
  const moonAudioBufferRef = useRef<AudioBuffer | null>(null);
  const moonAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const moonAudioLoadPromiseRef = useRef<Promise<void> | null>(null);
  const weatherCardFrameRef = useRef<HTMLDivElement | null>(null);
  const heroDragDepthRef = useRef(0);
  const [weatherCardSize, setWeatherCardSize] = useState({ width: 0, height: 0 });
  const [quickNoteText, setQuickNoteText] = useState("");
  const [quickNoteDirty, setQuickNoteDirty] = useState(false);
  const [quickNoteSaving, setQuickNoteSaving] = useState(false);
  const [quickNoteError, setQuickNoteError] = useState<string | null>(null);
  const [lastQuickNoteSavedAt, setLastQuickNoteSavedAt] = useState<number | null>(null);
  const [lastImportEvent, setLastImportEvent] = useState<{
    outcome: "success" | "failure";
    at: number;
  } | null>(null);
  const [footerNowMs, setFooterNowMs] = useState(() => Date.now());
  const [deferredSectionsReady, setDeferredSectionsReady] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    setDeferredSectionsReady(false);
    const frameId = window.requestAnimationFrame(() => setDeferredSectionsReady(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = () => {
      fetchWeather(weatherLat, weatherLon, weatherLocation, temperatureUnit).then((w) => {
      if (!cancelled) {
        setWeather(w);
        setWeatherLoading(false);
      }
    });
    };
    setWeatherLoading(true);
    const debounce = setTimeout(load, 500);
    const interval = setInterval(() => {
      fetchWeather(weatherLat, weatherLon, weatherLocation, temperatureUnit).then((w) => {
        if (!cancelled) setWeather(w);
      });
    }, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [weatherLocation, weatherLat, weatherLon, temperatureUnit, isActive]);

  useEffect(() => {
    if (!isActive) return;
    void fetchAllNotes();
  }, [isActive, fetchAllNotes]);

  const quickNote = useMemo(
    () => notes.find((n) => n.tags?.includes(HOME_QUICK_NOTE_PROTECTED_TAG) || n.title === HOME_QUICK_NOTE_TITLE) ?? null,
    [notes],
  );

  useEffect(() => {
    if (quickNoteDirty) return;
    setQuickNoteText(quickNote?.content ?? "");
  }, [quickNote?.id, quickNote?.updatedAt, quickNote?.content, quickNoteDirty]);

  useEffect(() => {
    const updatedAt = quickNote?.updatedAt;
    if (!updatedAt) return;
    const parsed = new Date(updatedAt).getTime();
    if (!Number.isFinite(parsed)) return;
    setLastQuickNoteSavedAt((prev) => (prev == null ? parsed : Math.max(prev, parsed)));
  }, [quickNote?.updatedAt]);

  useEffect(() => {
    if (!isActive) return;
    setFooterNowMs(Date.now());
    const id = window.setInterval(() => setFooterNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const persistQuickNote = useCallback(async (content: string) => {
    setQuickNoteSaving(true);
    setQuickNoteError(null);
    try {
      if (quickNote) {
        const mergedTags = Array.from(new Set([...(quickNote.tags ?? []), "home", "quick-note", HOME_QUICK_NOTE_PROTECTED_TAG]));
        await updateNoteQuiet(
          quickNote.id,
          quickNote.title,
          content,
          mergedTags,
          HOME_QUICK_NOTE_CATEGORY,
          quickNote.isPinned,
          quickNote.linkedNoteIds,
          quickNote.folderId,
          quickNote.linkedRegistrarId,
          quickNote.linkedAgentId,
        );
      } else {
        await createNote(
          HOME_QUICK_NOTE_TITLE,
          content,
          ["home", "quick-note", HOME_QUICK_NOTE_PROTECTED_TAG],
          undefined,
          undefined,
          HOME_QUICK_NOTE_CATEGORY,
          true,
        );
      }
      setQuickNoteDirty(false);
      setLastQuickNoteSavedAt(Date.now());
    } catch (e) {
      setQuickNoteError(e instanceof Error ? e.message : "Failed to save quick note");
    } finally {
      setQuickNoteSaving(false);
    }
  }, [quickNote, updateNoteQuiet, createNote]);

  useEffect(() => {
    if (!quickNoteDirty) return;
    const id = window.setTimeout(() => {
      void persistQuickNote(quickNoteText);
    }, 700);
    return () => window.clearTimeout(id);
  }, [quickNoteDirty, quickNoteText, persistQuickNote]);

  const openQuickNoteInNotes = useCallback(() => {
    if (quickNote?.id) {
      setSelectedNoteId(quickNote.id);
    }
    setNotesCenterOpen(true);
  }, [quickNote?.id, setNotesCenterOpen, setSelectedNoteId]);

  const moon = computeMoonPhase(now);
  const moonTilt = useMemo(() => {
    const lat = weatherLat ?? weather?.lat ?? null;
    const lon = weatherLon ?? weather?.lon ?? null;
    if (lat == null || lon == null) return 0;
    const moonPos = SunCalc.getMoonPosition(now, lat, lon);
    const illum = SunCalc.getMoonIllumination(now);
    // Bright-limb bearing (north=0, east=+PI/2), corrected for observer orientation.
    // WeatherEffects maps this bearing into canvas coordinates.
    return illum.angle - moonPos.parallacticAngle;
  }, [now, weatherLat, weatherLon, weather?.lat, weather?.lon]);

  const rise = weather?.astronomy ? parseLocalIsoMinutes(weather.astronomy.sunrise) : null;
  const set_ = weather?.astronomy ? parseLocalIsoMinutes(weather.astronomy.sunset) : null;
  const riseMins = rise ?? 6 * 60;
  const setMins = set_ ?? 19 * 60;
  const nowMins =
    (weather?.timezone ? minutesInTimeZone(now, weather.timezone) : null) ??
    (now.getHours() * 60 + now.getMinutes());
  const isNight = weather ? !weather.isDay : (nowMins < riseMins || nowMins >= setMins);

  const celestialProgress = (() => {
    if (!isNight) {
      const dayLen = setMins - riseMins;
      return dayLen > 0 ? Math.max(0, Math.min(1, (nowMins - riseMins) / dayLen)) : 0.5;
    }
    const nightLen = (24 * 60 - setMins) + riseMins;
    const sinceSet = nowMins >= setMins ? nowMins - setMins : nowMins + (24 * 60 - setMins);
    return nightLen > 0 ? Math.max(0, Math.min(1, sinceSet / nightLen)) : 0.5;
  })();
  const weatherPanelBackground = useMemo(() => {
    if (isNight) {
      return "linear-gradient(165deg, hsl(236 34% 10%) 0%, hsl(231 31% 8%) 58%, hsl(227 28% 7%) 100%)";
    }
    return weatherDayPanelBackground(weather?.weatherCode ?? 0);
  }, [isNight, weather?.weatherCode]);
  const weatherPanelOverlay = useMemo(() => {
    if (isNight) {
      return "linear-gradient(180deg, rgba(8,12,22,0.14) 0%, rgba(8,12,22,0.08) 50%, rgba(8,12,22,0.18) 100%)";
    }

    const code = weather?.weatherCode ?? 0;
    const cloudCover = Math.max(0, Math.min(100, weather?.cloudCover ?? 0));
    const clearDay = isClearCode(code) && cloudCover <= 35;

    // Keep text readability but avoid the "fog film" look on clear days.
    if (clearDay) {
      return "linear-gradient(180deg, rgba(8,14,28,0.08) 0%, rgba(8,14,28,0.04) 46%, rgba(8,14,28,0.12) 100%)";
    }

    return "linear-gradient(180deg, rgba(9,16,32,0.22) 0%, rgba(9,16,32,0.14) 46%, rgba(9,16,32,0.26) 100%)";
  }, [isNight, weather?.weatherCode, weather?.cloudCover]);
  const dayReadable = !isNight;

  useEffect(() => {
    return () => {
      if (moonAudioStopTimerRef.current != null) {
        window.clearTimeout(moonAudioStopTimerRef.current);
      }
      const source = moonAudioSourceRef.current;
      if (source) {
        try { source.stop(); } catch { /* noop */ }
      }
      moonAudioSourceRef.current = null;
      moonAudioContextRef.current?.close().catch(() => {});
      moonAudioContextRef.current = null;
    };
  }, []);

  const playMoonEasterEgg = useCallback(async () => {
    if (!moonAudioContextRef.current) {
      moonAudioContextRef.current = new AudioContext();
    }
    const ctx = moonAudioContextRef.current;
    if (!ctx) return;

    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    if (!moonAudioBufferRef.current) {
      if (!moonAudioLoadPromiseRef.current) {
        moonAudioLoadPromiseRef.current = (async () => {
          const res = await fetch(MOON_EASTER_EGG_AUDIO_URL, { cache: "force-cache" });
          if (!res.ok) throw new Error("moon sample fetch failed");
          const arrayBuffer = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
          moonAudioBufferRef.current = decoded;
        })().finally(() => {
          moonAudioLoadPromiseRef.current = null;
        });
      }
      await moonAudioLoadPromiseRef.current.catch(() => {});
    }

    const buffer = moonAudioBufferRef.current;
    if (!buffer) return;

    if (moonAudioStopTimerRef.current != null) {
      window.clearTimeout(moonAudioStopTimerRef.current);
    }

    if (moonAudioSourceRef.current) {
      try { moonAudioSourceRef.current.stop(); } catch { /* noop */ }
      moonAudioSourceRef.current.disconnect();
      moonAudioSourceRef.current = null;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    moonAudioSourceRef.current = source;
    source.onended = () => {
      if (moonAudioSourceRef.current === source) {
        moonAudioSourceRef.current = null;
      }
    };

    moonAudioStopTimerRef.current = window.setTimeout(() => {
      if (moonAudioSourceRef.current) {
        try { moonAudioSourceRef.current.stop(); } catch { /* noop */ }
        moonAudioSourceRef.current.disconnect();
        moonAudioSourceRef.current = null;
      }
    }, MOON_EASTER_EGG_STOP_MS);
  }, []);

  const handleHeroMoonTripleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail !== 3) return;
    if (!isNight || !mergedHero.showWeatherEffects || !weather || weatherLoading) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const moonPos = celestialArcPositionForCard(rect.width, rect.height, celestialProgress);
    const moonRadius = Math.max(Math.min(rect.width, rect.height) * 0.1, 16);
    const dx = localX - moonPos.x;
    const dy = localY - moonPos.y;
    if (dx * dx + dy * dy <= moonRadius * moonRadius * 1.08) {
      void playMoonEasterEgg();
    }
  }, [celestialProgress, mergedHero.showWeatherEffects, isNight, playMoonEasterEgg, weather, weatherLoading]);

  useEffect(() => {
    const node = weatherCardFrameRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setWeatherCardSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const moonTooltipPosition = useMemo(() => {
    if (weatherCardSize.width <= 0 || weatherCardSize.height <= 0) return null;
    return celestialArcPositionForCard(weatherCardSize.width, weatherCardSize.height, celestialProgress);
  }, [weatherCardSize.height, weatherCardSize.width, celestialProgress]);
  const moonTooltipRadius = Math.max(Math.min(weatherCardSize.width, weatherCardSize.height) * 0.1, 16);

  const openImportedCapture = useCallback((sessionId: string, sourceName?: string) => {
    notify({
      source: "packet-capture",
      type: "success",
      title: "Capture Imported",
      description: sourceName ? `${sourceName} is ready for analysis.` : "PCAP file imported.",
    });
    navigateTo("packet-capture", "analysis", { packetCaptureSessionId: sessionId });
  }, [notify]);

  const handleHeroImportPicker = useCallback(async () => {
    setHeroImporting(true);
    try {
      const sessionId = await importPcap();
      setLastImportEvent({ outcome: "success", at: Date.now() });
      openImportedCapture(sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes("cancel")) {
        setLastImportEvent({ outcome: "failure", at: Date.now() });
        notify({ source: "packet-capture", type: "error", title: "Import Failed", description: msg });
      }
    } finally {
      setHeroImporting(false);
    }
  }, [notify, openImportedCapture]);

  const handleHeroDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    heroDragDepthRef.current += 1;
    setHeroDragOver(true);
  }, []);

  const handleHeroDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setHeroDragOver(true);
  }, []);

  const handleHeroDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    heroDragDepthRef.current = Math.max(0, heroDragDepthRef.current - 1);
    if (heroDragDepthRef.current === 0) {
      setHeroDragOver(false);
    }
  }, []);

  const handleHeroDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    heroDragDepthRef.current = 0;
    setHeroDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const captureFiles = files.filter((f) => CAPTURE_FILE_RE.test(f.name));
    if (!captureFiles.length) {
      notify({
        source: "packet-capture",
        type: "error",
        title: "Unsupported File",
        description: "Use .pcap, .pcapng, or .cap files.",
      });
      return;
    }

    setHeroImporting(true);
    try {
      let lastSessionId: string | null = null;
      for (const file of captureFiles) {
        const fp = (file as unknown as { path?: string }).path;
        if (fp) {
          lastSessionId = await importPcapFromPath(fp);
          continue;
        }
        // Fallback for drag sources that don't expose a local path in webview.
        const base64Data = await fileToBase64(file);
        lastSessionId = await importPcapFromBase64(base64Data, file.name);
      }
      if (!lastSessionId) {
        setLastImportEvent({ outcome: "failure", at: Date.now() });
        notify({
          source: "packet-capture",
          type: "error",
          title: "Import Failed",
          description: "Could not read dropped file data. Try Import Capture File.",
        });
        return;
      }
      setLastImportEvent({ outcome: "success", at: Date.now() });
      if (lastSessionId) openImportedCapture(lastSessionId, captureFiles[captureFiles.length - 1]?.name);
    } catch (e) {
      setLastImportEvent({ outcome: "failure", at: Date.now() });
      notify({
        source: "packet-capture",
        type: "error",
        title: "Import Failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setHeroImporting(false);
    }
  }, [notify, openImportedCapture]);

  const footerStatusTone = useMemo(() => {
    if (heroImporting || quickNoteSaving) return "text-warning";
    if (quickNoteError || lastImportEvent?.outcome === "failure") return "text-rose-300";
    if (quickNoteDirty) return "text-warning";
    return "text-muted-foreground";
  }, [heroImporting, lastImportEvent?.outcome, quickNoteDirty, quickNoteError, quickNoteSaving]);
  const footerDataReady = useMemo(
    () => !heroImporting && !quickNoteSaving,
    [heroImporting, quickNoteSaving],
  );
  const quickNoteFooterContext = useMemo(() => {
    if (quickNoteError) return "quick note save failed";
    if (quickNoteSaving) return "quick note saving";
    if (quickNoteDirty) return "quick note has unsaved changes";
    if (lastQuickNoteSavedAt != null) {
      return `quick note saved ${formatRecency(lastQuickNoteSavedAt, footerNowMs)} (last saved ${formatTimestampShort(lastQuickNoteSavedAt)})`;
    }
    return "quick note ready";
  }, [footerNowMs, lastQuickNoteSavedAt, quickNoteDirty, quickNoteError, quickNoteSaving]);
  const importFooterContext = useMemo(() => {
    if (heroImporting) return "capture import in progress";
    if (!lastImportEvent) return null;
    const stateLabel = lastImportEvent.outcome === "success" ? "import succeeded" : "import failed";
    return `${stateLabel} ${formatRecency(lastImportEvent.at, footerNowMs)} (at ${formatTimestampShort(lastImportEvent.at)})`;
  }, [footerNowMs, heroImporting, lastImportEvent]);
  const footerStatusLine = useMemo(() => {
    const details = [quickNoteFooterContext, importFooterContext].filter(Boolean).join(" • ");
    if (heroImporting) return `Status: importing packet capture... • ${details}`;
    if (quickNoteSaving) return `Status: saving quick note... • ${details}`;
    if (quickNoteError) return `Status: quick note save failed • ${details}`;
    if (quickNoteDirty) return `Status: quick note has unsaved changes • ${details}`;
    if (!footerDataReady) return `Status: preparing activity feed... • ${details}`;
    return details ? `Status: home hub ready • ${details}` : "Status: home hub ready";
  }, [footerDataReady, heroImporting, importFooterContext, quickNoteDirty, quickNoteError, quickNoteFooterContext, quickNoteSaving]);
  const topSectionPadClassByPreset: Record<HomePreset, string> = {
    focus: "pt-4",
    operations: "pt-3.5",
    monitoring: "pt-3",
  };
  const topSectionGridGapClassByPreset: Record<HomePreset, string> = {
    focus: "gap-3",
    operations: "gap-2.5",
    monitoring: "gap-2",
  };
  const heroCardHeightClassByPreset: Record<HomePreset, string> = {
    focus: "h-[282px] max-h-[282px]",
    operations: "h-[274px] max-h-[274px]",
    monitoring: "h-[268px] max-h-[268px]",
  };
  const topSectionPadClass = topSectionPadClassByPreset[homePreset];
  const topSectionGridGapClass = topSectionGridGapClassByPreset[homePreset];
  const heroCardHeightClass = heroCardHeightClassByPreset[homePreset];

  return (
    <div className="relative flex flex-1 min-h-0 flex-col overflow-auto bg-[radial-gradient(130%_105%_at_10%_-18%,rgba(95,150,205,0.035)_0%,rgba(17,28,40,0)_56%),linear-gradient(180deg,rgba(14,22,32,0.11)_0%,rgba(10,17,25,0.16)_46%,rgba(7,13,20,0.20)_100%)]">
      <div className={cn("flex min-h-0 flex-1 min-w-[1180px] flex-col px-5 pb-4", topSectionPadClass, topSectionGridGapClass)}>
        <div className="ui-panel-shell grid min-h-0 h-full grid-cols-[minmax(0,1fr)_470px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/55 bg-[linear-gradient(180deg,hsl(var(--card)/0.92)_0%,hsl(var(--background)/0.86)_100%)] shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05),0_16px_30px_hsl(220_30%_3%_/0.25)]">
          <div className="min-h-0 p-3 pr-2.5">
            {deferredSectionsReady ? (
              <div
                ref={weatherCardFrameRef}
                className={cn("relative w-full", heroCardHeightClass)}
                onClickCapture={handleHeroMoonTripleClick}
              >
                <SpotlightCard
                  className="relative h-full max-h-full overflow-hidden rounded-md border border-border/45 before:hidden"
                  style={{ background: weatherPanelBackground }}
                >
                  {mergedHero.showWeatherEffects && weather && !weatherLoading && (
                    <Suspense fallback={null}>
                      <WeatherEffects
                        weatherCode={weather.weatherCode}
                        isNight={isNight}
                        moonPhase={moon.phase}
                        moonIllumination={moon.illumination}
                        moonAge={moon.age}
                        moonPhaseValue={moon.phaseValue}
                        moonTilt={moonTilt}
                        celestialProgress={celestialProgress}
                        className="rounded-md"
                      />
                    </Suspense>
                  )}
                  {(() => {
                    if (!deferredSectionsReady) {
                      return (
                        <div
                          className="relative z-10 h-full flex flex-col px-5 py-3.5"
                          style={{
                            background: `linear-gradient(180deg, rgba(7,11,18,0.22) 0%, rgba(8,13,20,0.14) 45%, rgba(7,10,16,0.26) 100%), ${weatherPanelOverlay}`,
                          }}
                        >
                          <div className="flex flex-1 items-center justify-between gap-4">
                            <div className="h-12 w-56 rounded-md bg-white/10" />
                            <div className="h-12 w-44 rounded-md bg-white/10" />
                          </div>
                          <div className="mt-2 h-[122px] rounded-md border border-white/10 bg-white/[0.04]" />
                        </div>
                      );
                    }
                    const days = weather?.forecast.slice(1, 6) ?? [];
                    const hasForecast = mergedHero.showForecast && mergedHero.showWeather && days.length > 0;
                    return (
                      <div
                        className={cn(
                          "relative z-10 h-full flex flex-col px-5 py-3.5",
                        )}
                        style={{
                          textShadow: mergedHero.showWeatherEffects
                            ? (dayReadable ? "0 1px 3px rgba(0,0,0,0.5)" : "0 1px 3px rgba(0,0,0,0.35)")
                            : undefined,
                          background: `linear-gradient(180deg, rgba(7,11,18,0.22) 0%, rgba(8,13,20,0.14) 45%, rgba(7,10,16,0.26) 100%), ${weatherPanelOverlay}`,
                        }}
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,0.95fr)] items-stretch gap-6 flex-1 min-h-0">
                          {(mergedHero.showGreeting || mergedHero.showClock || mergedHero.showDate) && (
                            <div className="min-w-0 px-1 py-1.5 flex flex-col justify-center">
                              {mergedHero.showGreeting && (
                                <p className={cn(
                                  "text-3xs font-semibold tracking-[0.14em] uppercase",
                                  dayReadable ? "text-foreground/72" : "text-foreground/55",
                                )}>
                                  {greeting}
                                </p>
                              )}
                              {mergedHero.showClock && (
                                <h1 className="font-bold text-foreground tabular-nums tracking-tight leading-none text-4xl sm:text-5xl">
                                  {formatTime(now, timeFormat, mergedHero.showSeconds)}
                                </h1>
                              )}
                              {mergedHero.showDate && (
                                <p className={cn("text-xs mt-1", dayReadable ? "text-foreground/78" : "text-foreground/62")}>
                                  {formatDate(now, dateFormat)}
                                </p>
                              )}
                            </div>
                          )}

                          {mergedHero.showWeather && (
                            <>
                              {weatherLoading ? (
                                <div className="flex items-center gap-2 shrink-0">
                                  <Loader2 className="h-4 w-4 animate-spin text-foreground/40" />
                                </div>
                              ) : weather ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="group text-right shrink-0 min-w-[340px] px-1 py-1.5 flex flex-col justify-center gap-2 cursor-help transition-transform duration-300 hover:-translate-y-0.5">
                                      <div className="grid grid-cols-[40px_auto] items-center justify-end gap-x-3">
                                        <span className="inline-flex h-10 w-10 translate-y-[3px] items-center justify-center">
                                          {weather ? (
                                            <AnimatedWeatherIcon code={weather.weatherCode} isNight={isNight} size={40} moonPhaseValue={moon.phaseValue} />
                                          ) : (
                                            <AnimatedWeatherIcon code={2} isNight={isNight} size={40} moonPhaseValue={moon.phaseValue} />
                                          )}
                                        </span>
                                        <span className="font-bold text-foreground tabular-nums text-[36px] leading-[0.95] tracking-tight transition-transform duration-300 group-hover:scale-[1.03]">
                                          {displayTemp(weather, temperatureUnit)}
                                        </span>
                                      </div>
                                      {mergedHero.showWeatherDescription && (
                                        <p className={cn("text-sm font-semibold", dayReadable ? "text-foreground/90" : "text-foreground/72")}>
                                          {weather.weatherDesc}
                                        </p>
                                      )}
                                      {(mergedHero.showWind || mergedHero.showFeelsLike || mergedHero.showHumidity) && (
                                        <div className={cn(
                                          "flex flex-wrap justify-end items-center gap-x-4 gap-y-1.5 text-xs",
                                          dayReadable ? "text-foreground/86" : "text-foreground/67",
                                        )}>
                                          {mergedHero.showWind && (
                                            <span className="inline-flex items-center gap-1">
                                              <Wind className="h-2.5 w-2.5" /> {displayWind(weather, temperatureUnit)}
                                            </span>
                                          )}
                                          {mergedHero.showFeelsLike && (
                                            <span className="inline-flex items-center gap-1">
                                              <Thermometer className="h-2.5 w-2.5" /> Feels {displayFeelsLike(weather, temperatureUnit)}
                                            </span>
                                          )}
                                          {mergedHero.showHumidity && (
                                            <span className="inline-flex items-center gap-1">
                                              <Drop className="h-2.5 w-2.5" /> {weather.humidity}%
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" align="center" sideOffset={8}>
                                    <div className="space-y-1.5 text-xs min-w-[230px]">
                                      <p className="font-medium text-foreground">Current Conditions</p>
                                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                                        <span>Condition</span>
                                        <span className="text-right text-foreground">{weather.weatherDesc}</span>
                                        <span>Temperature</span>
                                        <span className="text-right text-foreground tabular-nums">{displayTemp(weather, temperatureUnit)}</span>
                                        <span>Feels Like</span>
                                        <span className="text-right text-foreground tabular-nums">{displayFeelsLike(weather, temperatureUnit)}</span>
                                        <span>Humidity</span>
                                        <span className="text-right text-foreground tabular-nums">{weather.humidity}%</span>
                                        <span>Wind</span>
                                        <span className="text-right text-foreground tabular-nums">
                                          {displayWind(weather, temperatureUnit)} {degreesToCompass(weather.windDirection)}
                                        </span>
                                        <span>Gusts</span>
                                        <span className="text-right text-foreground tabular-nums">
                                          {temperatureUnit === "fahrenheit" ? `${Math.round(weather.windGust)} mph` : `${Math.round(weather.windGust)} km/h`}
                                        </span>
                                        <span>Pressure (MSL)</span>
                                        <span className="text-right text-foreground tabular-nums">{Math.round(weather.pressureMsl)} hPa</span>
                                        <span>Surface Pressure</span>
                                        <span className="text-right text-foreground tabular-nums">{Math.round(weather.surfacePressure)} hPa</span>
                                        <span>Cloud Cover</span>
                                        <span className="text-right text-foreground tabular-nums">{Math.round(weather.cloudCover)}%</span>
                                        <span>Precipitation</span>
                                        <span className="text-right text-foreground tabular-nums">{weather.precipitation.toFixed(1)} mm</span>
                                        <span>Visibility</span>
                                        <span className="text-right text-foreground tabular-nums">
                                          {temperatureUnit === "fahrenheit"
                                            ? `${(weather.visibility / 1609.344).toFixed(1)} mi`
                                            : `${(weather.visibility / 1000).toFixed(1)} km`}
                                        </span>
                                        {weather.astronomy && (
                                          <>
                                            <span>Sunrise</span>
                                            <span className="text-right text-foreground tabular-nums">
                                              {new Date(weather.astronomy.sunrise).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                            </span>
                                            <span>Sunset</span>
                                            <span className="text-right text-foreground tabular-nums">
                                              {new Date(weather.astronomy.sunset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </>
                          )}
                        </div>

                        {hasForecast && (
                          <div className="mt-2 h-[122px] overflow-hidden rounded-md border border-white/10">
                            <div
                              className="h-full px-2 py-1.5"
                              style={{
                                background: "linear-gradient(180deg, rgba(6,10,18,0.16) 0%, rgba(6,10,18,0.10) 100%)",
                              }}
                            >
                              <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
                                {days.map((day) => {
                                  const hi = `${Math.round(day.maxTemp)}°`;
                                  const lo = `${Math.round(day.minTemp)}°`;
                                  const windUnit = temperatureUnit === "fahrenheit" ? "mph" : "km/h";
                                  const intensityLabel = weatherIntensityLabel(day.weatherCode);
                                  const dateLabel = new Date(day.date + "T12:00:00").toLocaleDateString([], {
                                    weekday: "long",
                                    month: "short",
                                    day: "numeric",
                                  });
                                  return (
                                    <Tooltip key={day.date}>
                                      <TooltipTrigger asChild>
                                        <div className="group/day w-full h-full flex flex-col items-center justify-center gap-1 py-2 px-2 rounded-md transition-all duration-200 hover:bg-white/[0.06] hover:-translate-y-0.5">
                                          <span className={cn("text-2xs font-medium leading-none", dayReadable ? "text-foreground/84" : "text-foreground/65")}>
                                            {forecastDayLabel(day.date)}
                                          </span>
                                          <span className="transition-transform duration-300 group-hover/day:scale-110">
                                            <AnimatedWeatherIcon code={day.weatherCode} size={30} moonPhaseValue={moon.phaseValue} />
                                          </span>
                                          <div className="flex items-baseline gap-1 leading-none">
                                            <span className="text-sm font-semibold text-foreground/84 tabular-nums">{hi}</span>
                                            <span className={cn("text-xs tabular-nums", dayReadable ? "text-foreground/72" : "text-foreground/45")}>{lo}</span>
                                          </div>
                                          {mergedHero.showForecastRainChance && day.chanceOfRain > 0 && (
                                            <div className="flex items-center gap-0.5 text-foreground/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">
                                              <Drop className="h-3 w-3 text-cyan-200/95" />
                                              <span className="text-2xs font-medium tabular-nums">{day.chanceOfRain}%</span>
                                            </div>
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <div className="space-y-1.5 text-xs min-w-[170px]">
                                          <p className="font-medium text-foreground">{dateLabel}</p>
                                          <p className="text-muted-foreground">{day.weatherDesc}</p>
                                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                                            <span>High</span>
                                            <span className="text-right text-foreground tabular-nums">{hi}</span>
                                            <span>Low</span>
                                            <span className="text-right text-foreground tabular-nums">{lo}</span>
                                            <span>Rain</span>
                                            <span className="text-right text-foreground tabular-nums">{day.chanceOfRain}%</span>
                                            {intensityLabel && (
                                              <>
                                                <span>Intensity</span>
                                                <span className="text-right text-foreground">{intensityLabel}</span>
                                              </>
                                            )}
                                            {day.windMax != null && (
                                              <>
                                                <span>Wind</span>
                                                <span className="text-right text-foreground tabular-nums">{Math.round(day.windMax)} {windUnit}</span>
                                              </>
                                            )}
                                            {day.humidityMean != null && (
                                              <>
                                                <span>Humidity</span>
                                                <span className="text-right text-foreground tabular-nums">{Math.round(day.humidityMean)}%</span>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </SpotlightCard>
                {isNight && mergedHero.showWeatherEffects && weather && !weatherLoading && moonTooltipPosition && (
                  <div
                    className="absolute z-20"
                    style={{
                      left: moonTooltipPosition.x,
                      top: moonTooltipPosition.y,
                      width: moonTooltipRadius * 2.2,
                      height: moonTooltipRadius * 2.2,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block w-full h-full pointer-events-auto cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {moon.phase} · {moon.illumination}%
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            ) : (
              <div className={cn("relative w-full", heroCardHeightClass)}>
                <div className="h-full rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.52)_0%,hsl(var(--background)/0.44)_100%)]" />
              </div>
            )}
          </div>

          <div className="min-h-0 row-start-2 border-r border-t border-border/50">
            <section className="h-full min-h-0 p-3">
              {deferredSectionsReady ? (
                <Suspense fallback={<div className="h-full rounded-md border border-border/45 bg-background/20" />}>
                  <ActivityMonitorSection embedded />
                </Suspense>
              ) : (
                <div className="h-full rounded-md border border-border/45 bg-background/20" />
              )}
            </section>
          </div>

          <aside className="min-h-0 row-span-2 row-start-1 col-start-2 border-l border-border/45 p-3 pt-2.5 pl-2.5">
            <div className="flex h-full min-h-0 flex-col gap-2.5">
              <section className={cn(
                "shrink-0",
                homePreset === "focus"
                  ? "h-[244px]"
                  : homePreset === "operations"
                    ? "h-[236px]"
                    : "h-[228px]",
              )}>
                {deferredSectionsReady ? (
                  <Suspense fallback={<div className="h-full rounded-md border border-border/45 bg-background/20" />}>
                    <HomeQuickActionsPanel className="h-full overflow-hidden rounded-md border border-border/45 bg-background/20" />
                  </Suspense>
                ) : (
                  <div className="h-full rounded-md border border-border/45 bg-background/20" />
                )}
              </section>

              <section className="shrink-0">
                <div
                  onDrop={handleHeroDrop}
                  onDragEnter={handleHeroDragEnter}
                  onDragOver={handleHeroDragOver}
                  onDragLeave={handleHeroDragLeave}
                  onClick={() => {
                    if (!heroImporting) void handleHeroImportPicker();
                  }}
                  onKeyDown={(e) => {
                    if (heroImporting) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleHeroImportPicker();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "relative h-[152px] cursor-pointer overflow-hidden rounded-md border border-border/45 px-4 py-4 transition-[border-color,background,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    heroDragOver
                      ? "border-primary/45 bg-[linear-gradient(180deg,hsl(var(--primary)/0.16)_0%,hsl(var(--card)/0.58)_56%,hsl(var(--background)/0.50)_100%)]"
                      : "bg-[linear-gradient(180deg,hsl(var(--card)/0.64)_0%,hsl(var(--background)/0.52)_100%)] hover:border-border/70",
                  )}
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_90%_at_12%_0%,rgba(108,172,255,0.14)_0%,rgba(108,172,255,0)_58%)]" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,22,0.06)_0%,rgba(7,12,22,0.16)_100%)]" />
                  <div className="relative z-10 flex h-full items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground/82">
                        Packet Capture Dropzone
                      </p>
                      <p className="mt-2 truncate text-base font-medium text-foreground/94">
                        {heroImporting ? "Importing capture..." : "Drop .pcap/.pcapng/.cap"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/82">
                        {heroImporting ? "Parsing and indexing packets now..." : "or select a file to import manually"}
                      </p>
                    </div>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border/45 bg-background/30 text-primary/90">
                      {heroImporting ? <Loader2 className="h-5 w-5 animate-spin text-warning" /> : <Upload className="h-5 w-5" />}
                    </span>
                  </div>
                </div>
              </section>

              <section className="flex min-h-[200px] flex-1 flex-col rounded-md border border-border/45 bg-[linear-gradient(180deg,hsl(var(--card)/0.58)_0%,hsl(var(--background)/0.44)_100%)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <StickyNote className="h-3.5 w-3.5 text-muted-foreground/78" />
                    <p className="truncate text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground/85">Quick Note</p>
                  </div>
                  <button
                    type="button"
                    onClick={openQuickNoteInNotes}
                    className="ui-control-shell inline-flex h-7 items-center gap-1.5 rounded-sm border border-border/45 px-2.5 text-2xs text-foreground/86 transition-[border-color,background,color] duration-200 hover:border-border/70 hover:bg-background/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    Open
                  </button>
                </div>
                <textarea
                  value={quickNoteText}
                  onChange={(e) => {
                    setQuickNoteText(e.target.value);
                    setQuickNoteDirty(true);
                  }}
                  placeholder="Write a persistent quick note..."
                  className="min-h-[120px] w-full flex-1 resize-none border border-border/35 bg-background/20 px-3 py-2 text-sm leading-relaxed text-foreground/92 outline-none transition placeholder:text-muted-foreground/65 focus-visible:border-primary/45"
                />
                <div className="mt-2 inline-flex h-7 w-full items-center justify-between px-1 text-xs">
                  <span className={cn(
                    "text-muted-foreground",
                    quickNoteError && "text-rose-300",
                  )}>
                    {quickNoteError
                      ? quickNoteError
                      : quickNoteSaving
                        ? "Saving..."
                        : quickNoteDirty
                          ? "Unsaved changes"
                          : "Saved"}
                  </span>
                  <span className="text-muted-foreground/80">{quickNoteText.length} chars</span>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>
      <ViewFooter>
        <ViewFooterItem className={cn("min-w-0", footerStatusTone)}>
          {heroImporting || quickNoteSaving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Activity className="h-3 w-3" />
          )}
          <span className="truncate">{footerStatusLine}</span>
        </ViewFooterItem>
        <ViewFooterSpacer />
      </ViewFooter>
    </div>
  );
}
