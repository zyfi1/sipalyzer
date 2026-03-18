/**
 * Shared Canvas drawing utilities for network topology diagrams.
 * Used by both NetworkMapView (Network Devices) and RtpEndpointMap (RTP Forensics).
 *
 * Provides:
 *  - Icon rendering on Canvas (SVG → Image caching)
 *  - Broken-line (elbow) drawing for a "circuit board" aesthetic
 *  - Directional arrow-tipped broken lines for directed streams
 */

// ── Icon SVG path data (viewBox 0 0 256 256) ────

const ICON_PATHS: Record<string, string> = {
  network:
    "M232,112H136V88h8a16,16,0,0,0,16-16V40a16,16,0,0,0-16-16H112A16,16,0,0,0,96,40V72a16,16,0,0,0,16,16h8v24H24a8,8,0,0,0,0,16H56v32H48a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H80a16,16,0,0,0,16-16V176a16,16,0,0,0-16-16H72V128H184v32h-8a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V176a16,16,0,0,0-16-16h-8V128h32a8,8,0,0,0,0-16ZM112,40h32V72H112ZM80,208H48V176H80Zm128,0H176V176h32Z",
  laptop:
    "M232,168h-8V72a24,24,0,0,0-24-24H56A24,24,0,0,0,32,72v96H24a8,8,0,0,0-8,8v16a24,24,0,0,0,24,24H216a24,24,0,0,0,24-24V176A8,8,0,0,0,232,168ZM48,72a8,8,0,0,1,8-8H200a8,8,0,0,1,8,8v96H48ZM224,192a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8v-8H224ZM152,88a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,88Z",
  phone:
    "M222.37,158.46l-47.11-21.11-.13-.06a16,16,0,0,0-15.17,1.4,8.12,8.12,0,0,0-.75.56L134.87,160c-15.42-7.49-31.34-23.29-38.83-38.51l20.78-24.71c.2-.25.39-.5.57-.77a16,16,0,0,0,1.32-15.06l0-.12L97.54,33.64a16,16,0,0,0-16.62-9.52A56.26,56.26,0,0,0,32,80c0,79.4,64.6,144,144,144a56.26,56.26,0,0,0,55.88-48.92A16,16,0,0,0,222.37,158.46ZM176,208A128.14,128.14,0,0,1,48,80,40.2,40.2,0,0,1,82.87,40a.61.61,0,0,0,0,.12l21,47L83.2,111.86a6.13,6.13,0,0,0-.57.77,16,16,0,0,0-1,15.7c9.06,18.53,27.73,37.06,46.46,46.11a16,16,0,0,0,15.75-1.14,8.44,8.44,0,0,0,.74-.56L168.89,152l47,21.05h0s.08,0,.11,0A40.21,40.21,0,0,1,176,208Z",
  headphones:
    "M201.89,54.66A103.43,103.43,0,0,0,128.79,24H128A104,104,0,0,0,24,128v56a24,24,0,0,0,24,24H64a24,24,0,0,0,24-24V144a24,24,0,0,0-24-24H40.36A88,88,0,0,1,128,40h.67a87.71,87.71,0,0,1,87,80H192a24,24,0,0,0-24,24v40a24,24,0,0,0,24,24h16a24,24,0,0,0,24-24V128A103.41,103.41,0,0,0,201.89,54.66ZM64,136a8,8,0,0,1,8,8v40a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V136Zm152,48a8,8,0,0,1-8,8H192a8,8,0,0,1-8-8V144a8,8,0,0,1,8-8h24Z",
  database:
    "M128,24C74.17,24,32,48.6,32,80v96c0,31.4,42.17,56,96,56s96-24.6,96-56V80C224,48.6,181.83,24,128,24Zm80,104c0,9.62-7.88,19.43-21.61,26.92C170.93,163.35,150.19,168,128,168s-42.93-4.65-58.39-13.08C55.88,147.43,48,137.62,48,128V111.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64ZM69.61,53.08C85.07,44.65,105.81,40,128,40s42.93,4.65,58.39,13.08C200.12,60.57,208,70.38,208,80s-7.88,19.43-21.61,26.92C170.93,115.35,150.19,120,128,120s-42.93-4.65-58.39-13.08C55.88,99.43,48,89.62,48,80S55.88,60.57,69.61,53.08ZM186.39,202.92C170.93,211.35,150.19,216,128,216s-42.93-4.65-58.39-13.08C55.88,195.43,48,185.62,48,176V159.36c17.06,15,46.23,24.64,80,24.64s62.94-9.68,80-24.64V176C208,185.62,200.12,195.43,186.39,202.92Z",
  shield:
    "M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.27,47,25.53a8,8,0,0,0,4.2,0c1-.26,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0Z",
  lightbulb:
    "M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,.92-70.47,33.39-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z",
  globe:
    "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z",
  question:
    "M140,180a12,12,0,1,1-12-12A12,12,0,0,1,140,180ZM128,72c-22.06,0-40,16.15-40,36v4a8,8,0,0,0,16,0v-4c0-11,10.77-20,24-20s24,9,24,20-10.77,20-24,20a8,8,0,0,0-8,8v8a8,8,0,0,0,16,0v-.72c18.24-3.35,32-17.9,32-35.28C168,88.15,150.06,72,128,72Zm104,56A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
};

