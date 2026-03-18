/**
 * DesignerPhoneMockup — Interactive SVG phone mockup for the Provision Designer.
 *
 * Renders an idle-state Yealink phone with clickable elements:
 * - Line keys, softkeys, accounts, programmable keys
 * - Hover highlights on interactive areas
 * - Clicking triggers onElementClick with the config prefix and a bounding rect
 *
 * Reuses useDeviceViewData + deviceLayouts for accurate rendering.
 * No call simulation — purely a visual config editor companion.
 */

import { useRef, useState, useCallback } from "react";
import { getDeviceLayout } from "./deviceLayouts";
import {
  useDeviceViewData,
  type KeyValue,
  type LineKeyConfig,
} from "./deviceViewData";
import type { DesignerEditTarget } from "./DesignerEditPopover";

// ── Colors (same as DeviceView) ─────────────────────────────────────────────

const COLORS = {
  chassis: "#1a1d21",
  chassisHighlight: "#2a2d32",
  screen: "#1e3a2f",
  screenBorder: "#0a0c0e",
  screenText: "#b8e0c8",
  screenTextDim: "#5a8068",
  button: "#2a2d32",
  buttonBorder: "#3a3d42",
  buttonText: "#d0d0d0",
  buttonTextDim: "#808080",
  softkey: "#1f2226",
  softkeyBorder: "#3a3d42",
  softkeyText: "#a0a0a0",
  ledOff: "#2a2a2a",
  ledGreen: "#22c55e",
  hoverRing: "rgba(99,179,237,0.5)",
  hoverFill: "rgba(99,179,237,0.08)",
};

// ── Props ───────────────────────────────────────────────────────────────────

interface DesignerPhoneMockupProps {
  modelId: string;
  parsedEntries: KeyValue[];
  onElementClick: (target: DesignerEditTarget, anchorRect: DOMRect) => void;
}

// ── Interactive wrapper ─────────────────────────────────────────────────────

