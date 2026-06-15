/**
 * roughSketch — a tiny, dependency-free hand-drawn renderer.
 *
 * Produces the "sketchy" look popularised by Excalidraw / rough.js: every edge
 * is drawn as a pair of slightly perturbed bezier strokes, and fills are laid
 * down as jittered hachure (or cross-hatch) lines clipped to the shape.
 *
 * Everything is deterministic per `seed`, so a shape looks identical across
 * redraws, zoom and export. Pass a stable integer seed per element.
 */

export type RoughFillStyle = 'solid' | 'hachure' | 'cross-hatch';

export interface RoughOptions {
  stroke: string;
  strokeWidth: number;
  /** 0 = clean/precise, 1 = artist, 2 = cartoonist. */
  roughness: number;
  seed: number;
  /** Fill colour, or null/'transparent' for no fill. */
  fill?: string | null;
  fillStyle?: RoughFillStyle;
  /** Dash pattern for the outline (in canvas units). */
  lineDash?: number[] | null;
  /** Spacing between hachure lines. */
  hachureGap?: number;
}

// --- deterministic RNG (mulberry32) -----------------------------------------
function makeRng(seed: number) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

interface Ctx2D {
  rng: Rng;
  roughness: number;
}

function offset(min: number, max: number, c: Ctx2D, scale = 1): number {
  return c.roughness * scale * (c.rng() * (max - min) + min);
}

function offsetOpt(x: number, c: Ctx2D, scale = 1): number {
  return offset(-x, x, c, scale);
}

const MAX_OFFSET = 2;

/**
 * Append a single hand-drawn line segment to the current path.
 * Ported (compactly) from rough.js' _line.
 */
function lineSegment(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  c: Ctx2D,
  move: boolean,
  overlay: boolean
) {
  const lengthSq = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  const length = Math.sqrt(lengthSq);

  let roughnessGain = 1;
  if (length < 200) roughnessGain = 1;
  else if (length > 500) roughnessGain = 0.4;
  else roughnessGain = -0.0016668 * length + 1.233334;

  let off = MAX_OFFSET;
  if (off * off * 100 > lengthSq) off = length / 10;
  const halfOffset = off / 2;
  const divergePoint = 0.2 + c.rng() * 0.2;

  let midDispX = (MAX_OFFSET * (y2 - y1)) / 200;
  let midDispY = (MAX_OFFSET * (x1 - x2)) / 200;
  midDispX = offsetOpt(midDispX, c, roughnessGain);
  midDispY = offsetOpt(midDispY, c, roughnessGain);

  const randoff = () => offsetOpt(overlay ? halfOffset : off, c, roughnessGain);

  if (move) {
    ctx.moveTo(
      x1 + (overlay ? 0 : randoff()),
      y1 + (overlay ? 0 : randoff())
    );
  }

  ctx.bezierCurveTo(
    midDispX + x1 + (x2 - x1) * divergePoint + randoff(),
    midDispY + y1 + (y2 - y1) * divergePoint + randoff(),
    midDispX + x1 + 2 * (x2 - x1) * divergePoint + randoff(),
    midDispY + y1 + 2 * (y2 - y1) * divergePoint + randoff(),
    x2 + (overlay ? 0 : randoff()),
    y2 + (overlay ? 0 : randoff())
  );
}

/** Stroke a hand-drawn line between two points (drawn twice for the sketchy double-stroke). */
export function roughLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: RoughOptions
) {
  const c: Ctx2D = { rng: makeRng(o.seed), roughness: o.roughness };
  ctx.save();
  applyStroke(ctx, o);
  if (o.roughness <= 0) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  lineSegment(ctx, x1, y1, x2, y2, c, true, false);
  lineSegment(ctx, x1, y1, x2, y2, c, true, true);
  ctx.stroke();
  ctx.restore();
}

