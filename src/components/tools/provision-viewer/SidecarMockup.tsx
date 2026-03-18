/**
 * SidecarMockup — SVG visual representation of Yealink expansion modules (EXP40/EXP43/EXP50).
 *
 * Renders a vertical sidecar panel with:
 * - 20 programmable keys per page (10 per column, 2 columns)
 * - Dual-color LED indicators per key
 * - LCD label area next to each key
 * - Page tabs for multi-page navigation
 * - Softkey row at bottom (for color LCD models)
 *
 * Keys are filled from provision data (linekey overflow beyond the phone's native count).
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SidecarUnit } from "./deviceViewData";
import { DSS_KEY_TYPES, type LineKeyConfig } from "./deviceViewData";

// ── Colors ─────────────────────────────────────────────────────────────────

const C = {
  chassis: "#1e2024",
  chassisBorder: "#303338",
  screen: "#161a1e",
  screenBorder: "#0d0f12",
  keyBg: "#26292e",
  keyBorder: "#3a3d44",
  keyBorderHover: "#5a8068",
  keyText: "#c8ccd0",
  keyTextDim: "#6b7280",
  label: "#94a3b8",
  ledOff: "#2a2a2a",
  ledGreen: "#22c55e",
  ledRed: "#ef4444",
  ledAmber: "#f59e0b",
  pageBg: "#2a2d32",
  pageActive: "#3b82f6",
  pageText: "#94a3b8",
  pageTextActive: "#ffffff",
  titleText: "#e2e8f0",
  subtitleText: "#64748b",
  separator: "#2a2d33",
  // Contact speed dial (unassigned keys auto-populated from contacts)
  contactBg: "#1f2228",
  contactBorder: "#2e3138",
  contactText: "#5a6070",
  contactIcon: "#4b5563",
};

// ── Layout constants ───────────────────────────────────────────────────────

const KEY_ROWS = 10;
const KEY_W = 68;
const KEY_H = 22;
const KEY_GAP_X = 10;
const KEY_GAP_Y = 4;
const LED_R = 3;
const MARGIN_X = 12;
const MARGIN_TOP = 44;
const PAGE_TAB_H = 24;
const BOTTOM_PAD = 14;

function getUnitWidth(unit: SidecarUnit): number {
  // Color LCD sidecars (EXP43/EXP50) are visually wider than legacy grayscale modules.
  return unit.layout.screenType === "color" ? 192 : 176;
}

function getUnitHeight(): number {
  return MARGIN_TOP + PAGE_TAB_H + 6 + KEY_ROWS * (KEY_H + KEY_GAP_Y) + BOTTOM_PAD;
}

// ── LED color ──────────────────────────────────────────────────────────────

function ledColor(key: LineKeyConfig): string {
  if (!key.isConfigured) return C.ledOff;
  switch (key.ledStatus) {
    case "green": return C.ledGreen;
    case "red": return C.ledRed;
    case "amber": return C.ledAmber;
    default: return C.ledOff;
  }
}

// ── Single key ─────────────────────────────────────────────────────────────

function SidecarKey({
  keyConfig,
  x,
  y,
}: {
  keyConfig: LineKeyConfig;
  x: number;
  y: number;
}) {
  const typeInfo = DSS_KEY_TYPES[keyConfig.type];
  const typeBadge = typeInfo?.shortName ?? "";
  const isContact = !!keyConfig.contactSpeedDial;

  return (
    <g>
      {/* LED */}
      <circle
        cx={x - LED_R - 3}
        cy={y + KEY_H / 2}
        r={LED_R}
        fill={isContact ? C.contactIcon : ledColor(keyConfig)}
        opacity={isContact ? 0.25 : keyConfig.isConfigured ? 1 : 0.3}
      />
      {keyConfig.isConfigured && keyConfig.ledStatus === "green" && (
        <circle
          cx={x - LED_R - 3}
          cy={y + KEY_H / 2}
          r={LED_R + 2}
          fill={C.ledGreen}
          opacity={0.15}
        />
      )}

      {/* Key button */}
      <rect
        x={x}
        y={y}
        width={KEY_W}
        height={KEY_H}
        rx={3}
        fill={isContact ? C.contactBg : keyConfig.isConfigured ? C.keyBg : C.chassis}
        stroke={isContact ? C.contactBorder : keyConfig.isConfigured ? C.keyBorder : C.separator}
        strokeWidth={0.5}
        strokeDasharray={isContact ? "2 1.5" : undefined}
      />

      {/* Contact speed dial icon (small person silhouette) */}
      {isContact && (
        <g transform={`translate(${x + 4}, ${y + KEY_H / 2 - 4})`} opacity={0.35}>
          <circle cx={3.5} cy={2} r={2} fill={C.contactIcon} />
          <path d="M0 7.5 C0 5.5 2 4.5 3.5 4.5 S7 5.5 7 7.5" fill={C.contactIcon} />
        </g>
      )}

      {/* Type badge (small, top-left inside the key) */}
      {!isContact && keyConfig.isConfigured && typeBadge && typeBadge !== "—" && (
        <text
          x={x + 4}
          y={y + 8}
          fontSize={6}
          fill={C.keyTextDim}
          fontFamily="monospace"
        >
          {typeBadge}
        </text>
      )}

      {/* Display label */}
      <text
        x={isContact ? x + 14 : x + KEY_W / 2}
        y={y + KEY_H / 2 + ((!isContact && keyConfig.isConfigured && typeBadge && typeBadge !== "—") ? 3 : 1)}
        textAnchor={isContact ? "start" : "middle"}
        fontSize={isContact ? 7 : keyConfig.isConfigured ? 8.5 : 7}
        fill={isContact ? C.contactText : keyConfig.isConfigured ? C.keyText : C.keyTextDim}
        fontFamily="system-ui, sans-serif"
        fontWeight={keyConfig.isConfigured ? 500 : 400}
        fontStyle={isContact ? "italic" : undefined}
      >
        {keyConfig.displayLabel.length > 10
          ? keyConfig.displayLabel.slice(0, 9) + "…"
          : keyConfig.displayLabel}
      </text>
    </g>
  );
}

