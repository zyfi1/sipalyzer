/**
 * Softphone Design System — World-class, fluid, modern
 * Premium dark theme with glass morphism and gradient accents
 */

export const SOFTPHONE = {
  // Layout
  panel: "ui-panel-shell",
  panelGlass: "rounded-lg bg-gradient-to-b from-popover/90 to-popover/60 backdrop-blur-xl shadow-dropdown",
  
  // Cards
  card: "ui-panel-shell",
  cardHover: "ui-panel-shell hover:bg-accent/50 hover:shadow-card-hover transition-smooth",
  cardActive: "rounded-lg bg-primary/5 ring-1 ring-primary/30",
  
  // Call display
  callAvatar: "rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center",
  callTimer: "text-5xl font-light tabular-nums tracking-tight",
  callTimerCompact: "text-2xl font-medium tabular-nums tracking-tight",
  
  // Controls
  controlRing: "rounded-full transition-[transform,box-shadow,background-color,color,border-color] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)] flex items-center justify-center shadow-lg",
  controlRingEnd: "bg-gradient-to-br from-destructive to-destructive/90 text-destructive-foreground hover:from-destructive/90 hover:to-destructive shadow-destructive/25",
  controlRingAnswer: "bg-gradient-to-br from-success to-success/90 text-success-foreground hover:from-success/90 hover:to-success shadow-success/25",
  controlRingMuted: "bg-gradient-to-br from-warning/80 to-warning/70 text-warning-foreground",
  controlButton: "h-12 w-12 rounded-md border border-border/40 bg-card/50 hover:bg-accent/80 hover:shadow-card-hover flex items-center justify-center transition-smooth",
  controlButtonActive: "h-12 w-12 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30 flex items-center justify-center transition-smooth",
  
  // Dialer
  dialerInput: "w-full h-14 px-4 rounded-lg bg-muted/50 text-2xl font-light text-foreground text-center tracking-widest placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
  dialerKey: "aspect-square rounded-lg bg-muted/30 hover:bg-accent/50 active:scale-95 flex flex-col items-center justify-center transition-[transform,background-color,box-shadow,color] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",
  dialerKeyNumber: "text-2xl font-medium text-foreground",
  dialerKeyLetters: "text-3xs text-muted-foreground/70 tracking-[0.2em] font-medium mt-0.5",
  
  // Visualization
  vizContainer: "rounded-lg bg-card/95 border border-border/40 shadow-card overflow-hidden",
  vizGradient: "bg-gradient-to-t from-primary/20 via-primary/5 to-transparent",
  
  // Labels
  label: "text-xs text-muted-foreground/80",
  labelBold: "text-xs font-medium text-muted-foreground",
  value: "text-sm font-medium text-foreground",
  
  // Badges
  badgeLive: "text-2xs font-medium uppercase tracking-wider px-2.5 py-1 rounded-full bg-success/10 text-success",
  badgeRinging: "text-2xs font-medium uppercase tracking-wider px-2.5 py-1 rounded-full bg-warning/10 text-warning animate-live-breathe motion-reduce:animate-none",
  badgeHold: "text-2xs font-medium uppercase tracking-wider px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground",
  badgeEnded: "text-2xs font-medium uppercase tracking-wider px-2.5 py-1 rounded-full bg-muted/30 text-muted-foreground/70",
  
  // Metrics
  metricCard: "rounded-lg bg-muted/30 shadow-card p-3",
  metricValue: "text-xl font-semibold tabular-nums",
  metricLabel: "text-2xs uppercase tracking-wider text-muted-foreground/70",
  metricGood: "text-success",
  metricWarning: "text-warning",
  metricBad: "text-destructive",
  
  // Charts
  chartContainer: "rounded-lg bg-muted/20 shadow-card p-4",
  
  // Section headers
  sectionHeader: "text-xs font-medium uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2",
  
  // Transitions
  transition: "transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[var(--motion-duration-navigation)] [transition-timing-function:var(--motion-ease-navigation)]",
  transitionFast: "transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[var(--motion-duration-micro)] [transition-timing-function:var(--motion-ease-micro)]",

  // Legacy (for compatibility)
  section: "rounded-lg bg-muted/30 shadow-card p-4 space-y-4",
  sectionTitle: "text-xs font-medium uppercase tracking-wider text-muted-foreground/70",
  gap: "space-y-5",
  chip: "rounded-lg bg-muted/30 shadow-sm",
  accentLive: "text-success bg-success/10",
  accentWarning: "text-warning bg-warning/10",
  accentError: "text-destructive bg-destructive/10",
  accentMuted: "text-muted-foreground bg-muted/30",
} as const;

export const DIAL_KEY_ROWS: { key: string; letters?: string }[][] = [
  [{ key: "1" }, { key: "2", letters: "ABC" }, { key: "3", letters: "DEF" }],
  [{ key: "4", letters: "GHI" }, { key: "5", letters: "JKL" }, { key: "6", letters: "MNO" }],
  [{ key: "7", letters: "PQRS" }, { key: "8", letters: "TUV" }, { key: "9", letters: "WXYZ" }],
  [{ key: "*" }, { key: "0", letters: "+" }, { key: "#" }],
];

export const DIAL_KEYS = DIAL_KEY_ROWS.flat().map((k) => k.key);