// ── Icon → Image cache ──────────────────────────────────────────

const _iconCache = new Map<string, HTMLImageElement>();

/**
 * Build (or retrieve from cache) an HTMLImageElement of an icon
 * rendered in the given color at the requested pixel size.
 *
 * @param iconKey  one of the keys in ICON_PATHS (e.g. "network", "laptop")
 * @param color    fill color as hex string
 * @param size     pixel size of the output image (square)
 */
export function getIconImage(
  iconKey: string,
  color: string,
  size: number,
): HTMLImageElement | null {
  const cacheKey = `${iconKey}:${color}:${size}`;
  const cached = _iconCache.get(cacheKey);
  if (cached) return cached;

  const pathData = ICON_PATHS[iconKey];
  if (!pathData) return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}"><path fill="${color}" d="${pathData}"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  const img = new Image(size, size);
  img.src = uri;
  _iconCache.set(cacheKey, img);
  return img;
}

/** List of available icon keys. */
export const ICON_KEYS = Object.keys(ICON_PATHS);

// ── Broken-line (elbow) drawing ─────────────────────────────────

/**
 * Draw an elbow / broken-line path from (x1,y1) to (x2,y2).
 * Routes: horizontal → vertical → horizontal, producing a clean
 * right-angle "circuit board" aesthetic.
 */
export function drawBrokenLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
): void {
  const midX = (x1 + x2) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(midX, y1);
  ctx.lineTo(midX, y2);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw an elbow / broken-line path with a directional arrowhead
 * at the destination end. Used for RTP directed streams.
 */
export function drawDirectedBrokenLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
  arrowSize: number = 6,
): void {
  const midX = (x1 + x2) / 2;

  ctx.save();

  // Main elbow path
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(midX, y1);
  ctx.lineTo(midX, y2);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Arrow at destination — direction is from the last segment (midX,y2) → (x2,y2)
  const angle = Math.atan2(y2 - y2, x2 - midX); // always horizontal (0 or PI)
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - arrowSize * Math.cos(angle - Math.PI / 6),
    y2 - arrowSize * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - arrowSize * Math.cos(angle + Math.PI / 6),
    y2 - arrowSize * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

// ── Shared node drawing ─────────────────────────────────────────

/**
 * Draw a circular node with an icon inside, label text below, and
 * optional glow/selection ring.
 */
export function drawIconNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fillColor: string,
  iconKey: string,
  opts: {
    label?: string;
    subLabel?: string;
    isHovered?: boolean;
    isSelected?: boolean;
    /** Scale factor — set to 1 for non-zoomed canvas */
    scale?: number;
  } = {},
): void {
  const { label, subLabel, isHovered, isSelected, scale = 1 } = opts;

  // Glow ring
  if (isHovered || isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + (isSelected ? 6 : 4), 0, Math.PI * 2);
    ctx.fillStyle = fillColor + (isSelected ? "25" : "15");
    ctx.fill();
  }

  // Selection ring
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Main circle
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor + (isHovered ? "DD" : "BB");
  ctx.fill();
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Icon inside
  const iconSize = Math.round(radius * 1.2);
  const icon = getIconImage(iconKey, "#ffffff", iconSize * 2); // render at 2x for sharpness
  if (icon && icon.complete && icon.naturalWidth > 0) {
    ctx.drawImage(icon, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
  }

  // Primary label
  if (label) {
    const fsP = Math.max(11 / scale, 3);
    ctx.font = `500 ${fsP}px Inter, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = isSelected ? "#ffffff" : "rgba(210, 220, 235, 0.88)";
    ctx.fillText(label.slice(0, 26), x, y + radius + 4);

    // Sub-label
    if (subLabel) {
      const fsS = Math.max(9 / scale, 2.5);
      ctx.font = `400 ${fsS}px "Geist Mono", "SF Mono", Menlo, monospace`;
      ctx.fillStyle = "rgba(140, 160, 185, 0.6)";
      ctx.fillText(subLabel.slice(0, 30), x, y + radius + 4 + fsP + 2);
    }
  }
}