// ── Single sidecar unit ────────────────────────────────────────────────────

function SidecarUnitView({
  unit,
  offsetX,
}: {
  unit: SidecarUnit;
  offsetX: number;
}) {
  const [page, setPage] = useState(1);
  const totalPages = unit.layout.pages;
  const keysPerPage = unit.layout.keysPerPage;

  // Get keys for current page
  const pageKeys = useMemo(() => {
    const startIdx = (page - 1) * keysPerPage;
    return unit.keys.slice(startIdx, startIdx + keysPerPage);
  }, [unit.keys, page, keysPerPage]);

  const unitH = getUnitHeight();
  const unitW = getUnitWidth(unit);

  return (
    <g transform={`translate(${offsetX}, 0)`}>
      {/* Chassis */}
      <rect
        x={0}
        y={0}
        width={unitW}
        height={unitH}
        rx={6}
        fill={C.chassis}
        stroke={C.chassisBorder}
        strokeWidth={1}
      />

      {/* Title */}
      <text
        x={unitW / 2}
        y={16}
        textAnchor="middle"
        fontSize={9}
        fill={C.titleText}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
      >
        {unit.layout.name}
      </text>
      <text
        x={unitW / 2}
        y={27}
        textAnchor="middle"
        fontSize={7}
        fill={C.subtitleText}
        fontFamily="system-ui, sans-serif"
      >
        Unit {unit.unitIndex} · {unit.configuredCount} assigned · {unit.keys.filter(k => !!k.contactSpeedDial).length} contacts
      </text>

      {/* Screen area (dark inset) */}
      <rect
        x={4}
        y={34}
        width={unitW - 8}
        height={unitH - 34 - 6}
        rx={3}
        fill={C.screen}
        stroke={C.screenBorder}
        strokeWidth={0.5}
      />

      {/* Page tabs */}
      {totalPages > 1 && (
        <g>
          {Array.from({ length: totalPages }, (_, pi) => {
            const tabW = (unitW - 16) / totalPages;
            const tx = 8 + pi * tabW;
            const isActive = pi + 1 === page;
            return (
              <g
                key={pi}
                onClick={() => setPage(pi + 1)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={tx}
                  y={MARGIN_TOP - 4}
                  width={tabW - 2}
                  height={PAGE_TAB_H - 4}
                  rx={3}
                  fill={isActive ? C.pageActive : C.pageBg}
                  opacity={isActive ? 1 : 0.6}
                />
                <text
                  x={tx + (tabW - 2) / 2}
                  y={MARGIN_TOP - 4 + (PAGE_TAB_H - 4) / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isActive ? C.pageTextActive : C.pageText}
                  fontWeight={isActive ? 600 : 400}
                  fontFamily="system-ui, sans-serif"
                >
                  Page {pi + 1}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Keys grid: 2 columns × 10 rows */}
      {pageKeys.map((key, idx) => {
        const col = idx < KEY_ROWS ? 0 : 1;
        const row = idx < KEY_ROWS ? idx : idx - KEY_ROWS;
        const centerXOffset = Math.max(0, (unitW - 2 * MARGIN_X - 2 * KEY_W - KEY_GAP_X) / 2);
        const kx = MARGIN_X + centerXOffset + LED_R * 2 + 4 + col * (KEY_W + KEY_GAP_X);
        const ky = MARGIN_TOP + PAGE_TAB_H + 4 + row * (KEY_H + KEY_GAP_Y);
        return <SidecarKey key={key.index} keyConfig={key} x={kx} y={ky} />;
      })}
    </g>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface SidecarMockupProps {
  units: SidecarUnit[];
  className?: string;
}

export function SidecarMockup({ units, className }: SidecarMockupProps) {
  if (units.length === 0) return null;

  const unitH = getUnitHeight();
  const gap = 8;
  const totalW = units.reduce((sum, unit, idx) => {
    const w = getUnitWidth(unit);
    return sum + w + (idx > 0 ? gap : 0);
  }, 0);

  return (
    <svg
      viewBox={`0 0 ${totalW} ${unitH}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("w-full", className)}
    >
      {units.map((unit, i) => (
        <SidecarUnitView
          key={unit.unitIndex}
          unit={unit}
          offsetX={units.slice(0, i).reduce((sum, u) => sum + getUnitWidth(u), 0) + i * gap}
        />
      ))}
    </svg>
  );
}

/** Intrinsic aspect ratio (width/height) of the sidecar SVG for a given number of units */
export function getSidecarAspectRatio(unitCount: number): number {
  const unitH = getUnitHeight();
  const gap = 8;
  // Use representative width (EXP43/EXP50 default) for layout estimation.
  const representativeUnitW = 192;
  const totalW = unitCount * representativeUnitW + (unitCount - 1) * gap;
  return totalW / unitH;
}