/** Build a closed polygon path (hand-drawn) without stroking it. */
function polygonPath(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  c: Ctx2D
) {
  ctx.beginPath();
  if (c.roughness <= 0) {
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    return;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      lineSegment(ctx, x1, y1, x2, y2, c, i === 0, pass === 1);
    }
  }
}

function cleanPolygonPath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: Ctx2D,
  jitter: boolean
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const steps = Math.max(18, Math.floor((Math.abs(rx) + Math.abs(ry)) / 6) + 12);
  const jx = jitter ? Math.min(rx * 0.05, 4) : 0;
  const jy = jitter ? Math.min(ry * 0.05, 4) : 0;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([
      cx + Math.cos(a) * rx + offsetOpt(jx, c),
      cy + Math.sin(a) * ry + offsetOpt(jy, c)
    ]);
  }
  return pts;
}

function smoothPath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i][0] + pts[i + 1][0]) / 2;
    const yc = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

function applyStroke(ctx: CanvasRenderingContext2D, o: RoughOptions) {
  ctx.strokeStyle = o.stroke;
  ctx.lineWidth = o.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(o.lineDash && o.lineDash.length ? o.lineDash : []);
}

// --- fills -------------------------------------------------------------------
function hachureLines(
  cx: number,
  cy: number,
  w: number,
  h: number,
  gap: number,
  angleDeg: number
): Array<[number, number, number, number]> {
  const lines: Array<[number, number, number, number]> = [];
  const angle = (angleDeg * Math.PI) / 180;
  // Work in a rotated frame, then rotate the endpoints back.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const diag = Math.sqrt(w * w + h * h);
  const steps = Math.ceil(diag / gap);
  for (let i = -steps; i <= steps; i++) {
    const d = i * gap;
    // line in rotated space: (d, -diag) -> (d, diag), rotated by angle around centre
    const x1r = d;
    const y1r = -diag;
    const x2r = d;
    const y2r = diag;
    lines.push([
      cx + x1r * cos - y1r * sin,
      cy + x1r * sin + y1r * cos,
      cx + x2r * cos - y2r * sin,
      cy + x2r * sin + y2r * cos
    ]);
  }
  return lines;
}

/**
 * Fill the supplied clean path (already on ctx) with the chosen fill style.
 * Caller provides a function that re-creates the geometric clip path.
 */
function fillRegion(
  ctx: CanvasRenderingContext2D,
  clip: () => void,
  bbox: { x: number; y: number; w: number; h: number },
  o: RoughOptions,
  c: Ctx2D
) {
  if (!o.fill || o.fill === 'transparent') return;
  const style = o.fillStyle ?? 'hachure';
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;

  ctx.save();
  clip();
  ctx.clip();

  if (style === 'solid') {
    ctx.globalAlpha *= 1;
    ctx.fillStyle = o.fill;
    ctx.fillRect(bbox.x - 2, bbox.y - 2, bbox.w + 4, bbox.h + 4);
    ctx.restore();
    return;
  }

  const gap = Math.max(4, o.hachureGap ?? 8);
  ctx.strokeStyle = o.fill;
  ctx.lineWidth = Math.max(0.75, o.strokeWidth * 0.5);
  ctx.lineCap = 'round';
  ctx.setLineDash([]);

  const drawSet = (angleDeg: number) => {
    const lines = hachureLines(cx, cy, bbox.w, bbox.h, gap, angleDeg);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) {
      if (o.roughness <= 0) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      } else {
        lineSegment(ctx, x1, y1, x2, y2, c, true, false);
      }
    }
    ctx.stroke();
  };

  drawSet(-41);
  if (style === 'cross-hatch') drawSet(41);
  ctx.restore();
}

