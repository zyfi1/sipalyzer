/**
 * SIPalyzer custom theme for Monaco Editor.
 *
 * Derives all colors from the app's CSS design-system variables so the
 * editor sits seamlessly within the glassmorphism UI.  Hex values are
 * resolved once at registration time via getComputedStyle.
 */
import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

export const MONACO_THEME_NAME = "sipalyzer";

/* ── HSL → Hex helpers (shared with terminal theme) ──────────── */

/**
 * Convert an HSL triple string ("240 22% 5%") to a "#rrggbb" hex string.
 * Accepts the bare format stored in :root CSS variables.
 */
export function hslToHex(hslTriple: string): string {
  const parts = hslTriple.trim().split(/\s+/);
  if (parts.length < 3) return "#000000";
  const h = parseFloat(parts[0]!) / 360;
  const s = parseFloat(parts[1]!) / 100;
  const l = parseFloat(parts[2]!) / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (n: number) =>
    Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Strip "#" prefix for Monaco token rules (they expect bare "RRGGBB"). */
function bare(hex: string): string {
  return hex.startsWith("#") ? hex.slice(1) : hex;
}

/** Read a CSS custom property from :root. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Resolve a CSS HSL variable to hex, with a fallback. */
function resolveHsl(name: string, fallback: string): string {
  const v = cssVar(name);
  return v ? hslToHex(v) : fallback;
}

/** Read a CSS hex-value variable (like --color-chart-*), with fallback. */
function resolveHex(name: string, fallback: string): string {
  const v = cssVar(name);
  return v || fallback;
}

/** Append hex opacity suffix (e.g. "40" for ~25%). */
function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

/* ── Theme builder ───────────────────────────────────────────── */

function buildTheme(): editor.IStandaloneThemeData {
  const bg = resolveHsl("--terminal-bg", "#0a0d14");
  const fg = resolveHsl("--foreground", "#f5f6f8");
  const card = resolveHsl("--card", "#1e2433");
  const border = resolveHsl("--border", "#313a50");
  const accent = resolveHsl("--accent", "#2e3a54");
  const muted = resolveHsl("--muted", "#2b3347");
  const mutedFg = resolveHsl("--muted-foreground", "#8b92a8");
  const primary = resolveHsl("--primary", "#6b8dd6");
  const success = resolveHsl("--success", "#45c890");
  const warning = resolveHsl("--warning", "#e8a73a");
  const destructive = resolveHsl("--destructive", "#d94f4f");

  const chartCyan = resolveHex("--color-chart-cyan", "#22d3ee");
  const chartGreen = resolveHex("--color-chart-green", "#34d399");
  const chartPurple = resolveHex("--color-chart-purple", "#a78bfa");
  const chartOrange = resolveHex("--color-chart-orange", "#fb923c");
  const chartYellow = resolveHex("--color-chart-yellow", "#fbbf24");
  const chartRed = resolveHex("--color-chart-red", "#f87171");

  return {
    base: "vs-dark",
    inherit: true,
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": border,
      "editor.selectionBackground": accent,
      "editor.selectionHighlightBackground": withAlpha(muted, "80"),
      "editor.inactiveSelectionBackground": withAlpha(muted, "60"),
      "editor.wordHighlightBackground": withAlpha(accent, "CC"),
      "editor.wordHighlightStrongBackground": withAlpha(accent, "CC"),
      "editor.findMatchBackground": withAlpha(chartYellow, "60"),
      "editor.findMatchHighlightBackground": withAlpha(chartYellow, "30"),
      "editor.findRangeHighlightBackground": withAlpha(muted, "60"),
      "editor.hoverHighlightBackground": withAlpha(muted, "80"),
      "editor.rangeHighlightBackground": withAlpha(muted, "40"),

      "editorCursor.foreground": fg,
      "editorLineNumber.foreground": mutedFg,
      "editorLineNumber.activeForeground": fg,

      "editorIndentGuide.background": withAlpha(mutedFg, "30"),
      "editorIndentGuide.activeBackground": withAlpha(mutedFg, "70"),
      "editorRuler.foreground": "#FFFFFF1A",
      "editorCodeLens.foreground": mutedFg,
      "editorWhitespace.foreground": withAlpha(mutedFg, "40"),

      "editorGutter.background": bg,
      "editorGutter.modifiedBackground": withAlpha(warning, "CC"),
      "editorGutter.addedBackground": withAlpha(success, "CC"),
      "editorGutter.deletedBackground": withAlpha(destructive, "CC"),

      "editorError.foreground": destructive,
      "editorWarning.foreground": warning,

      "editorWidget.background": card,
      "editorWidget.border": border,
      "editorSuggestWidget.background": card,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.foreground": fg,
      "editorSuggestWidget.highlightForeground": chartCyan,
      "editorSuggestWidget.selectedBackground": accent,

      "editorHoverWidget.background": card,
      "editorHoverWidget.border": border,

      "editorOverviewRuler.border": card,
      "editorOverviewRuler.currentContentForeground": success,
      "editorOverviewRuler.incomingContentForeground": primary,
      "editorOverviewRuler.commonContentForeground": mutedFg,
      "editorOverviewRuler.modifiedForeground": withAlpha(warning, "CC"),
      "editorOverviewRuler.addedForeground": withAlpha(success, "CC"),
      "editorOverviewRuler.deletedForeground": withAlpha(destructive, "CC"),
      "editorOverviewRuler.errorForeground": withAlpha(destructive, "CC"),
      "editorOverviewRuler.warningForeground": withAlpha(warning, "CC"),

      "diffEditor.insertedTextBackground": withAlpha(success, "18"),
      "diffEditor.removedTextBackground": withAlpha(destructive, "25"),

      "scrollbar.shadow": bg,
      "scrollbarSlider.background": withAlpha(mutedFg, "30"),
      "scrollbarSlider.hoverBackground": withAlpha(mutedFg, "50"),
      "scrollbarSlider.activeBackground": mutedFg,

      "input.background": bg,
      "input.border": border,
      "input.foreground": fg,
      "input.placeholderForeground": mutedFg,

      "minimap.background": bg,

      "list.activeSelectionBackground": accent,
      "list.hoverBackground": withAlpha(muted, "75"),
      "list.focusBackground": card,
      "list.highlightForeground": chartCyan,

      "focusBorder": primary,

      "editorBracketHighlight.foreground1": primary,
      "editorBracketHighlight.foreground2": chartOrange,
      "editorBracketHighlight.foreground3": chartCyan,
      "editorBracketHighlight.foreground4": chartGreen,
      "editorBracketHighlight.foreground5": chartPurple,
      "editorBracketHighlight.foreground6": chartYellow,
      "editorBracketHighlight.unexpectedBracket.foreground": destructive,

      "peekView.border": border,
      "peekViewEditor.background": bg,
      "peekViewResult.background": card,
      "peekViewResult.fileForeground": fg,
      "peekViewResult.lineForeground": fg,
      "peekViewResult.matchHighlightBackground": withAlpha(chartYellow, "60"),
      "peekViewResult.selectionBackground": accent,
      "peekViewResult.selectionForeground": fg,
      "peekViewTitle.background": card,
      "peekViewTitleDescription.foreground": fg,
      "peekViewTitleLabel.foreground": fg,
    },
    rules: [
      { token: "", foreground: bare(fg), background: bare(bg) },

      // Comments — muted, italic
      { token: "comment", foreground: bare(mutedFg), fontStyle: "italic" },
      { token: "comment.line", foreground: bare(mutedFg), fontStyle: "italic" },
      { token: "comment.block", foreground: bare(mutedFg), fontStyle: "italic" },

      // Strings — green
      { token: "string", foreground: bare(chartGreen) },
      { token: "string.quoted", foreground: bare(chartGreen) },
      { token: "string.template", foreground: bare(chartGreen) },
      { token: "string.regexp", foreground: bare(chartYellow) },

      // Numbers — purple
      { token: "number", foreground: bare(chartPurple) },
      { token: "number.float", foreground: bare(chartPurple) },
      { token: "number.hex", foreground: bare(chartPurple) },

      // Constants
      { token: "constant", foreground: bare(chartPurple) },
      { token: "constant.language", foreground: bare(primary) },
      { token: "constant.language.boolean", foreground: bare(primary) },
      { token: "constant.language.null", foreground: bare(primary) },
      { token: "constant.numeric", foreground: bare(chartPurple) },
      { token: "constant.character.escape", foreground: bare(chartYellow) },

      // Keywords — primary blue
      { token: "keyword", foreground: bare(primary) },
      { token: "keyword.control", foreground: bare(primary) },
      { token: "keyword.operator", foreground: bare(primary) },
      { token: "keyword.operator.relational", foreground: bare(primary) },
      { token: "keyword.operator.assignment", foreground: bare(primary) },
      { token: "keyword.operator.arithmetic", foreground: bare(primary) },
      { token: "keyword.other.unit", foreground: bare(primary) },

      // Storage
      { token: "storage", foreground: bare(primary) },
      { token: "storage.type", foreground: bare(primary), fontStyle: "italic" },

      // Variables
      { token: "variable", foreground: bare(fg) },
      { token: "variable.parameter", foreground: bare(fg), fontStyle: "italic" },
      { token: "variable.language", foreground: bare(primary), fontStyle: "italic" },
      { token: "variable.other", foreground: bare(fg) },

      // Functions — cyan
      { token: "entity.name.function", foreground: bare(chartCyan) },
      { token: "support.function", foreground: bare(chartCyan) },
      { token: "meta.function-call", foreground: bare(chartCyan) },

      // Types / Classes — teal-ish (use green shifted)
      { token: "entity.name.type", foreground: bare(chartGreen) },
      { token: "entity.name.class", foreground: bare(chartGreen) },
      { token: "support.type", foreground: bare(chartGreen) },
      { token: "support.class", foreground: bare(chartGreen) },
      { token: "entity.other.inherited-class", foreground: bare(chartGreen), fontStyle: "italic" },

      // Tags (HTML/JSX) — primary
      { token: "entity.name.tag", foreground: bare(primary) },
      { token: "entity.other.attribute-name", foreground: bare(chartCyan), fontStyle: "italic" },
      { token: "punctuation.definition.tag", foreground: bare(primary) },
      { token: "meta.tag", foreground: bare(fg) },

      // Properties — cyan
      { token: "support.type.property-name", foreground: bare(chartCyan) },
      { token: "meta.property-name", foreground: bare(chartCyan) },

      // JSON
      { token: "support.type.property-name.json", foreground: bare(chartCyan) },
      { token: "support.constant.json", foreground: bare(chartPurple) },

      // CSS
      { token: "entity.name.tag.css", foreground: bare(primary) },
      { token: "entity.other.attribute-name.id", foreground: bare(chartCyan) },
      { token: "entity.other.attribute-name.class.css", foreground: bare(chartCyan) },
      { token: "support.constant.property-value.css", foreground: bare(fg) },

      // Punctuation
      { token: "punctuation", foreground: bare(fg) },
      { token: "punctuation.definition.string", foreground: bare(chartGreen) },
      { token: "meta.brace", foreground: bare(fg) },

      // Markdown
      { token: "markup.heading", foreground: bare(chartCyan), fontStyle: "bold" },
      { token: "markup.bold", foreground: bare(chartOrange), fontStyle: "bold" },
      { token: "markup.italic", foreground: bare(fg), fontStyle: "italic" },
      { token: "markup.inline.raw", foreground: bare(chartGreen) },
      { token: "markup.changed", foreground: bare(chartYellow) },
      { token: "markup.deleted", foreground: bare(chartRed) },
      { token: "markup.inserted", foreground: bare(chartGreen) },
      { token: "markup.underline.link", foreground: bare(chartCyan) },

      // INI / config files (Provision Viewer)
      { token: "keyword.ini", foreground: bare(primary) },
      { token: "string.ini", foreground: bare(chartGreen) },
      { token: "comment.ini", foreground: bare(mutedFg), fontStyle: "italic" },

      // Invalid
      { token: "invalid", foreground: bare(fg), background: bare(destructive) },
      { token: "invalid.deprecated", foreground: bare(fg), background: bare(primary) },

      // Decorators
      { token: "meta.decorator", foreground: bare(chartOrange), fontStyle: "italic" },

      // Type parameters
      { token: "type.identifier", foreground: bare(chartGreen) },
      { token: "type", foreground: bare(chartGreen), fontStyle: "italic" },

      // Operators
      { token: "keyword.operator.new", foreground: bare(primary), fontStyle: "bold" },

      // Delimiters
      { token: "delimiter", foreground: bare(fg) },
      { token: "delimiter.bracket", foreground: bare(fg) },
      { token: "delimiter.parenthesis", foreground: bare(fg) },

      // Identifiers (catch-all)
      { token: "identifier", foreground: bare(fg) },
      { token: "tag", foreground: bare(primary) },
      { token: "attribute.name", foreground: bare(chartCyan) },
      { token: "attribute.value", foreground: bare(chartGreen) },
    ],
  };
}

/* ── Registration ────────────────────────────────────────────── */

/**
 * Define the SIPalyzer theme on the given Monaco instance.
 * Safe to call multiple times — Monaco overwrites by theme name.
 */
export function defineSipalyzerTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(MONACO_THEME_NAME, buildTheme());
}

/** @deprecated Use `defineSipalyzerTheme` instead */
export const defineNordTheme = defineSipalyzerTheme;