function ClickableArea({
  target,
  x,
  y,
  width,
  height,
  svgRef,
  onClick,
  children,
}: {
  target: DesignerEditTarget;
  x: number;
  y: number;
  width: number;
  height: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onClick: (target: DesignerEditTarget, rect: DOMRect) => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<SVGGElement>(null);

  const handleClick = useCallback(() => {
    if (!groupRef.current || !svgRef.current) return;
    // Get the bounding rect relative to the viewport
    const rect = groupRef.current.getBoundingClientRect();
    onClick(target, rect);
  }, [target, onClick, svgRef]);

  return (
    <g
      ref={groupRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      style={{ cursor: "pointer" }}
    >
      {children}
      {/* Hover highlight overlay */}
      {hovered && (
        <rect
          x={x - 1}
          y={y - 1}
          width={width + 2}
          height={height + 2}
          rx={3}
          fill={COLORS.hoverFill}
          stroke={COLORS.hoverRing}
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

// ── LED ─────────────────────────────────────────────────────────────────────

function Led({ cx, cy, status, size = 5 }: { cx: number; cy: number; status: string; size?: number }) {
  const color = status === "green" ? COLORS.ledGreen : COLORS.ledOff;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={size / 2}
      fill={color}
      style={status !== "off" ? { filter: `drop-shadow(0 0 2px ${color})` } : undefined}
    />
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function DesignerPhoneMockup({ modelId, parsedEntries, onElementClick }: DesignerPhoneMockupProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = getDeviceLayout(modelId);
  const [page, setPage] = useState(1);
  const data = useDeviceViewData(parsedEntries, layout, false, page);

  // ── Dimensions (same logic as DeviceView) ──
  const hasLeftKeys = layout.lineKeyPosition === "both" || layout.lineKeyPosition === "left";
  const hasRightKeys = layout.lineKeyPosition === "both" || layout.lineKeyPosition === "right";
  const isTouchscreen = layout.lineKeyPosition === "touchscreen";
  const isGrayscale = layout.screenType === "grayscale";

  const rawArea = layout.screenWidth * layout.screenHeight;
  const SCALE = rawArea > 200000 ? 0.44 : rawArea > 80000 ? 0.54 : rawArea > 40000 ? 0.62 : 0.75;
  const screenWidth = Math.min(360, Math.max(110, Math.round(layout.screenWidth * SCALE)));
  const screenHeight = Math.min(230, Math.max(50, Math.round(layout.screenHeight * SCALE)));
  const sizeRatio = screenWidth / 200;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const keyButtonWidth = Math.round(70 * clamp(sizeRatio, 0.6, 1.4));
  const keyButtonHeight = Math.round(24 * clamp(sizeRatio, 0.6, 1.4));
  const keyButtonGap = Math.round(5 * clamp(sizeRatio, 0.6, 1.4));
  const keyColumnWidth = keyButtonWidth + Math.round(16 * clamp(sizeRatio, 0.7, 1.2));

  const leftColumnWidth = hasLeftKeys ? keyColumnWidth : 0;
  const rightColumnWidth = hasRightKeys ? keyColumnWidth : 0;

  const softkeyHeight = Math.round(18 * clamp(sizeRatio, 0.7, 1.3));
  const softkeyGap = Math.round(3 * clamp(sizeRatio, 0.8, 1.2));
  const chassisPadding = Math.round(18 * clamp(sizeRatio, 0.7, 1.3));

  const touchKeysPerPage = isTouchscreen && layout.totalLineKeys > 0
    ? Math.ceil(layout.totalLineKeys / Math.max(1, layout.lineKeyPages))
    : 0;
  const touchPanelWidth = isTouchscreen && touchKeysPerPage > 0
    ? Math.round(screenWidth * 0.38) : 0;
  const touchPageKeys = isTouchscreen && touchKeysPerPage > 0
    ? data.lineKeys.slice((data.currentPage - 1) * touchKeysPerPage, data.currentPage * touchKeysPerPage)
    : [];

  const totalWidth = leftColumnWidth + screenWidth + rightColumnWidth + chassisPadding * 2;
  const keysAreaHeight = layout.keysPerSide * (keyButtonHeight + keyButtonGap);
  const physicalSoftkeyArea = isTouchscreen ? 0 : (Math.round(8 * sizeRatio) + softkeyHeight + Math.round(18 * sizeRatio));
  const screenAreaHeight = screenHeight + physicalSoftkeyArea;
  const totalHeight = Math.max(screenAreaHeight + chassisPadding * 2, keysAreaHeight + chassisPadding * 2 + 16);

  const screenX = leftColumnWidth + chassisPadding;
  const screenY = chassisPadding;

  const softkeyWidth = (screenWidth - (layout.softkeyCount - 1) * softkeyGap) / layout.softkeyCount;
  const softkeyY = screenY + screenHeight + Math.round(8 * sizeRatio);

  const keysPerSide = layout.keysPerSide;
  const totalKeysHeight = keysPerSide * (keyButtonHeight + keyButtonGap) - keyButtonGap;
  const keyStartY = Math.max(screenY, (totalHeight - totalKeysHeight) / 2);
  const leftKeyX = hasLeftKeys ? (leftColumnWidth - keyButtonWidth) / 2 : 0;
  const rightKeyX = leftColumnWidth + chassisPadding * 2 + screenWidth + (rightColumnWidth - keyButtonWidth) / 2;

  const leftKeys = hasLeftKeys && !hasRightKeys
    ? data.currentPageLineKeys
    : data.currentPageLineKeys.slice(0, keysPerSide);
  const rightKeys = hasRightKeys && !hasLeftKeys
    ? data.currentPageLineKeys
    : data.currentPageLineKeys.slice(keysPerSide, keysPerSide * 2);

  // Softkey labels (idle, first page)
  const softkeyLabels = data.idleSoftkeyPages[0] ?? [];

  // ── Font sizes ──
  const keyLabelFs = Math.max(5, Math.min(8, keyButtonHeight * 0.36));
  const keyTypeFs = Math.max(4, Math.min(6, keyButtonHeight * 0.26));
  const softkeyFs = Math.max(5, Math.min(7.5, softkeyHeight * 0.45));
  const screenFs = Math.max(5, Math.min(9, screenHeight * 0.05));
  const mainContentWidth = screenWidth - touchPanelWidth;

  // Render a single line key button (left or right side)
  function renderLineKey(key: LineKeyConfig, x: number, y: number, ledPosition: "left" | "right") {
    const ledX = ledPosition === "left" ? x - 6 : x + keyButtonWidth + 6;
    const labelX = x + keyButtonWidth / 2;
    const labelY = y + keyButtonHeight * 0.42;
    const typeY = y + keyButtonHeight * 0.76;

    return (
      <ClickableArea
        key={`lk-${key.index}`}
        target={{ type: "linekey", index: key.index, configPrefix: `linekey.${key.index}` }}
        x={x}
        y={y}
        width={keyButtonWidth}
        height={keyButtonHeight}
        svgRef={svgRef}
        onClick={onElementClick}
      >
        <rect x={x} y={y} width={keyButtonWidth} height={keyButtonHeight} rx={3}
          fill={key.isConfigured ? COLORS.button : COLORS.chassis} stroke={COLORS.buttonBorder} strokeWidth={1}
        />
        <Led cx={ledX} cy={y + keyButtonHeight / 2} status={key.ledStatus} />
        <text x={labelX} y={labelY} textAnchor="middle" fill={key.isConfigured ? COLORS.buttonText : COLORS.buttonTextDim}
          fontSize={keyLabelFs} fontWeight={500}
        >
          {key.displayLabel.length > 10 ? key.displayLabel.slice(0, 10) + "…" : key.displayLabel}
        </text>
        {key.isConfigured && (
          <text x={labelX} y={typeY} textAnchor="middle" fill={COLORS.buttonTextDim} fontSize={keyTypeFs}>
            {key.typeShortName}
          </text>
        )}
      </ClickableArea>
    );
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      className="w-full"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      {/* Phone chassis */}
      <rect x={0} y={0} width={totalWidth} height={totalHeight} rx={12} fill={COLORS.chassis} />
      <rect x={2} y={2} width={totalWidth - 4} height={totalHeight - 4} rx={10}
        fill="none" stroke={COLORS.chassisHighlight} strokeWidth={1}
      />

      {/* ── Screen ── */}
      <defs>
        <clipPath id={`dpm-screen-clip`}>
          <rect x={screenX} y={screenY} width={screenWidth} height={screenHeight} rx={4} />
        </clipPath>
      </defs>
      <rect x={screenX} y={screenY} width={screenWidth} height={screenHeight} rx={4}
        fill={isGrayscale ? "#8a9a82" : COLORS.screen} stroke={COLORS.screenBorder} strokeWidth={1.5}
      />

      {/* Screen content */}
      <g clipPath={`url(#dpm-screen-clip)`}>
        {/* Status bar */}
        <rect x={screenX} y={screenY} width={mainContentWidth} height={Math.round(12 * sizeRatio)}
          fill="rgba(0,0,0,0.2)"
        />
        <text x={screenX + 4} y={screenY + Math.round(9 * sizeRatio)} fill={COLORS.screenTextDim}
          fontSize={Math.max(4, Math.round(5 * sizeRatio))}
        >
          {data.networkIp || "0.0.0.0"}
        </text>

        {/* Time/Date (clickable) */}
        <ClickableArea
          target={{ type: "time", index: 0, configPrefix: "local_time" }}
          x={screenX + 4}
          y={screenY + Math.round(16 * sizeRatio)}
          width={mainContentWidth - 8}
          height={Math.round(20 * sizeRatio)}
          svgRef={svgRef}
          onClick={onElementClick}
        >
          <text x={screenX + mainContentWidth / 2} y={screenY + Math.round(28 * sizeRatio)}
            textAnchor="middle" fill={COLORS.screenText} fontSize={Math.max(7, screenFs * 1.4)} fontWeight={600}
          >
            {data.timeStr}
          </text>
          <text x={screenX + mainContentWidth / 2} y={screenY + Math.round(38 * sizeRatio)}
            textAnchor="middle" fill={COLORS.screenTextDim} fontSize={Math.max(4.5, screenFs * 0.75)}
          >
            {data.dateStr}
          </text>
        </ClickableArea>

        {/* Account lines (clickable) */}
        {data.accounts.slice(0, 4).map((acc, i) => {
          const accY = screenY + Math.round((44 + i * 14) * sizeRatio);
          const accH = Math.round(12 * sizeRatio);
          return (
            <ClickableArea
              key={`acc-${acc.index}`}
              target={{ type: "account", index: acc.index, configPrefix: `account.${acc.index}` }}
              x={screenX + 3}
              y={accY}
              width={mainContentWidth - 6}
              height={accH}
              svgRef={svgRef}
              onClick={onElementClick}
            >
              <circle cx={screenX + 8} cy={accY + accH / 2} r={2.5}
                fill={acc.isRegistered ? COLORS.ledGreen : COLORS.ledOff}
              />
              <text x={screenX + 15} y={accY + accH * 0.72} fill={COLORS.screenText}
                fontSize={Math.max(4.5, screenFs * 0.72)}
              >
                {acc.displayLabel.length > 22 ? acc.displayLabel.slice(0, 22) + "…" : acc.displayLabel}
              </text>
            </ClickableArea>
          );
        })}

        {/* Softkey labels on screen */}
        {softkeyLabels.map((label, i) => {
          const skX = screenX + i * (softkeyWidth + softkeyGap);
          const skY = screenY + screenHeight - Math.round(10 * sizeRatio);
          const isDash = !label || label === "—" || label === "-";
          const labelNode = (
            <text
              key={`skl-text-${i}`}
              x={skX + softkeyWidth / 2}
              y={skY + Math.round(7 * sizeRatio)}
              textAnchor="middle"
              fill={label && label !== "—" ? COLORS.screenText : COLORS.screenTextDim}
              fontSize={Math.max(4, softkeyFs * 0.75)}
            >
              {label || "—"}
            </text>
          );
          if (isDash) {
            return labelNode;
          }
          return (
            <ClickableArea
              key={`skl-${i}`}
              target={{ type: "softkey", index: i + 1, configPrefix: `softkey.${i + 1}` }}
              x={skX}
              y={skY - Math.round(8 * sizeRatio)}
              width={softkeyWidth}
              height={Math.round(10 * sizeRatio)}
              svgRef={svgRef}
              onClick={onElementClick}
            >
              {labelNode}
            </ClickableArea>
          );
        })}

        {/* Touchscreen DSS panel */}
        {isTouchscreen && touchPageKeys.length > 0 && (() => {
          const panelX = screenX + screenWidth - touchPanelWidth;
          const tkPad = Math.round(4 * sizeRatio);
          const tkH = Math.max(14, Math.round((screenHeight - tkPad * 2) / Math.max(touchPageKeys.length, 1) - 1));
          const tkFs = Math.max(5, Math.min(9, tkH * 0.42));
          return (
            <g>
              <rect x={panelX} y={screenY} width={touchPanelWidth} height={screenHeight}
                fill="rgba(10,14,18,0.85)"
              />
              {touchPageKeys.map((key, i) => {
                const tkY = screenY + tkPad + i * (tkH + 1);
                return (
                  <ClickableArea
                    key={`tk-${key.index}`}
                    target={{ type: "linekey", index: key.index, configPrefix: `linekey.${key.index}` }}
                    x={panelX + tkPad}
                    y={tkY}
                    width={touchPanelWidth - tkPad * 2}
                    height={tkH}
                    svgRef={svgRef}
                    onClick={onElementClick}
                  >
                    <rect x={panelX + tkPad} y={tkY} width={touchPanelWidth - tkPad * 2} height={tkH}
                      rx={2} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
                    />
                    <circle cx={panelX + tkPad + 6} cy={tkY + tkH / 2} r={2}
                      fill={key.isConfigured ? COLORS.ledGreen : COLORS.ledOff}
                    />
                    <text x={panelX + tkPad + 14} y={tkY + tkH * 0.65} fill="#c0d0c8" fontSize={tkFs * 0.85}>
                      {key.displayLabel.length > 8 ? key.displayLabel.slice(0, 8) + "…" : key.displayLabel}
                    </text>
                  </ClickableArea>
                );
              })}
            </g>
          );
        })()}
      </g>

      {/* ── Page tabs (for multi-page line keys) ── */}
      {data.totalPages > 1 && !isTouchscreen && (
        <g>
          {Array.from({ length: data.totalPages }, (_, p) => {
            const tabW = Math.round(20 * sizeRatio);
            const tabH = Math.round(10 * sizeRatio);
            const tabX = screenX + (p * (tabW + 2));
            const tabY = keyStartY - tabH - 3;
            const isActive = p + 1 === page;
            return (
              <g key={`page-${p}`} onClick={() => setPage(p + 1)} style={{ cursor: "pointer" }}>
                <rect x={tabX} y={tabY} width={tabW} height={tabH} rx={2}
                  fill={isActive ? "rgba(99,179,237,0.15)" : "rgba(255,255,255,0.04)"}
                  stroke={isActive ? "rgba(99,179,237,0.4)" : "rgba(255,255,255,0.1)"} strokeWidth={0.5}
                />
                <text x={tabX + tabW / 2} y={tabY + tabH * 0.72} textAnchor="middle"
                  fill={isActive ? "#93c5fd" : COLORS.buttonTextDim} fontSize={Math.max(4, tabH * 0.6)}
                >
                  {p + 1}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Touchscreen page nav */}
      {isTouchscreen && data.totalPages > 1 && (
        <g>
          {Array.from({ length: data.totalPages }, (_, p) => {
            const dotR = 3;
            const dotGap = 10;
            const totalDotsW = data.totalPages * dotGap;
            const dotX = screenX + screenWidth - touchPanelWidth / 2 - totalDotsW / 2 + p * dotGap;
            const dotY = screenY + screenHeight - 6;
            const isActive = p + 1 === page;
            return (
              <circle key={`tp-${p}`} cx={dotX} cy={dotY} r={dotR}
                fill={isActive ? "#93c5fd" : "rgba(255,255,255,0.2)"}
                onClick={() => setPage(p + 1)} style={{ cursor: "pointer" }}
              />
            );
          })}
        </g>
      )}

      {/* ── Left side line keys ── */}
      {hasLeftKeys && leftKeys.map((key, i) =>
        renderLineKey(key, leftKeyX, keyStartY + i * (keyButtonHeight + keyButtonGap), "left")
      )}

      {/* ── Right side line keys ── */}
      {hasRightKeys && rightKeys.map((key, i) =>
        renderLineKey(key, rightKeyX, keyStartY + i * (keyButtonHeight + keyButtonGap), "right")
      )}

      {/* ── Softkeys (physical buttons for non-touch models only) ── */}
      {!isTouchscreen && softkeyLabels.map((label, i) => {
        const skX = screenX + i * (softkeyWidth + softkeyGap);
        const isDash = !label || label === "—" || label === "-";
        if (isDash) {
          return (
            <rect key={`sk-${i}`} x={skX} y={softkeyY} width={softkeyWidth} height={softkeyHeight}
              rx={2} fill={COLORS.softkey} stroke={COLORS.softkeyBorder} strokeWidth={0.5}
            />
          );
        }
        return (
          <ClickableArea
            key={`sk-${i}`}
            target={{ type: "softkey", index: i + 1, configPrefix: `softkey.${i + 1}` }}
            x={skX}
            y={softkeyY}
            width={softkeyWidth}
            height={softkeyHeight}
            svgRef={svgRef}
            onClick={onElementClick}
          >
            <rect x={skX} y={softkeyY} width={softkeyWidth} height={softkeyHeight}
              rx={2} fill={COLORS.softkey} stroke={COLORS.softkeyBorder} strokeWidth={0.5}
            />
          </ClickableArea>
        );
      })}
    </svg>
  );
}