// --- public shape API --------------------------------------------------------
export function roughRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  o: RoughOptions
) {
  const c: Ctx2D = { rng: makeRng(o.seed), roughness: o.roughness };
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));

  const clip = () => {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
  };
  fillRegion(ctx, clip, { x, y, w, h }, o, { rng: makeRng(o.seed + 1), roughness: o.roughness });

  ctx.save();
  applyStroke(ctx, o);
  if (o.roughness <= 0) {
    // Clean mode: smooth geometric path.
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
  } else {
    // Hand-drawn: sketchy edges with smooth (optionally rounded) corners, so
    // the Pencil/Loose roughness is actually visible on rectangles instead of
    // rendering CAD-clean.
    ctx.beginPath();
    roughRoundedRectPath(ctx, x, y, w, h, r, c);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Append a hand-drawn rounded-rectangle outline to the current path (does not
 * stroke). Each straight edge is a perturbed double-stroke; corners are short
 * smooth quadratics so the sketchiness reads as a deliberate rounded rect
 * rather than noise. Caller must beginPath() before and stroke() after.
 */
function roughRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  c: Ctx2D
) {
  const x2 = x + w;
  const y2 = y + h;
  const corner = (cpx: number, cpy: number, nx: number, ny: number) => {
    if (r > 0) ctx.quadraticCurveTo(cpx, cpy, nx, ny);
  };
  for (let pass = 0; pass < 2; pass++) {
    const overlay = pass === 1;
    lineSegment(ctx, x + r, y, x2 - r, y, c, true, overlay); // top
    corner(x2, y, x2, y + r);
    lineSegment(ctx, x2, y + r, x2, y2 - r, c, false, overlay); // right
    corner(x2, y2, x2 - r, y2);
    lineSegment(ctx, x2 - r, y2, x + r, y2, c, false, overlay); // bottom
    corner(x, y2, x, y2 - r);
    lineSegment(ctx, x, y2 - r, x, y + r, c, false, overlay); // left
    corner(x, y, x + r, y);
  }
}

export function roughDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o: RoughOptions
) {
  const c: Ctx2D = { rng: makeRng(o.seed), roughness: o.roughness };
  const pts: Array<[number, number]> = [
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2]
  ];
  const clip = () => cleanPolygonPath(ctx, pts);
  fillRegion(ctx, clip, { x, y, w, h }, o, { rng: makeRng(o.seed + 1), roughness: o.roughness });

  ctx.save();
  applyStroke(ctx, o);
  polygonPath(ctx, pts, c);
  ctx.stroke();
  ctx.restore();
}

export function roughEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  o: RoughOptions
) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const fillC: Ctx2D = { rng: makeRng(o.seed + 1), roughness: o.roughness };

  const clip = () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  };
  fillRegion(ctx, clip, { x, y, w, h }, o, fillC);

  ctx.save();
  applyStroke(ctx, o);
  if (o.roughness <= 0) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const c: Ctx2D = { rng: makeRng(o.seed), roughness: o.roughness };
  ctx.beginPath();
  smoothPath(ctx, ellipsePoints(cx, cy, rx, ry, c, true));
  smoothPath(ctx, ellipsePoints(cx, cy, rx, ry, c, true));
  ctx.stroke();
  ctx.restore();
}

/** Hand-drawn arrow (optionally with a head) between two world points. */
export function roughArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  withHead: boolean,
  o: RoughOptions
) {
  roughLine(ctx, x1, y1, x2, y2, o);
  if (!withHead) return;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, o.strokeWidth * 4);
  const a1 = angle - Math.PI / 6;
  const a2 = angle + Math.PI / 6;
  roughLine(ctx, x2, y2, x2 - headLen * Math.cos(a1), y2 - headLen * Math.sin(a1), {
    ...o,
    seed: o.seed + 7,
    fill: null
  });
  roughLine(ctx, x2, y2, x2 - headLen * Math.cos(a2), y2 - headLen * Math.sin(a2), {
    ...o,
    seed: o.seed + 13,
    fill: null
  });
}

// --- helpers -----------------------------------------------------------------
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A stable-ish integer seed. */
export function makeSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
