import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { closeSketchCanvas } from '$lib/stores/sketch';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { useStore } from '$lib/react/useStore';
import { appearance, matchShortcut, userShortcuts } from '$lib/stores/settings';
import './SketchCanvas.css';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
  opacity: number;
  isEraser: boolean;
}

interface SketchText {
  id: string;
  x: number;
  y: number;
  value: string;
  color: string;
  fontSize: number;
  opacity: number;
  fontFamily?: 'handwritten' | 'sans-serif' | 'monospace';
}

interface SketchShape {
  id: string;
  type: 'rectangle' | 'circle' | 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fillColor: string; // 'transparent' | 'glass' | hex color
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'none';
  borderRadius: number;
  opacity: number;
  text: string;
  strokeWidth?: number;
  roughness?: number; // 0 (architect), 1.5 (artist), 3 (cartoonist)
  fontFamily?: 'handwritten' | 'sans-serif' | 'monospace';
  fillStyle?: 'transparent' | 'hachure' | 'cross-hatch' | 'solid';
}

interface SketchArrow {
  id: string;
  fromTextId?: string;
  fromShapeId?: string;
  toTextId?: string;
  toShapeId?: string;
  fromPoint?: Point;
  toPoint?: Point;
  color: string;
  opacity: number;
  type?: 'arrow' | 'line';
}

type SketchBackgroundStyle =
  | 'transparent'
  | 'dot-grid'
  | 'line-grid'
  | 'isometric-grid'
  | 'blackboard'
  | 'blueprint'
  | 'solid-dark'
  | 'solid-light';

interface PersistedSketchState {
  version?: string;
  backgroundStyle?: SketchBackgroundStyle;
  gridSpacing?: number;
  snapToGrid?: boolean;
  zoomScale?: number;
  panOffset?: { x: number; y: number };
  strokes?: Stroke[];
  texts?: SketchText[];
  arrows?: SketchArrow[];
  shapes?: SketchShape[];
}

const LEGACY_SKETCH_STATE_V3_KEY = 'soryq_sketch_state_v3';
const LEGACY_SKETCH_STATE_V2_KEY = 'soryq_sketch_state_v2';
const LEGACY_SKETCH_OWNER_KEY = 'soryq_sketch_legacy_owner_project';

// Color Swatches
const presetColors = [
  { value: '#06b6d4', name: 'Cyan' },
  { value: '#10b981', name: 'Emerald' },
  { value: '#f43f5e', name: 'Rose' },
  { value: '#f59e0b', name: 'Amber' },
  { value: '#8b5cf6', name: 'Purple' },
  { value: '#ffffff', name: 'White' },
  { value: '#18181e', name: 'Dark' }
];

// Seeded PRNG for deterministic hand-drawn sketchy visuals
function createSeededRandom(seedString: string) {
  let h = 0;
  for (let i = 0; i < seedString.length; i++) {
    h = Math.imul(31, h) + seedString.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Draw a sketchy line between two points
function drawSketchyLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rand: () => number,
  roughness: number = 1.5
) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return;

  const passes = roughness > 0 ? 2 : 1;
  const offset = roughness * 1.2;

  for (let pass = 0; pass < passes; pass++) {
    const sX = x1 + (rand() - 0.5) * offset;
    const sY = y1 + (rand() - 0.5) * offset;
    const eX = x2 + (rand() - 0.5) * offset;
    const eY = y2 + (rand() - 0.5) * offset;

    if (length > 30 && roughness > 0) {
      const midX = (x1 + x2) / 2 + (rand() - 0.5) * offset * 1.2;
      const midY = (y1 + y2) / 2 + (rand() - 0.5) * offset * 1.2;
      ctx.beginPath();
      ctx.moveTo(sX, sY);
      ctx.quadraticCurveTo(midX, midY, eX, eY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(sX, sY);
      ctx.lineTo(eX, eY);
      ctx.stroke();
    }
  }
}

// Draw a sketchy circle/ellipse
function drawSketchyEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rand: () => number,
  roughness: number = 1.5
) {
  if (rx <= 0 || ry <= 0) return;
  const passes = roughness > 0 ? 2 : 1;
  const steps = Math.max(16, Math.min(32, Math.floor(Math.max(rx, ry) / 2)));
  const offset = roughness * 1.2;

  for (let pass = 0; pass < passes; pass++) {
    ctx.beginPath();
    const points: Point[] = [];
    const extraSteps = roughness > 0 ? 2 : 0; // overshoot slightly

    for (let i = 0; i <= steps + extraSteps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const rJitterX = (rand() - 0.5) * offset;
      const rJitterY = (rand() - 0.5) * offset;
      const px = cx + (rx + rJitterX) * Math.cos(angle) + (rand() - 0.5) * offset * 0.4;
      const py = cy + (ry + rJitterY) * Math.sin(angle) + (rand() - 0.5) * offset * 0.4;
      points.push({ x: px, y: py });
    }

    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }
}

// Draw a sketchy rounded rectangle
function drawSketchyRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  rand: () => number,
  roughness: number = 1.5
) {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) {
    drawSketchyLine(ctx, x, y, x + w, y, rand, roughness);
    drawSketchyLine(ctx, x + w, y, x + w, y + h, rand, roughness);
    drawSketchyLine(ctx, x + w, y + h, x, y + h, rand, roughness);
    drawSketchyLine(ctx, x, y + h, x, y, rand, roughness);
    return;
  }

  const passes = roughness > 0 ? 2 : 1;
  const offset = roughness * 1.2;

  for (let pass = 0; pass < passes; pass++) {
    ctx.beginPath();
    const jitter = () => (rand() - 0.5) * offset;

    const tlX = x + r;
    const tlY = y + r;
    const trX = x + w - r;
    const trY = y + r;
    const brX = x + w - r;
    const brY = y + h - r;
    const blX = x + r;
    const blY = y + h - r;

    ctx.moveTo((tlX + trX) / 2 + jitter(), y + jitter());
    ctx.lineTo(trX + jitter(), y + jitter());
    ctx.arcTo(x + w + jitter(), y + jitter(), x + w + jitter(), trY + jitter(), r);
    ctx.lineTo(x + w + jitter(), brY + jitter());
    ctx.arcTo(x + w + jitter(), y + h + jitter(), brX + jitter(), y + h + jitter(), r);
    ctx.lineTo(blX + jitter(), y + h + jitter());
    ctx.arcTo(x + jitter(), y + h + jitter(), x + jitter(), blY + jitter(), r);
    ctx.lineTo(x + jitter(), tlY + jitter());
    ctx.arcTo(x + jitter(), y + jitter(), tlX + jitter(), y + jitter(), r);
    ctx.lineTo((tlX + trX) / 2 + jitter(), y + jitter());
    ctx.stroke();
  }
}

// Fill sketchy hachure lines inside a shape boundary path
function fillSketchyHachure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  drawPathFn: () => void,
  rand: () => number,
  spacing: number = 8,
  angle: number = Math.PI / 4
) {
  ctx.save();
  ctx.beginPath();
  drawPathFn();
  ctx.clip();

  const diag = Math.hypot(w, h);
  for (let offset = -diag; offset < diag; offset += spacing) {
    const x1 = x + offset;
    const y1 = y - 10;
    const x2 = x + offset + h;
    const y2 = y + h + 10;

    ctx.beginPath();
    ctx.moveTo(x1 + (rand() - 0.5) * 3, y1 + (rand() - 0.5) * 3);
    ctx.lineTo(x2 + (rand() - 0.5) * 3, y2 + (rand() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

export default function SketchCanvas() {
  const project = useStore(activeProject);
  const currentAppearance = useStore(appearance);
  const activeShortcuts = useStore(userShortcuts) || [];

  // DOM Refs
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shapeTextInputRef = useRef<HTMLTextAreaElement | null>(null);
  const colorPickerRef = useRef<HTMLInputElement | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);

  // Interaction Refs (to avoid stale closures in window listeners)
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const draggingTextIdRef = useRef<string | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const textStartRef = useRef({ x: 0, y: 0 });

  const draggingShapeIdRef = useRef<string | null>(null);
  const dragShapeStartRef = useRef({ x: 0, y: 0 });
  const shapeStartCoordsRef = useRef({ x: 0, y: 0 });

  const resizingShapeIdRef = useRef<string | null>(null);
  const resizeShapeStartRef = useRef({ x: 0, y: 0 });
  const shapeStartDimsRef = useRef({ width: 0, height: 0 });

  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);

  // Toolbar and display states
  const [currentTool, setCurrentTool] = useState<'select' | 'pen' | 'eraser' | 'text' | 'pan' | 'connector' | 'rectangle' | 'circle' | 'diamond' | 'line'>('select');
  const [currentColor, setCurrentColor] = useState('#06b6d4');
  const [customColor, setCustomColor] = useState('#e2e2eb');
  const [brushSize, setBrushSize] = useState(6);
  const [brushOpacity, setBrushOpacity] = useState(1.0);

  // New Excalidraw Styling States
  const [defaultFillColor, setDefaultFillColor] = useState('transparent');
  const [customFillColor, setCustomFillColor] = useState('#ffffff');
  const [defaultFillStyle, setDefaultFillStyle] = useState<'transparent' | 'hachure' | 'cross-hatch' | 'solid'>('transparent');
  const [defaultStrokeWidth, setDefaultStrokeWidth] = useState<number>(2);
  const [defaultStrokeStyle, setDefaultStrokeStyle] = useState<'solid' | 'dashed' | 'dotted' | 'none'>('solid');
  const [defaultRoughness, setDefaultRoughness] = useState<number>(1.5);
  const [defaultFontFamily, setDefaultFontFamily] = useState<'handwritten' | 'sans-serif' | 'monospace'>('handwritten');

  // Shapes & Text State
  const [sketchShapes, setSketchShapes] = useState<SketchShape[]>([]);
  const [drawingShape, setDrawingShape] = useState(false);
  const [shapeStartPoint, setShapeStartPoint] = useState<Point | null>(null);
  const [shapeCurrentPoint, setShapeCurrentPoint] = useState<Point | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null);
  const [activeShapeTextInput, setActiveShapeTextInput] = useState<{ id: string; value: string } | null>(null);

  // Connectors State
  const [arrows, setArrows] = useState<SketchArrow[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [connectingFromShapeId, setConnectingFromShapeId] = useState<string | null>(null);
  const [connectingStartPoint, setConnectingStartPoint] = useState<Point | null>(null);
  const [connectingCurrentPoint, setConnectingCurrentPoint] = useState<Point | null>(null);

  // Canvas Settings State
  const [backgroundStyle, setBackgroundStyle] = useState<SketchBackgroundStyle>('transparent');
  const [gridSpacing, setGridSpacing] = useState(24);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearConfirmTimeoutRef = useRef<any>(null);

  // Zoom & Pan State
  const [zoomScale, setZoomScale] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);

  // Text Tool State
  const [activeTextInput, setActiveTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const [sketchTexts, setSketchTexts] = useState<SketchText[]>([]);

  // History button enabling states
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Viewport sizes
  const [viewportWidth, setViewportWidth] = useState(800);
  const [viewportHeight, setViewportHeight] = useState(600);

  // Vector strokes list
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  // Project loading
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  // Deriving Light Theme
  const isLightTheme = currentAppearance === 'light' || (currentAppearance === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches);

  // Maintain helper state ref to access latest state values in window listeners
  const stateRef = useRef({
    zoomScale,
    panOffset,
    snapToGrid,
    backgroundStyle,
    gridSpacing,
    strokes,
    sketchTexts,
    arrows,
    sketchShapes,
    currentColor,
    brushSize,
    brushOpacity,
    currentTool,
    activeShortcuts,
    spacePressed,
    defaultFillColor,
    customFillColor,
    defaultFillStyle,
    defaultStrokeWidth,
    defaultStrokeStyle,
    defaultRoughness,
    defaultFontFamily
  });

  useEffect(() => {
    stateRef.current = {
      zoomScale,
      panOffset,
      snapToGrid,
      backgroundStyle,
      gridSpacing,
      strokes,
      sketchTexts,
      arrows,
      sketchShapes,
      currentColor,
      brushSize,
      brushOpacity,
      currentTool,
      activeShortcuts,
      spacePressed,
      defaultFillColor,
      customFillColor,
      defaultFillStyle,
      defaultStrokeWidth,
      defaultStrokeStyle,
      defaultRoughness,
      defaultFontFamily
    };
  }, [
    zoomScale,
    panOffset,
    snapToGrid,
    backgroundStyle,
    gridSpacing,
    strokes,
    sketchTexts,
    arrows,
    sketchShapes,
    currentColor,
    brushSize,
    brushOpacity,
    currentTool,
    activeShortcuts,
    spacePressed,
    defaultFillColor,
    customFillColor,
    defaultFillStyle,
    defaultStrokeWidth,
    defaultStrokeStyle,
    defaultRoughness,
    defaultFontFamily
  ]);

  function getSketchStorageKey(projectId: string) {
    return `soryq_sketch_state_v4_${projectId}`;
  }

  function resolveStorageProjectId(projectId: string | null | undefined = loadedProjectId ?? (project?.id ?? null)) {
    return projectId ?? null;
  }

  function clearPersistedSketch(projectId: string | null | undefined = resolveStorageProjectId()) {
    if (typeof localStorage === 'undefined') return;
    const resolvedProjectId = resolveStorageProjectId(projectId);
    if (!resolvedProjectId) return;
    localStorage.removeItem(getSketchStorageKey(resolvedProjectId));
  }

  function persistStateString(stateStr: string, projectId: string | null | undefined = resolveStorageProjectId()) {
    if (typeof localStorage === 'undefined') return;
    const resolvedProjectId = resolveStorageProjectId(projectId);
    if (!resolvedProjectId) return;
    localStorage.setItem(getSketchStorageKey(resolvedProjectId), stateStr);
  }

  function createPersistedState(): PersistedSketchState {
    const s = stateRef.current;
    return {
      version: '4',
      backgroundStyle: s.backgroundStyle,
      gridSpacing: s.gridSpacing,
      snapToGrid: s.snapToGrid,
      zoomScale: s.zoomScale,
      panOffset: { ...s.panOffset },
      strokes: s.strokes,
      texts: s.sketchTexts,
      arrows: s.arrows,
      shapes: s.sketchShapes
    };
  }

  function persistCanvasSnapshot(projectId: string | null | undefined = resolveStorageProjectId()) {
    persistStateString(JSON.stringify(createPersistedState()), projectId);
  }

  function resetCanvasDocument() {
    setStrokes([]);
    setSketchTexts([]);
    setArrows([]);
    setSketchShapes([]);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setSelectedShapeId(null);
    setActiveTextInput(null);
    setActiveShapeTextInput(null);
    setBackgroundStyle('transparent');
    setGridSpacing(24);
    setSnapToGrid(false);
    setZoomScale(1.0);
    setPanOffset({ x: 0, y: 0 });
  }

  // Map screen coordinates to transformed local canvas world coordinates
  function screenToWorld(clientX: number, clientY: number, currentPan = panOffset, currentZoom = zoomScale): Point {
    const viewport = viewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    const rect = viewport.getBoundingClientRect();
    const cssZoom = rect.width / viewport.clientWidth;
    const screenX = (clientX - rect.left) / cssZoom;
    const screenY = (clientY - rect.top) / cssZoom;
    return {
      x: (screenX - currentPan.x) / currentZoom,
      y: (screenY - currentPan.y) / currentZoom
    };
  }

  // Draw background grids
  function drawGrid() {
    const gridCanvas = gridCanvasRef.current;
    if (!gridCanvas) return;
    const gridCtx = gridCanvas.getContext('2d');
    if (!gridCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = gridCanvas.width / dpr;
    const h = gridCanvas.height / dpr;
    
    gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridCtx.clearRect(0, 0, w, h);
    
    const isLightThemeVal = document.documentElement.classList.contains('light-theme');
    
    // Set background color
    if (backgroundStyle === 'solid-dark') {
      gridCtx.fillStyle = '#121216';
      gridCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'solid-light') {
      gridCtx.fillStyle = '#f3f3f6';
      gridCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'blackboard') {
      gridCtx.fillStyle = '#182d27'; // Slate Green
      gridCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'blueprint') {
      gridCtx.fillStyle = '#0f2c59'; // Blueprint Blue
      gridCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'dot-grid' || backgroundStyle === 'line-grid' || backgroundStyle === 'isometric-grid') {
      gridCtx.fillStyle = isLightThemeVal ? 'rgba(255, 255, 255, 0.85)' : 'rgba(24, 24, 30, 0.7)';
      gridCtx.fillRect(0, 0, w, h);
    }
    
    // Set grid color
    let gridStyleColor = '';
    let gridStyleLineColor = '';
    if (backgroundStyle === 'blackboard') {
      gridStyleColor = 'rgba(235, 230, 215, 0.15)'; // Chalk-like dots
      gridStyleLineColor = 'rgba(235, 230, 215, 0.08)'; // Chalk-like lines
    } else if (backgroundStyle === 'blueprint') {
      gridStyleColor = 'rgba(100, 210, 255, 0.25)'; // Blueprint dots
      gridStyleLineColor = 'rgba(100, 210, 255, 0.15)'; // Blueprint lines
    } else {
      gridStyleColor = isLightThemeVal ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
      gridStyleLineColor = isLightThemeVal ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
    }

    const scaledSpacing = gridSpacing * zoomScale;
    
    if (backgroundStyle === 'dot-grid') {
      gridCtx.fillStyle = gridStyleColor;
      const startX = panOffset.x % scaledSpacing;
      const startY = panOffset.y % scaledSpacing;
      const dotRadius = Math.max(0.5, 1 * zoomScale);
      
      const limitX = w + scaledSpacing;
      const limitY = h + scaledSpacing;
      for (let x = startX - scaledSpacing; x < limitX; x += scaledSpacing) {
        for (let y = startY - scaledSpacing; y < limitY; y += scaledSpacing) {
          if (x < 0 || y < 0 || x > w || y > h) continue;
          gridCtx.beginPath();
          gridCtx.arc(x, y, dotRadius, 0, Math.PI * 2);
          gridCtx.fill();
        }
      }
    } else if (backgroundStyle === 'line-grid' || backgroundStyle === 'blackboard' || backgroundStyle === 'blueprint') {
      gridCtx.strokeStyle = gridStyleLineColor;
      gridCtx.lineWidth = Math.max(0.5, 1 * zoomScale);
      
      const startX = panOffset.x % scaledSpacing;
      const startY = panOffset.y % scaledSpacing;
      
      const limitX = w + scaledSpacing;
      const limitY = h + scaledSpacing;
      
      for (let x = startX - scaledSpacing; x < limitX; x += scaledSpacing) {
        gridCtx.beginPath();
        gridCtx.moveTo(x, 0);
        gridCtx.lineTo(x, h);
        gridCtx.stroke();
      }
      for (let y = startY - scaledSpacing; y < limitY; y += scaledSpacing) {
        gridCtx.beginPath();
        gridCtx.moveTo(0, y);
        gridCtx.lineTo(w, y);
        gridCtx.stroke();
      }
    } else if (backgroundStyle === 'isometric-grid') {
      gridCtx.fillStyle = gridStyleColor;
      const colSpacing = gridSpacing * zoomScale;
      const rowSpacing = colSpacing * 0.866025;
      const dotRadius = Math.max(0.5, 1 * zoomScale);
      
      const startRow = Math.floor(-panOffset.y / rowSpacing) - 1;
      const endRow = Math.ceil((h - panOffset.y) / rowSpacing) + 1;
      const startCol = Math.floor(-panOffset.x / colSpacing) - 1;
      const endCol = Math.ceil((w - panOffset.x) / colSpacing) + 1;
      
      for (let r = startRow; r <= endRow; r++) {
        const y = r * rowSpacing + panOffset.y;
        const xShift = (r % 2 === 0) ? 0 : colSpacing / 2;
        
        for (let c = startCol; c <= endCol; c++) {
          const x = c * colSpacing + xShift + panOffset.x;
          if (x < 0 || y < 0 || x > w || y > h) continue;
          gridCtx.beginPath();
          gridCtx.arc(x, y, dotRadius, 0, Math.PI * 2);
          gridCtx.fill();
        }
      }
    }
  }

  function getTextBounds(text: SketchText) {
    const lines = text.value.split('\n');
    let maxLen = 0;
    lines.forEach(l => { if (l.length > maxLen) maxLen = l.length; });
    const w = maxLen * text.fontSize * 0.55 + 12;
    const h = lines.length * text.fontSize * 1.25 + 6;
    return { w, h };
  }

  function getArrowStart(arrow: SketchArrow): Point | null {
    if (arrow.fromTextId) {
      const text = sketchTexts.find(t => t.id === arrow.fromTextId);
      if (text) {
        const bounds = getTextBounds(text);
        return { x: text.x + bounds.w / 2, y: text.y + bounds.h / 2 };
      }
      return null;
    }
    if (arrow.fromShapeId) {
      const shape = sketchShapes.find(s => s.id === arrow.fromShapeId);
      if (shape) {
        return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
      }
      return null;
    }
    return arrow.fromPoint || null;
  }

  function getArrowEnd(arrow: SketchArrow): Point | null {
    if (arrow.toTextId) {
      const text = sketchTexts.find(t => t.id === arrow.toTextId);
      if (text) {
        const bounds = getTextBounds(text);
        return { x: text.x + bounds.w / 2, y: text.y + bounds.h / 2 };
      }
      return null;
    }
    if (arrow.toShapeId) {
      const shape = sketchShapes.find(s => s.id === arrow.toShapeId);
      if (shape) {
        return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
      }
      return null;
    }
    return arrow.toPoint || null;
  }

  function drawShapeOnCanvas(
    ctx: CanvasRenderingContext2D,
    shape: SketchShape,
    x: number,
    y: number,
    w: number,
    h: number,
    borderW: number
  ) {
    const rand = createSeededRandom(shape.id);
    ctx.save();
    ctx.globalAlpha = shape.opacity;
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = borderW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const borderStyle = shape.borderStyle || 'solid';
    if (borderStyle === 'dashed') {
      ctx.setLineDash([6 * (borderW / 2), 6 * (borderW / 2)]);
    } else if (borderStyle === 'dotted') {
      ctx.setLineDash([1.5 * (borderW / 2), 4.5 * (borderW / 2)]);
    } else {
      ctx.setLineDash([]);
    }

    let fillStyle = 'transparent';
    if (shape.fillColor === 'glass') {
      fillStyle = isLightTheme ? 'rgba(255, 255, 255, 0.45)' : 'rgba(24, 24, 30, 0.45)';
    } else if (shape.fillColor === 'transparent') {
      fillStyle = 'transparent';
    } else if (shape.fillColor === 'tint' || shape.fillColor.endsWith('22')) {
      fillStyle = shape.color + '22';
    } else {
      fillStyle = shape.fillColor;
    }

    const drawRectPath = () => {
      const r = shape.borderRadius || 0;
      if (r > 0) {
        ctx.roundRect(x, y, w, h, r);
      } else {
        ctx.rect(x, y, w, h);
      }
    };

    const drawCirclePath = () => {
      ctx.arc(x + w / 2, y + h / 2, Math.max(w, h) / 2, 0, Math.PI * 2);
    };

    const drawDiamondPath = () => {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
    };

    const fillStyleType = shape.fillStyle || (shape.fillColor === 'tint' ? 'hachure' : 'solid');
    const roughness = shape.roughness !== undefined ? shape.roughness : 1.5;

    // Draw Fill
    if (fillStyle !== 'transparent') {
      if (fillStyleType === 'hachure' || fillStyleType === 'cross-hatch') {
        ctx.strokeStyle = shape.fillColor === 'glass' ? (isLightTheme ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)') : (shape.color + '44');
        ctx.lineWidth = borderW * 0.7;
        const fillPath = shape.type === 'circle' ? drawCirclePath : (shape.type === 'diamond' ? drawDiamondPath : drawRectPath);
        
        fillSketchyHachure(ctx, x, y, w, h, fillPath, rand, 8, Math.PI / 4);
        if (fillStyleType === 'cross-hatch') {
          fillSketchyHachure(ctx, x, y, w, h, fillPath, rand, 8, -Math.PI / 4);
        }
      } else {
        ctx.fillStyle = fillStyle;
        ctx.beginPath();
        if (shape.type === 'circle') drawCirclePath();
        else if (shape.type === 'diamond') drawDiamondPath();
        else drawRectPath();
        ctx.fill();
      }
    }

    // Draw Stroke
    if (borderStyle !== 'none') {
      ctx.strokeStyle = shape.color;
      if (shape.type === 'circle') {
        drawSketchyEllipse(ctx, x + w / 2, y + h / 2, w / 2, h / 2, rand, roughness);
      } else if (shape.type === 'diamond') {
        drawSketchyLine(ctx, x + w / 2, y, x + w, y + h / 2, rand, roughness);
        drawSketchyLine(ctx, x + w, y + h / 2, x + w / 2, y + h, rand, roughness);
        drawSketchyLine(ctx, x + w / 2, y + h, x, y + h / 2, rand, roughness);
        drawSketchyLine(ctx, x, y + h / 2, x + w / 2, y, rand, roughness);
      } else {
        const r = shape.borderRadius || 0;
        if (r > 0) {
          drawSketchyRoundRect(ctx, x, y, w, h, r, rand, roughness);
        } else {
          drawSketchyLine(ctx, x, y, x + w, y, rand, roughness);
          drawSketchyLine(ctx, x + w, y, x + w, y + h, rand, roughness);
          drawSketchyLine(ctx, x + w, y + h, x, y + h, rand, roughness);
          drawSketchyLine(ctx, x, y + h, x, y, rand, roughness);
        }
      }
    }

    ctx.restore();
  }

  function drawArrow(targetCtx: CanvasRenderingContext2D, arrow: SketchArrow) {
    const start = getArrowStart(arrow);
    const end = getArrowEnd(arrow);
    if (!start || !end) return;

    const rand = createSeededRandom(arrow.id);
    targetCtx.save();
    targetCtx.strokeStyle = arrow.color;
    targetCtx.fillStyle = arrow.color;
    targetCtx.lineWidth = 2.5;
    targetCtx.globalAlpha = arrow.opacity;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 20) {
      const shorten = (arrow.toTextId || arrow.toShapeId) ? 32 : 6;
      const newEndX = end.x - (dx / dist) * shorten;
      const newEndY = end.y - (dy / dist) * shorten;

      // Draw sketchy line for shaft
      drawSketchyLine(targetCtx, start.x, start.y, newEndX, newEndY, rand, 1.3);

      // Draw arrowhead if it is an arrow (not type === 'line')
      if (arrow.type !== 'line') {
        const angle = Math.atan2(newEndY - start.y, newEndX - start.x);
        const arrowSize = 10;
        const leftX = newEndX - arrowSize * Math.cos(angle - Math.PI / 6);
        const leftY = newEndY - arrowSize * Math.sin(angle - Math.PI / 6);
        const rightX = newEndX - arrowSize * Math.cos(angle + Math.PI / 6);
        const rightY = newEndY - arrowSize * Math.sin(angle + Math.PI / 6);

        drawSketchyLine(targetCtx, newEndX, newEndY, leftX, leftY, rand, 1.0);
        drawSketchyLine(targetCtx, newEndX, newEndY, rightX, rightY, rand, 1.0);
        drawSketchyLine(targetCtx, leftX, leftY, rightX, rightY, rand, 1.0);
      }
    }
    targetCtx.restore();
  }

  function getDistanceToLine(p: Point, a: Point, b: Point): number {
    const A = p.x - a.x;
    const B = p.y - a.y;
    const C = b.x - a.x;
    const D = b.y - a.y;
    
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
    
    let xx, yy;
    if (param < 0) {
      xx = a.x;
      yy = a.y;
    } else if (param > 1) {
      xx = b.x;
      yy = b.y;
    } else {
      xx = a.x + param * C;
      yy = a.y + param * D;
    }
    
    const dx = p.x - xx;
    const dy = p.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const activeCtx = canvas.getContext('2d');
    if (!activeCtx) return;
    
    const dpr = window.devicePixelRatio || 1;
    
    // Clear canvas
    activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    activeCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply zoom, pan, and dpr transform
    activeCtx.setTransform(zoomScale * dpr, 0, 0, zoomScale * dpr, panOffset.x * dpr, panOffset.y * dpr);
    
    // Draw all strokes
    strokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length === 0) return;
      
      activeCtx.lineCap = 'round';
      activeCtx.lineJoin = 'round';
      
      if (stroke.isEraser) {
        activeCtx.globalCompositeOperation = 'destination-out';
        activeCtx.lineWidth = stroke.width * 2.5;
        activeCtx.globalAlpha = 1.0;
      } else {
        activeCtx.globalCompositeOperation = 'source-over';
        activeCtx.strokeStyle = stroke.color;
        activeCtx.lineWidth = stroke.width;
        activeCtx.globalAlpha = stroke.opacity;
      }
      
      activeCtx.beginPath();
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        activeCtx.arc(p.x, p.y, activeCtx.lineWidth / 2, 0, Math.PI * 2);
        activeCtx.fillStyle = stroke.isEraser ? 'rgba(0,0,0,0)' : stroke.color;
        activeCtx.fill();
      } else if (stroke.points.length === 2) {
        activeCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        activeCtx.lineTo(stroke.points[1].x, stroke.points[1].y);
        activeCtx.stroke();
      } else {
        activeCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        const firstMidX = (stroke.points[0].x + stroke.points[1].x) / 2;
        const firstMidY = (stroke.points[0].y + stroke.points[1].y) / 2;
        activeCtx.lineTo(firstMidX, firstMidY);
        
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
          const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
          activeCtx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
        }
        activeCtx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
        activeCtx.stroke();
      }
    });
    
    // Reset global composite and alpha
    activeCtx.globalCompositeOperation = 'source-over';
    activeCtx.globalAlpha = 1.0;

    // Draw connection lines/arrows
    arrows.forEach(arrow => {
      drawArrow(activeCtx, arrow);
    });

    // Draw all shapes sketchily
    sketchShapes.forEach(shape => {
      drawShapeOnCanvas(
        activeCtx,
        shape,
        shape.x,
        shape.y,
        shape.width,
        shape.height,
        shape.strokeWidth || 2
      );
    });

    // Draw active connecting preview line
    if (connecting && connectingCurrentPoint) {
      activeCtx.save();
      activeCtx.strokeStyle = currentColor;
      activeCtx.lineWidth = 2;
      activeCtx.setLineDash([4, 4]);
      activeCtx.globalAlpha = 0.6;
      activeCtx.fillStyle = currentColor;
      
      let startX = 0;
      let startY = 0;
      if (connectingFromId) {
        const textFrom = sketchTexts.find(t => t.id === connectingFromId);
        if (textFrom) {
          const bounds = getTextBounds(textFrom);
          startX = textFrom.x + bounds.w / 2;
          startY = textFrom.y + bounds.h / 2;
        }
      } else if (connectingFromShapeId) {
        const shapeFrom = sketchShapes.find(s => s.id === connectingFromShapeId);
        if (shapeFrom) {
          startX = shapeFrom.x + shapeFrom.width / 2;
          startY = shapeFrom.y + shapeFrom.height / 2;
        }
      } else if (connectingStartPoint) {
        startX = connectingStartPoint.x;
        startY = connectingStartPoint.y;
      }
      
      const dx = connectingCurrentPoint.x - startX;
      const dy = connectingCurrentPoint.y - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 10) {
        activeCtx.beginPath();
        activeCtx.moveTo(startX, startY);
        activeCtx.lineTo(connectingCurrentPoint.x, connectingCurrentPoint.y);
        activeCtx.stroke();
        
        // Draw preview arrowhead
        if (currentTool !== 'line') {
          const angle = Math.atan2(dy, dx);
          activeCtx.beginPath();
          activeCtx.moveTo(connectingCurrentPoint.x, connectingCurrentPoint.y);
          activeCtx.lineTo(connectingCurrentPoint.x - 6 * Math.cos(angle - Math.PI / 6), connectingCurrentPoint.y - 6 * Math.sin(angle - Math.PI / 6));
          activeCtx.lineTo(connectingCurrentPoint.x - 6 * Math.cos(angle + Math.PI / 6), connectingCurrentPoint.y - 6 * Math.sin(angle + Math.PI / 6));
          activeCtx.closePath();
          activeCtx.fill();
        }
      }
      activeCtx.restore();
    }

    // Draw active drawing shape preview outline
    if (drawingShape && shapeStartPoint && shapeCurrentPoint) {
      activeCtx.save();
      activeCtx.strokeStyle = currentColor;
      activeCtx.lineWidth = Math.max(1.5, brushSize * 0.4);
      activeCtx.setLineDash([4, 4]);
      activeCtx.globalAlpha = 0.6;
      
      const x = Math.min(shapeStartPoint.x, shapeCurrentPoint.x);
      const y = Math.min(shapeStartPoint.y, shapeCurrentPoint.y);
      const w = Math.abs(shapeCurrentPoint.x - shapeStartPoint.x);
      const h = Math.abs(shapeCurrentPoint.y - shapeStartPoint.y);
      
      activeCtx.beginPath();
      if (currentTool === 'rectangle') {
        activeCtx.rect(x, y, w, h);
      } else if (currentTool === 'circle') {
        activeCtx.arc(x + w / 2, y + h / 2, Math.max(w, h) / 2, 0, Math.PI * 2);
      } else if (currentTool === 'diamond') {
        activeCtx.moveTo(x + w / 2, y);
        activeCtx.lineTo(x + w, y + h / 2);
        activeCtx.lineTo(x + w / 2, y + h);
        activeCtx.lineTo(x, y + h / 2);
        activeCtx.closePath();
      }
      activeCtx.stroke();
      activeCtx.restore();
    }
  }

  // Save state to undo history
  function saveState(projectId: string | null | undefined = resolveStorageProjectId()) {
    const stateObj = createPersistedState();
    const stateStr = JSON.stringify(stateObj);
    
    undoStackRef.current.push(stateStr);
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    setCanUndo(true);
    
    redoStackRef.current = [];
    setCanRedo(false);

    persistStateString(stateStr, projectId);
  }

  // Restore drawing state
  function restoreState(
    stateStr: string,
    options: { persist?: boolean; projectId?: string | null } = {}
  ) {
    try {
      const stateObj = JSON.parse(stateStr) as PersistedSketchState;
      setBackgroundStyle(stateObj.backgroundStyle ?? 'transparent');
      setGridSpacing(stateObj.gridSpacing ?? 24);
      setSnapToGrid(stateObj.snapToGrid ?? false);
      setZoomScale(stateObj.zoomScale ?? 1.0);
      setPanOffset(stateObj.panOffset ?? { x: 0, y: 0 });
      setStrokes(stateObj.strokes ?? []);
      setSketchTexts(stateObj.texts ?? []);
      setArrows(stateObj.arrows ?? []);
      setSketchShapes(stateObj.shapes ?? []);
      if (options.persist !== false) {
        persistStateString(stateStr, options.projectId);
      }
    } catch (e) {
      console.error('Failed to restore state:', e);
    }
  }

  // Load sketch from local storage
  function loadSavedSketch(projectId: string | null | undefined = resolveStorageProjectId()) {
    resetCanvasDocument();
    if (typeof localStorage === 'undefined') return;

    const resolvedProjectId = resolveStorageProjectId(projectId);
    if (!resolvedProjectId) return;

    const projectKey = getSketchStorageKey(resolvedProjectId);
    const savedProjectState = localStorage.getItem(projectKey);
    if (savedProjectState) {
      restoreState(savedProjectState, { persist: false, projectId: resolvedProjectId });
      undoStackRef.current = [savedProjectState];
      setCanUndo(true);
      return;
    }

    const legacyOwner = localStorage.getItem(LEGACY_SKETCH_OWNER_KEY);
    if (!legacyOwner || legacyOwner === resolvedProjectId) {
      const legacyState = localStorage.getItem(LEGACY_SKETCH_STATE_V3_KEY) ?? localStorage.getItem(LEGACY_SKETCH_STATE_V2_KEY);
      if (legacyState) {
        restoreState(legacyState, { persist: false, projectId: resolvedProjectId });
        undoStackRef.current = [legacyState];
        setCanUndo(true);
        persistStateString(legacyState, resolvedProjectId);
        localStorage.setItem(LEGACY_SKETCH_OWNER_KEY, resolvedProjectId);
      }
    }
  }

  // Export drawing data to JSON file
  function exportJSON() {
    try {
      const s = stateRef.current;
      const data = {
        version: '1.1.0',
        backgroundStyle: s.backgroundStyle,
        gridSpacing: s.gridSpacing,
        snapToGrid: s.snapToGrid,
        zoomScale: s.zoomScale,
        panOffset: s.panOffset,
        strokes: s.strokes,
        sketchTexts: s.sketchTexts,
        arrows: s.arrows,
        sketchShapes: s.sketchShapes
      };
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `soryq-canvas-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setShowSettingsDropdown(false);
      showToast('Canvas exported successfully', 'success');
    } catch (err) {
      console.error('Failed to export canvas:', err);
      showToast('Failed to export canvas', 'error');
    }
  }

  // Import drawing data from JSON file
  function handleJSONImport(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);
        
        if (data.backgroundStyle !== undefined) setBackgroundStyle(data.backgroundStyle);
        if (data.gridSpacing !== undefined) setGridSpacing(data.gridSpacing);
        if (data.snapToGrid !== undefined) setSnapToGrid(data.snapToGrid);
        if (data.zoomScale !== undefined) setZoomScale(data.zoomScale);
        if (data.panOffset !== undefined) setPanOffset(data.panOffset);
        if (Array.isArray(data.strokes)) setStrokes(data.strokes);
        if (Array.isArray(data.sketchTexts)) setSketchTexts(data.sketchTexts);
        if (Array.isArray(data.arrows)) setArrows(data.arrows);
        if (Array.isArray(data.sketchShapes)) {
          setSketchShapes(data.sketchShapes);
        } else {
          setSketchShapes([]);
        }
        
        saveState();
        setShowSettingsDropdown(false);
        showToast('Canvas imported successfully', 'success');
      } catch (err) {
        console.error('Failed to import canvas:', err);
        showToast('Invalid file format or corrupted canvas data', 'error');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  // Commit text inputs into floating draggable divs
  function commitText(projectId: string | null | undefined = resolveStorageProjectId()) {
    if (!activeTextInput) return;
    const trimmed = activeTextInput.value.trim();
    if (trimmed) {
      const newText: SketchText = {
        id: Math.random().toString(36).substring(2, 9),
        x: activeTextInput.x,
        y: activeTextInput.y,
        value: trimmed,
        color: currentColor,
        fontSize: Math.max(13, brushSize * 2.5),
        opacity: brushOpacity,
        fontFamily: defaultFontFamily
      };
      setSketchTexts(prev => {
        const next = [...prev, newText];
        // Timeout to ensure state resolves before persisting
        setTimeout(() => {
          saveState(projectId);
        }, 10);
        return next;
      });
    }
    setActiveTextInput(null);
  }

  // Pointer down (start drawing, typing, or panning)
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (!target.closest('.floating-shape') && !target.closest('.shape-context-menu')) {
      setSelectedShapeId(null);
    }

    if (e.button === 1 || e.button === 2 || currentTool === 'pan' || spacePressed) {
      // Pan mode
      setPanning(true);
      panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      try {
        viewportRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (e.button !== 0) return; // Only draw/type with left click
    if (!canvasRef.current || !viewportRef.current) return;

    const worldCoords = screenToWorld(e.clientX, e.clientY);

    if (currentTool === 'eraser') {
      // Check if we clicked close to an arrow to delete it
      const clickedArrowIndex = arrows.findIndex(arrow => {
        const start = getArrowStart(arrow);
        const end = getArrowEnd(arrow);
        if (!start || !end) return false;
        const dist = getDistanceToLine(worldCoords, start, end);
        return dist < 12; // 12px threshold
      });
      
      if (clickedArrowIndex !== -1) {
        setArrows(prev => {
          const next = prev.filter((_, idx) => idx !== clickedArrowIndex);
          setTimeout(() => saveState(), 10);
          return next;
        });
        return;
      }
    }

    if (currentTool === 'rectangle' || currentTool === 'circle' || currentTool === 'diamond') {
      e.preventDefault();
      if (activeTextInput) {
        commitText();
      }
      setDrawingShape(true);
      setShapeStartPoint(worldCoords);
      setShapeCurrentPoint(worldCoords);
      try {
        viewportRef.current.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (currentTool === 'connector' || currentTool === 'line') {
      e.preventDefault();
      if (activeTextInput) {
        commitText();
      }
      setConnectingStartPoint(worldCoords);
      setConnectingCurrentPoint(worldCoords);
      setConnecting(true);
      setConnectingFromId(null);
      setConnectingFromShapeId(null);
      try {
        viewportRef.current.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (currentTool === 'text') {
      e.preventDefault();
      if (activeTextInput) {
        commitText();
      }
      setActiveTextInput({ x: worldCoords.x, y: worldCoords.y, value: '' });
      return;
    }

    if (activeTextInput) {
      commitText();
    }

    // Don't start freeform drawing if in select tool
    if (currentTool === 'select') return;

    try {
      viewportRef.current.setPointerCapture(e.pointerId);
    } catch {}

    drawingRef.current = true;
    currentStrokeRef.current = {
      points: [worldCoords],
      color: currentColor,
      width: brushSize,
      opacity: brushOpacity,
      isEraser: currentTool === 'eraser'
    };

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(zoomScale * dpr, 0, 0, zoomScale * dpr, panOffset.x * dpr, panOffset.y * dpr);
    
    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize * 2.5;
      ctx.globalAlpha = 1.0;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.globalAlpha = brushOpacity;
    }

    ctx.beginPath();
    ctx.arc(worldCoords.x, worldCoords.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = currentTool === 'eraser' ? 'rgba(0,0,0,0)' : currentColor;
    ctx.fill();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (panning) {
      setPanOffset({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      });
      return;
    }

    if (drawingShape) {
      setShapeCurrentPoint(screenToWorld(e.clientX, e.clientY));
      return;
    }

    if (connecting) {
      setConnectingCurrentPoint(screenToWorld(e.clientX, e.clientY));
      return;
    }

    if (currentTool === 'text' || currentTool === 'pan' || currentTool === 'select') return;
    if (!drawingRef.current || !canvasRef.current || !currentStrokeRef.current) return;
    
    const worldCoords = screenToWorld(e.clientX, e.clientY);
    const lastPoint = currentStrokeRef.current.points[currentStrokeRef.current.points.length - 1];
    if (lastPoint && lastPoint.x === worldCoords.x && lastPoint.y === worldCoords.y) return;
    
    currentStrokeRef.current.points.push(worldCoords);

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(zoomScale * dpr, 0, 0, zoomScale * dpr, panOffset.x * dpr, panOffset.y * dpr);
    
    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize * 2.5;
      ctx.globalAlpha = 1.0;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.globalAlpha = brushOpacity;
    }

    const len = currentStrokeRef.current.points.length;
    if (len === 2) {
      ctx.beginPath();
      ctx.moveTo(currentStrokeRef.current.points[0].x, currentStrokeRef.current.points[0].y);
      ctx.lineTo(currentStrokeRef.current.points[1].x, currentStrokeRef.current.points[1].y);
      ctx.stroke();
    } else if (len > 2) {
      const i = len - 2;
      const xc = (currentStrokeRef.current.points[i].x + currentStrokeRef.current.points[i + 1].x) / 2;
      const yc = (currentStrokeRef.current.points[i].y + currentStrokeRef.current.points[i + 1].y) / 2;
      const prev_xc = (currentStrokeRef.current.points[i - 1].x + currentStrokeRef.current.points[i].x) / 2;
      const prev_yc = (currentStrokeRef.current.points[i - 1].y + currentStrokeRef.current.points[i].y) / 2;
      
      ctx.beginPath();
      ctx.moveTo(prev_xc, prev_yc);
      ctx.quadraticCurveTo(currentStrokeRef.current.points[i].x, currentStrokeRef.current.points[i].y, xc, yc);
      ctx.stroke();
    }
  }

  // Pointer up (drawing or panning finished)
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (panning) {
      setPanning(false);
      try {
        viewportRef.current?.releasePointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (drawingShape) {
      try {
        viewportRef.current?.releasePointerCapture(e.pointerId);
      } catch {}
      
      const start = shapeStartPoint;
      const end = shapeCurrentPoint;
      if (start && end) {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.max(10, Math.abs(end.x - start.x));
        const height = Math.max(10, Math.abs(end.y - start.y));
        
        if (width > 15 || height > 15) {
          // Create new shape
          const newShape: SketchShape = {
            id: Math.random().toString(36).substring(2, 9),
            type: currentTool as 'rectangle' | 'circle' | 'diamond',
            x,
            y,
            width,
            height,
            color: currentColor,
            fillColor: defaultFillStyle === 'transparent' ? 'transparent' : (defaultFillStyle === 'solid' ? defaultFillColor : 'tint'),
            borderStyle: defaultStrokeStyle,
            borderRadius: currentTool === 'circle' ? 9999 : (currentTool === 'diamond' ? 0 : 8),
            opacity: brushOpacity,
            text: '',
            strokeWidth: defaultStrokeWidth,
            roughness: defaultRoughness,
            fontFamily: defaultFontFamily,
            fillStyle: defaultFillStyle
          };
          
          setSketchShapes(prev => {
            const next = [...prev, newShape];
            setTimeout(() => {
              saveState();
              setCurrentTool('select');
              setSelectedShapeId(newShape.id);
            }, 10);
            return next;
          });
        }
      }
      setDrawingShape(false);
      setShapeStartPoint(null);
      setShapeCurrentPoint(null);
      return;
    }

    if (connecting) {
      try {
        viewportRef.current?.releasePointerCapture(e.pointerId);
      } catch {}

      let targetTextId: string | undefined = undefined;
      let targetShapeId: string | undefined = undefined;
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      
      const textEl = targetEl?.closest('.floating-text');
      if (textEl) {
        const id = textEl.getAttribute('data-text-id');
        if (id && id !== connectingFromId) {
          targetTextId = id;
        }
      }
      
      const shapeEl = targetEl?.closest('.floating-shape');
      if (shapeEl) {
        const id = shapeEl.getAttribute('data-shape-id');
        if (id && id !== connectingFromShapeId) {
          targetShapeId = id;
        }
      }

      const worldCoords = screenToWorld(e.clientX, e.clientY);
      const isLineTool = currentTool === 'line';
      const newArrow: SketchArrow = {
        id: Math.random().toString(36).substring(2, 9),
        fromTextId: isLineTool ? undefined : (connectingFromId || undefined),
        fromShapeId: isLineTool ? undefined : (connectingFromShapeId || undefined),
        toTextId: isLineTool ? undefined : targetTextId,
        toShapeId: isLineTool ? undefined : targetShapeId,
        fromPoint: (isLineTool || (!connectingFromId && !connectingFromShapeId)) ? (connectingStartPoint || undefined) : undefined,
        toPoint: (isLineTool || (!targetTextId && !targetShapeId)) ? worldCoords : undefined,
        color: currentColor,
        opacity: brushOpacity,
        type: isLineTool ? 'line' : 'arrow'
      };

      setArrows(prev => {
        const next = [...prev, newArrow];
        setTimeout(() => saveState(), 10);
        return next;
      });

      setConnecting(false);
      setConnectingFromId(null);
      setConnectingFromShapeId(null);
      setConnectingStartPoint(null);
      setConnectingCurrentPoint(null);
      return;
    }

    if (currentTool === 'text' || currentTool === 'pan' || currentTool === 'select') return;
    if (!drawingRef.current || !currentStrokeRef.current) return;
    try {
      viewportRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
    
    drawingRef.current = false;
    const finalStroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    
    setStrokes(prev => {
      const next = [...prev, finalStroke];
      setTimeout(() => saveState(), 10);
      return next;
    });
  }

  // Drag text elements
  function startDragText(e: React.PointerEvent<HTMLDivElement>, text: SketchText) {
    if (currentTool === 'pen') return; // Bubble up to canvas to draw strokes

    if (currentTool === 'eraser') {
      setSketchTexts(prev => {
        const next = prev.filter(t => t.id !== text.id);
        setTimeout(() => saveState(), 10);
        return next;
      });
      setArrows(prev => prev.filter(a => a.fromTextId !== text.id && a.toTextId !== text.id));
      return;
    }

    if (currentTool === 'connector') {
      e.stopPropagation();
      e.preventDefault();
      setConnectingFromId(text.id);
      setConnectingFromShapeId(null);
      const worldCoords = screenToWorld(e.clientX, e.clientY);
      setConnectingStartPoint(worldCoords);
      setConnectingCurrentPoint(worldCoords);
      setConnecting(true);
      try {
        viewportRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    
    e.stopPropagation();
    commitText();

    draggingTextIdRef.current = text.id;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    textStartRef.current = { x: text.x, y: text.y };

    window.addEventListener('pointermove', handleTextDragMove);
    window.addEventListener('pointerup', handleTextDragUp);
  }

  function handleTextDragMove(e: PointerEvent) {
    const { zoomScale, snapToGrid, backgroundStyle, gridSpacing } = stateRef.current;
    if (!draggingTextIdRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const cssZoom = rect.width / viewportRef.current.clientWidth;
    
    const deltaX = ((e.clientX - dragStartRef.current.x) / cssZoom) / zoomScale;
    const deltaY = ((e.clientY - dragStartRef.current.y) / cssZoom) / zoomScale;
    
    setSketchTexts(prevTexts => prevTexts.map(t => {
      if (t.id === draggingTextIdRef.current) {
        let targetX = textStartRef.current.x + deltaX;
        let targetY = textStartRef.current.y + deltaY;
        
        if (snapToGrid) {
          if (backgroundStyle === 'isometric-grid') {
            const rowSpacing = gridSpacing * 0.86602540378; // Math.sqrt(3)/2
            const r = Math.round(targetY / rowSpacing);
            const xShift = (r % 2 === 0) ? 0 : gridSpacing / 2;
            const c = Math.round((targetX - xShift) / gridSpacing);
            targetX = c * gridSpacing + xShift;
            targetY = r * rowSpacing;
          } else {
            targetX = Math.round(targetX / gridSpacing) * gridSpacing;
            targetY = Math.round(targetY / gridSpacing) * gridSpacing;
          }
        }
        
        return {
          ...t,
          x: targetX,
          y: targetY
        };
      }
      return t;
    }));
  }

  function handleTextDragUp() {
    if (draggingTextIdRef.current) {
      draggingTextIdRef.current = null;
      saveState();
    }
    window.removeEventListener('pointermove', handleTextDragMove);
    window.removeEventListener('pointerup', handleTextDragUp);
  }

  // Drag shape elements
  function startDragShape(e: React.PointerEvent<HTMLDivElement>, shape: SketchShape) {
    if (currentTool === 'pen') return; // Bubble up to canvas to draw strokes

    if (currentTool === 'eraser') {
      setSketchShapes(prev => {
        const next = prev.filter(s => s.id !== shape.id);
        setTimeout(() => saveState(), 10);
        return next;
      });
      setArrows(prev => prev.filter(a => a.fromShapeId !== shape.id && a.toShapeId !== shape.id));
      return;
    }

    if (currentTool === 'connector') {
      e.stopPropagation();
      e.preventDefault();
      setConnectingFromShapeId(shape.id);
      setConnectingFromId(null);
      const worldCoords = screenToWorld(e.clientX, e.clientY);
      setConnectingStartPoint(worldCoords);
      setConnectingCurrentPoint(worldCoords);
      setConnecting(true);
      try {
        viewportRef.current?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    // Set selected shape
    setSelectedShapeId(shape.id);

    if (e.target && (e.target as HTMLElement).classList.contains('resize-handle')) {
      return; // Handled by resize handler
    }

    e.stopPropagation();
    commitText();

    draggingShapeIdRef.current = shape.id;
    dragShapeStartRef.current = { x: e.clientX, y: e.clientY };
    shapeStartCoordsRef.current = { x: shape.x, y: shape.y };

    window.addEventListener('pointermove', handleShapeDragMove);
    window.addEventListener('pointerup', handleShapeDragUp);
  }

  function handleShapeDragMove(e: PointerEvent) {
    const { zoomScale, snapToGrid, gridSpacing } = stateRef.current;
    if (!draggingShapeIdRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const cssZoom = rect.width / viewportRef.current.clientWidth;
    
    const deltaX = ((e.clientX - dragShapeStartRef.current.x) / cssZoom) / zoomScale;
    const deltaY = ((e.clientY - dragShapeStartRef.current.y) / cssZoom) / zoomScale;
    
    setSketchShapes(prevShapes => prevShapes.map(s => {
      if (s.id === draggingShapeIdRef.current) {
        let targetX = shapeStartCoordsRef.current.x + deltaX;
        let targetY = shapeStartCoordsRef.current.y + deltaY;
        
        if (snapToGrid) {
          targetX = Math.round(targetX / gridSpacing) * gridSpacing;
          targetY = Math.round(targetY / gridSpacing) * gridSpacing;
        }
        
        return {
          ...s,
          x: targetX,
          y: targetY
        };
      }
      return s;
    }));
  }

  function handleShapeDragUp() {
    if (draggingShapeIdRef.current) {
      draggingShapeIdRef.current = null;
      saveState();
    }
    window.removeEventListener('pointermove', handleShapeDragMove);
    window.removeEventListener('pointerup', handleShapeDragUp);
  }

  // Resize shape elements
  function startResizeShape(e: React.PointerEvent<HTMLDivElement>, shape: SketchShape) {
    e.stopPropagation();
    e.preventDefault();
    resizingShapeIdRef.current = shape.id;
    resizeShapeStartRef.current = { x: e.clientX, y: e.clientY };
    shapeStartDimsRef.current = { width: shape.width, height: shape.height };

    window.addEventListener('pointermove', handleShapeResizeMove);
    window.addEventListener('pointerup', handleShapeResizeUp);
  }

  function handleShapeResizeMove(e: PointerEvent) {
    const { zoomScale, snapToGrid, gridSpacing } = stateRef.current;
    if (!resizingShapeIdRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const cssZoom = rect.width / viewportRef.current.clientWidth;
    
    const deltaX = ((e.clientX - resizeShapeStartRef.current.x) / cssZoom) / zoomScale;
    const deltaY = ((e.clientY - resizeShapeStartRef.current.y) / cssZoom) / zoomScale;
    
    setSketchShapes(prevShapes => prevShapes.map(s => {
      if (s.id === resizingShapeIdRef.current) {
        let targetWidth = shapeStartDimsRef.current.width + deltaX;
        let targetHeight = shapeStartDimsRef.current.height + deltaY;
        
        if (snapToGrid) {
          targetWidth = Math.round(targetWidth / gridSpacing) * gridSpacing;
          targetHeight = Math.round(targetHeight / gridSpacing) * gridSpacing;
        }
        
        return {
          ...s,
          width: Math.max(15, targetWidth),
          height: Math.max(15, targetHeight)
        };
      }
      return s;
    }));
  }

  function handleShapeResizeUp() {
    if (resizingShapeIdRef.current) {
      resizingShapeIdRef.current = null;
      saveState();
    }
    window.removeEventListener('pointermove', handleShapeResizeMove);
    window.removeEventListener('pointerup', handleShapeResizeUp);
  }

  // Edit text inside shape
  function editShapeText(shape: SketchShape) {
    commitText();
    setActiveShapeTextInput({ id: shape.id, value: shape.text });
  }

  function commitShapeText(id: string) {
    if (!activeShapeTextInput) return;
    const textVal = activeShapeTextInput.value;
    setSketchShapes(prev => {
      const next = prev.map(s => {
        if (s.id === id) {
          return { ...s, text: textVal };
        }
        return s;
      });
      setTimeout(() => saveState(), 10);
      return next;
    });
    setActiveShapeTextInput(null);
  }

  function handleShapeTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, id: string) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setActiveShapeTextInput(null);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitShapeText(id);
    }
  }

  // Helper to update properties of the active selection (shape, text, or arrow)
  function updateSelectedProperty(property: string, value: any) {
    if (selectedShapeId) {
      setSketchShapes(prev => {
        const next = prev.map(s => {
          if (s.id === selectedShapeId) {
            let val = value;
            if (property === 'fillColor' && typeof value === 'string' && value.endsWith('22')) {
              val = s.color + '22';
            }
            return { ...s, [property]: val };
          }
          return s;
        });
        setTimeout(() => saveState(), 10);
        return next;
      });
    } else if (selectedTextId) {
      setSketchTexts(prev => {
        const next = prev.map(t => {
          if (t.id === selectedTextId) {
            return { ...t, [property]: value };
          }
          return t;
        });
        setTimeout(() => saveState(), 10);
        return next;
      });
    } else if (selectedArrowId) {
      setArrows(prev => {
        const next = prev.map(a => {
          if (a.id === selectedArrowId) {
            return { ...a, [property]: value };
          }
          return a;
        });
        setTimeout(() => saveState(), 10);
        return next;
      });
    } else {
      // No active selection, update defaults
      if (property === 'color') setCurrentColor(value);
      else if (property === 'fillColor') setDefaultFillColor(value);
      else if (property === 'fillStyle') setDefaultFillStyle(value);
      else if (property === 'strokeWidth') setDefaultStrokeWidth(value);
      else if (property === 'borderStyle') setDefaultStrokeStyle(value);
      else if (property === 'roughness') setDefaultRoughness(value);
      else if (property === 'fontFamily') setDefaultFontFamily(value);
      else if (property === 'opacity') setBrushOpacity(value);
    }
  }

  // Get properties of the active selection (for highlighting button states in left panel)
  function getSelectedProperty(property: string, defaultValue: any) {
    if (selectedShapeId) {
      const shape = sketchShapes.find(s => s.id === selectedShapeId);
      if (shape && property in shape) {
        return (shape as any)[property];
      }
    } else if (selectedTextId) {
      const text = sketchTexts.find(t => t.id === selectedTextId);
      if (text && property in text) {
        return (text as any)[property];
      }
    } else if (selectedArrowId) {
      const arrow = arrows.find(a => a.id === selectedArrowId);
      if (arrow && property in arrow) {
        return (arrow as any)[property];
      }
    }
    return defaultValue;
  }

  function updateSelectedColor(color: string) {
    if (selectedShapeId) {
      updateShapeColor(selectedShapeId, color);
    } else if (selectedTextId) {
      updateSelectedProperty('color', color);
    } else if (selectedArrowId) {
      updateSelectedProperty('color', color);
    } else {
      setCurrentColor(color);
      if (currentTool === 'eraser') setCurrentTool('pen');
    }
  }

  // Update shape properties
  function updateShapeProperty(id: string, property: keyof SketchShape, value: any) {
    setSketchShapes(prev => {
      const next = prev.map(s => {
        if (s.id === id) {
          let val = value;
          if (property === 'fillColor' && value.endsWith('22')) {
            val = s.color + '22';
          }
          return { ...s, [property]: val };
        }
        return s;
      });
      setTimeout(() => saveState(), 10);
      return next;
    });
  }

  function updateShapeColor(id: string, color: string) {
    setSketchShapes(prev => {
      const next = prev.map(s => {
        if (s.id === id) {
          let fillColor = s.fillColor;
          if (fillColor !== 'transparent' && fillColor !== 'glass') {
            if (fillColor.endsWith('22')) {
              fillColor = color + '22';
            } else {
              fillColor = color;
            }
          }
          return { ...s, color, fillColor };
        }
        return s;
      });
      setTimeout(() => saveState(), 10);
      return next;
    });
  }

  function moveShapeLayer(id: string, direction: 'front' | 'back') {
    setSketchShapes(prev => {
      const shape = prev.find(s => s.id === id);
      if (!shape) return prev;
      
      const remaining = prev.filter(s => s.id !== id);
      const next = direction === 'front' ? [...remaining, shape] : [shape, ...remaining];
      setTimeout(() => saveState(), 10);
      return next;
    });
  }

  function deleteShape(id: string) {
    setSketchShapes(prev => {
      const next = prev.filter(s => s.id !== id);
      setTimeout(() => saveState(), 10);
      return next;
    });
    setArrows(prev => prev.filter(a => a.fromShapeId !== id && a.toShapeId !== id));
    if (selectedShapeId === id) {
      setSelectedShapeId(null);
    }
  }

  function deleteText(id: string) {
    setSketchTexts(prev => {
      const next = prev.filter(t => t.id !== id);
      setTimeout(() => saveState(), 10);
      return next;
    });
    setArrows(prev => prev.filter(a => a.fromTextId !== id && a.toTextId !== id));
    if (selectedTextId === id) {
      setSelectedTextId(null);
    }
  }

  function deleteArrow(id: string) {
    setArrows(prev => {
      const next = prev.filter(a => a.id !== id);
      setTimeout(() => saveState(), 10);
      return next;
    });
    if (selectedArrowId === id) {
      setSelectedArrowId(null);
    }
  }

  function deleteSelected() {
    if (selectedShapeId) deleteShape(selectedShapeId);
    else if (selectedTextId) deleteText(selectedTextId);
    else if (selectedArrowId) deleteArrow(selectedArrowId);
  }

  // Edit existing text boxes
  function editExistingText(text: SketchText) {
    commitText();
    setActiveTextInput({ x: text.x, y: text.y, value: text.value });
    setCurrentColor(text.color);
    setBrushSize(Math.round(text.fontSize / 2.5));
    setBrushOpacity(text.opacity);
    setSketchTexts(prev => {
      const next = prev.filter(t => t.id !== text.id);
      setTimeout(() => saveState(), 10);
      return next;
    });
  }

  // Zoom centered on coordinates
  function zoomCentered(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const beforeZoomX = (centerX - panOffset.x) / zoomScale;
    const beforeZoomY = (centerY - panOffset.y) / zoomScale;
    
    let nextZoom = factor > 1 ? Math.min(5.0, zoomScale * factor) : Math.max(0.1, zoomScale * factor);
    
    setPanOffset({
      x: centerX - beforeZoomX * nextZoom,
      y: centerY - beforeZoomY * nextZoom
    });
    setZoomScale(nextZoom);
  }

  function resetZoom() {
    setZoomScale(1.0);
    setPanOffset({ x: 0, y: 0 });
  }

  // Wheel listener (touchpad gestures + mouse wheel zoom)
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    
    const rect = viewport.getBoundingClientRect();
    const cssZoom = rect.width / viewport.clientWidth;
    
    const mouseX = (e.clientX - rect.left) / cssZoom;
    const mouseY = (e.clientY - rect.top) / cssZoom;
    
    const { zoomScale: currentZoom, panOffset: currentPan } = stateRef.current;

    if (e.ctrlKey) {
      // Touchpad Pinch gesture or Ctrl + Mouse Wheel
      const zoomFactor = 1 - e.deltaY * 0.01;
      
      const beforeZoomX = (mouseX - currentPan.x) / currentZoom;
      const beforeZoomY = (mouseY - currentPan.y) / currentZoom;
      
      let nextZoom = Math.min(5.0, Math.max(0.1, currentZoom * zoomFactor));
      
      setPanOffset({
        x: mouseX - beforeZoomX * nextZoom,
        y: mouseY - beforeZoomY * nextZoom
      });
      setZoomScale(nextZoom);
    } else {
      // Two-finger scroll panning
      setPanOffset({
        x: currentPan.x - e.deltaX / cssZoom,
        y: currentPan.y - e.deltaY / cssZoom
      });
    }
  }

  // Undo last action
  function undo() {
    commitText();
    if (undoStackRef.current.length === 0) return;
    
    const currentStateObj = createPersistedState();
    redoStackRef.current.push(JSON.stringify(currentStateObj));
    setCanRedo(true);
    
    const updatedUndo = [...undoStackRef.current];
    updatedUndo.pop();
    undoStackRef.current = updatedUndo;
    
    if (updatedUndo.length > 0) {
      const prevStateStr = updatedUndo[updatedUndo.length - 1];
      restoreState(prevStateStr);
    } else {
      resetCanvasDocument();
      clearPersistedSketch();
    }
    setCanUndo(updatedUndo.length > 0);
  }

  // Redo action
  function redo() {
    commitText();
    if (redoStackRef.current.length === 0) return;
    
    const nextStateStr = redoStackRef.current[redoStackRef.current.length - 1];
    const updatedRedo = [...redoStackRef.current];
    updatedRedo.pop();
    redoStackRef.current = updatedRedo;
    setCanRedo(updatedRedo.length > 0);
    
    undoStackRef.current.push(nextStateStr);
    setCanUndo(true);
    restoreState(nextStateStr);
  }

  // Clear canvas
  function handleClear() {
    commitText();
    if (!clearConfirm) {
      setClearConfirm(true);
      if (clearConfirmTimeoutRef.current) clearTimeout(clearConfirmTimeoutRef.current);
      clearConfirmTimeoutRef.current = setTimeout(() => {
        setClearConfirm(false);
      }, 2000);
      return;
    }
    
    setClearConfirm(false);
    resetCanvasDocument();
    clearPersistedSketch();
    showToast('Canvas cleared', 'info');
  }

  // Export current sketch drawing as a PNG image
  function compilePNG(): HTMLCanvasElement | null {
    if (!viewportRef.current) return null;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewportWidth;
    tempCanvas.height = viewportHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;
    
    const w = tempCanvas.width;
    const h = tempCanvas.height;
    const isLightThemeVal = document.documentElement.classList.contains('light-theme');
    
    // Draw background
    if (backgroundStyle === 'solid-dark') {
      tempCtx.fillStyle = '#121216';
      tempCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'solid-light') {
      tempCtx.fillStyle = '#f3f3f6';
      tempCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'dot-grid' || backgroundStyle === 'line-grid') {
      tempCtx.fillStyle = isLightThemeVal ? '#ffffff' : '#18181e';
      tempCtx.fillRect(0, 0, w, h);
    } else {
      // transparent mode - use theme color background
      tempCtx.fillStyle = isLightThemeVal ? '#ffffff' : '#18181e';
      tempCtx.fillRect(0, 0, w, h);
    }
    
    // Draw Grid Lines/Dots
    if (backgroundStyle === 'dot-grid') {
      tempCtx.fillStyle = isLightThemeVal ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
      const dotSpacing = 24;
      const scaledSpacing = dotSpacing * zoomScale;
      const startX = panOffset.x % scaledSpacing;
      const startY = panOffset.y % scaledSpacing;
      const dotRadius = Math.max(0.5, 1 * zoomScale);
      
      const limitX = w + scaledSpacing;
      const limitY = h + scaledSpacing;
      for (let x = startX - scaledSpacing; x < limitX; x += scaledSpacing) {
        for (let y = startY - scaledSpacing; y < limitY; y += scaledSpacing) {
          if (x < 0 || y < 0 || x > w || y > h) continue;
          tempCtx.beginPath();
          tempCtx.arc(x, y, dotRadius, 0, Math.PI * 2);
          tempCtx.fill();
        }
      }
    } else if (backgroundStyle === 'line-grid') {
      tempCtx.strokeStyle = isLightThemeVal ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
      tempCtx.lineWidth = Math.max(0.5, 1 * zoomScale);
      const lineSpacing = 24;
      const scaledSpacing = lineSpacing * zoomScale;
      const startX = panOffset.x % scaledSpacing;
      const startY = panOffset.y % scaledSpacing;
      const limitX = w + scaledSpacing;
      const limitY = h + scaledSpacing;
      
      for (let x = startX - scaledSpacing; x < limitX; x += scaledSpacing) {
        tempCtx.beginPath();
        tempCtx.moveTo(x, 0);
        tempCtx.lineTo(x, h);
        tempCtx.stroke();
      }
      for (let y = startY - scaledSpacing; y < limitY; y += scaledSpacing) {
        tempCtx.beginPath();
        tempCtx.moveTo(0, y);
        tempCtx.lineTo(w, y);
        tempCtx.stroke();
      }
    }
    
    // Draw Vector Strokes
    tempCtx.setTransform(zoomScale, 0, 0, zoomScale, panOffset.x, panOffset.y);
    strokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length === 0) return;
      
      tempCtx.lineCap = 'round';
      tempCtx.lineJoin = 'round';
      
      if (stroke.isEraser) {
        tempCtx.globalCompositeOperation = 'destination-out';
        tempCtx.lineWidth = stroke.width * 2.5;
        tempCtx.globalAlpha = 1.0;
      } else {
        tempCtx.globalCompositeOperation = 'source-over';
        tempCtx.strokeStyle = stroke.color;
        tempCtx.lineWidth = stroke.width;
        tempCtx.globalAlpha = stroke.opacity;
      }
      
      tempCtx.beginPath();
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        tempCtx.arc(p.x, p.y, tempCtx.lineWidth / 2, 0, Math.PI * 2);
        tempCtx.fillStyle = stroke.isEraser ? 'rgba(0,0,0,0)' : stroke.color;
        tempCtx.fill();
      } else if (stroke.points.length === 2) {
        tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        tempCtx.lineTo(stroke.points[1].x, stroke.points[1].y);
        tempCtx.stroke();
      } else {
        tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        const firstMidX = (stroke.points[0].x + stroke.points[1].x) / 2;
        const firstMidY = (stroke.points[0].y + stroke.points[1].y) / 2;
        tempCtx.lineTo(firstMidX, firstMidY);
        
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
          const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
          tempCtx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
        }
        tempCtx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
        tempCtx.stroke();
      }
    });

    // Draw connection lines/arrows
    arrows.forEach(arrow => {
      drawArrow(tempCtx, arrow);
    });
    
    // Reset composite operation and transform for drawing text
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.globalAlpha = 1.0;
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Draw Floating Text Elements
    sketchTexts.forEach(text => {
      tempCtx.fillStyle = text.color;
      tempCtx.globalAlpha = text.opacity;
      const displayFontSize = text.fontSize * zoomScale;
      const fontFam = text.fontFamily === 'monospace' ? 'monospace' : (text.fontFamily === 'sans-serif' ? 'sans-serif' : '"Architects Daughter", "Caveat", cursive');
      tempCtx.font = `500 ${displayFontSize}px ${fontFam}`;
      tempCtx.textBaseline = 'top';
      
      const screenX = text.x * zoomScale + panOffset.x;
      const screenY = text.y * zoomScale + panOffset.y;
      
      const lines = text.value.split('\n');
      const lineHeight = displayFontSize * 1.25;
      lines.forEach((line, index) => {
        tempCtx.fillText(line, screenX, screenY + index * lineHeight);
      });
    });

    // Draw Floating Shape Elements
    sketchShapes.forEach(shape => {
      const x = shape.x * zoomScale + panOffset.x;
      const y = shape.y * zoomScale + panOffset.y;
      const w = shape.width * zoomScale;
      const h = shape.height * zoomScale;
      const borderW = (shape.strokeWidth || 2) * zoomScale;

      drawShapeOnCanvas(tempCtx, shape, x, y, w, h, borderW);

      // Draw text inside shape
      if (shape.text) {
        tempCtx.save();
        tempCtx.globalAlpha = shape.opacity;
        tempCtx.fillStyle = shape.color === '#ffffff' ? '#ffffff' : (shape.color === '#18181e' ? (isLightThemeVal ? '#18181e' : '#ffffff') : shape.color);
        const displayFontSize = Math.max(11, 13 * zoomScale);
        
        // Font family for text export
        const fontFam = shape.fontFamily === 'monospace' ? 'monospace' : (shape.fontFamily === 'sans-serif' ? 'sans-serif' : '"Architects Daughter", "Caveat", cursive');
        tempCtx.font = `500 ${displayFontSize}px ${fontFam}`;
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';
        
        const lines = shape.text.split('\n');
        const lineHeight = displayFontSize * 1.25;
        const totalHeight = lines.length * lineHeight;
        const startY = y + h / 2 - totalHeight / 2 + lineHeight / 2;
        
        lines.forEach((line, index) => {
          tempCtx.fillText(line, x + w / 2, startY + index * lineHeight);
        });
        tempCtx.restore();
      }
    });
    
    return tempCanvas;
  }

  function downloadPNG() {
    commitText();
    const compiled = compilePNG();
    if (!compiled) return;
    
    const dataUrl = compiled.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `soryq_sketch_${new Date().toISOString().slice(0,10)}_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    showToast('Sketch exported as PNG!', 'success');
  }

  async function saveToWorkspace() {
    commitText();
    if (!project) {
      showToast('No active project folder open', 'warning');
      return;
    }
    
    const compiled = compilePNG();
    if (!compiled) return;
    
    setIsSaving(true);
    try {
      const dataUrl = compiled.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];
      const binaryString = window.atob(base64Data);
      
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const dateStr = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
      const sketchesDir = `${project.root_path}/.soryq/sketches`;
      const filename = `sketch_${dateStr}.png`;
      const filepath = `${sketchesDir}/${filename}`;
      
      try {
        await invoke('fs_create_dir', { path: sketchesDir });
      } catch {}
      
      await invoke('fs_write_binary', {
        path: filepath,
        data: Array.from(bytes)
      });
      
      showToast(`Saved to: .soryq/sketches/${filename}`, 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Failed to save to workspace', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  // Handle global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isTyping = document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';
      const s = stateRef.current;
      const activeShortcutsList = s.activeShortcuts;
      
      const canvasZoomInShortcut = activeShortcutsList.find((shortcut) => shortcut && shortcut.id === 'canvasZoomIn');
      const canvasZoomOutShortcut = activeShortcutsList.find((shortcut) => shortcut && shortcut.id === 'canvasZoomOut');
      const canvasResetZoomShortcut = activeShortcutsList.find((shortcut) => shortcut && shortcut.id === 'canvasResetZoom');
      
      if (e.key === 'Escape') {
        if (activeTextInput) {
          e.stopPropagation();
          setActiveTextInput(null); // Cancel typing session
        } else if (activeShapeTextInput) {
          e.stopPropagation();
          setActiveShapeTextInput(null); // Cancel shape text typing
        } else {
          commitText();
          closeSketchCanvas();
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping) {
        if (selectedShapeId || selectedTextId || selectedArrowId) {
          deleteSelected();
        }
      } else if (e.code === 'Space' && !isTyping) {
        setSpacePressed(true);
        if (currentTool !== 'pan') {
          e.preventDefault();
        }
      } else if (!isTyping) {
        if (e.key.toLowerCase() === 'v' || e.key === '1') { commitText(); setCurrentTool('select'); }
        else if (e.key.toLowerCase() === 'h' || e.key === '2') { commitText(); setCurrentTool('pan'); }
        else if (e.key.toLowerCase() === 'r' || e.key === '3') { commitText(); setCurrentTool('rectangle'); }
        else if (e.key.toLowerCase() === 'd' || e.key === '4') { commitText(); setCurrentTool('diamond'); }
        else if (e.key.toLowerCase() === 'o' || e.key === '5') { commitText(); setCurrentTool('circle'); }
        else if (e.key.toLowerCase() === 'l' || e.key === '6') { commitText(); setCurrentTool('line'); }
        else if (e.key.toLowerCase() === 'a' || e.key === '7') { commitText(); setCurrentTool('connector'); }
        else if (e.key.toLowerCase() === 'p' || e.key === '8') { commitText(); setCurrentTool('pen'); }
        else if (e.key.toLowerCase() === 't' || e.key === '9') { commitText(); setCurrentTool('text'); }
        else if (e.key.toLowerCase() === 'e' || e.key === '0') { commitText(); setCurrentTool('eraser'); }
        else if (canvasZoomInShortcut && matchShortcut(e, canvasZoomInShortcut.keys)) {
          e.preventDefault();
          zoomCentered(1.15);
        } else if (canvasZoomOutShortcut && matchShortcut(e, canvasZoomOutShortcut.keys)) {
          e.preventDefault();
          zoomCentered(0.85);
        } else if (canvasResetZoomShortcut && matchShortcut(e, canvasResetZoomShortcut.keys)) {
          e.preventDefault();
          resetZoom();
        }
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeTextInput, activeShapeTextInput, selectedShapeId, selectedTextId, selectedArrowId, currentTool, zoomScale, panOffset]);

  // Handle custom text box ESC / Ctrl+Enter key down
  function handleTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setActiveTextInput(null);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitText();
    }
  }

  // Handle Resize of canvas viewport
  function handleResize() {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const gridCanvas = gridCanvasRef.current;
    if (!viewport || !canvas || !gridCanvas) return;

    const newWidth = viewport.clientWidth;
    const newHeight = viewport.clientHeight;
    if (newWidth === 0 || newHeight === 0) return;
    
    setViewportWidth(newWidth);
    setViewportHeight(newHeight);
    
    const dpr = window.devicePixelRatio || 1;
    
    // Scale backing store by device pixel ratio to keep lines super crisp
    canvas.width = newWidth * dpr;
    canvas.height = newHeight * dpr;
    gridCanvas.width = newWidth * dpr;
    gridCanvas.height = newHeight * dpr;
  }

  // Trigger grid redraw & graphics repaint whenever parameters change
  useEffect(() => {
    drawGrid();
    redraw();
  }, [
    backgroundStyle,
    gridSpacing,
    zoomScale,
    panOffset,
    strokes,
    sketchTexts,
    arrows,
    sketchShapes,
    currentColor,
    currentTool,
    connecting,
    connectingCurrentPoint,
    drawingShape,
    shapeStartPoint,
    shapeCurrentPoint,
    isLightTheme
  ]);

  // Handle canvas sizing and viewport observers
  useEffect(() => {
    handleResize();

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (viewportRef.current) {
      resizeObserver.observe(viewportRef.current);
    }

    const viewport = viewportRef.current;
    if (viewport) {
      viewport.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      resizeObserver.disconnect();
      if (viewport) {
        viewport.removeEventListener('wheel', handleWheel);
      }
      if (clearConfirmTimeoutRef.current) clearTimeout(clearConfirmTimeoutRef.current);
    };
  }, []);

  // Handle workspace switches and sketch loads
  useEffect(() => {
    const projectId = project?.id ?? null;
    if (projectId === loadedProjectId) return;

    if (loadedProjectId) {
      commitText(loadedProjectId);
    }

    loadSavedSketch(projectId);
    setLoadedProjectId(projectId);
  }, [project?.id]);

  // Focus textarea dynamically upon activation
  useEffect(() => {
    if (activeTextInput && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [activeTextInput]);

  useEffect(() => {
    if (activeShapeTextInput && shapeTextInputRef.current) {
      shapeTextInputRef.current.focus();
    }
  }, [activeShapeTextInput]);

  // Handle outside click to close dropdown settings
  useEffect(() => {
    if (!showSettingsDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const wrapper = document.querySelector('.custom-settings-dropdown-wrapper');
      if (wrapper && !wrapper.contains(e.target as Node)) {
        setShowSettingsDropdown(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [showSettingsDropdown]);

  function exitCanvas() {
    commitText();
    closeSketchCanvas();
  }

  return (
    <div className="sketch-overlay animate-fade">
      <div 
        ref={viewportRef}
        className="canvas-viewport"
        style={{
          cursor: spacePressed || currentTool === 'pan' 
            ? (panning ? 'grabbing' : 'grab') 
            : (currentTool === 'eraser' ? 'cell' : (currentTool === 'text' ? 'text' : (['rectangle', 'circle'].includes(currentTool) ? 'crosshair' : (currentTool === 'select' ? 'default' : 'crosshair'))))
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* 1. Background Grid Canvas */}
        <canvas
          ref={gridCanvasRef}
          className="grid-canvas"
        />
        
        {/* 2. Drawings Canvas */}
        <canvas
          ref={canvasRef}
          className="draw-canvas"
        />

        {/* Floating text blocks */}
        {sketchTexts.map((text) => (
          <div
            key={text.id}
            className={`floating-text font-${text.fontFamily || 'handwritten'}`}
            data-text-id={text.id}
            style={{
              position: 'absolute',
              left: `${text.x * zoomScale + panOffset.x}px`,
              top: `${text.y * zoomScale + panOffset.y}px`,
              fontSize: `${text.fontSize * zoomScale}px`,
              color: text.color,
              opacity: text.opacity,
              cursor: currentTool === 'eraser' ? 'pointer' : (currentTool === 'select' ? 'move' : 'default')
            }}
            onPointerDown={(e) => startDragText(e, text)}
            onDoubleClick={() => editExistingText(text)}
          >
            {text.value}
          </div>
        ))}

        {/* Floating shapes */}
        {sketchShapes.map((shape) => (
          <div
            key={shape.id}
            className={`floating-shape ${shape.type}${selectedShapeId === shape.id && currentTool === 'select' ? ' active-selected' : ''}`}
            data-shape-id={shape.id}
            style={{
              position: 'absolute',
              left: `${shape.x * zoomScale + panOffset.x}px`,
              top: `${shape.y * zoomScale + panOffset.y}px`,
              width: `${shape.width * zoomScale}px`,
              height: `${shape.height * zoomScale}px`,
              border: shape.borderStyle === 'none' ? 'none' : `${Math.max(1, 2 * zoomScale)}px ${shape.borderStyle} ${shape.color}`,
              borderRadius: shape.type === 'circle' ? '50%' : (shape.type === 'diamond' ? '0' : `${shape.borderRadius * zoomScale}px`),
              backgroundColor: shape.fillColor === 'glass'
                ? (isLightTheme ? 'rgba(255, 255, 255, 0.45)' : 'rgba(24, 24, 30, 0.45)')
                : (shape.fillColor === 'transparent'
                  ? 'transparent'
                  : (shape.fillColor === 'tint' || shape.fillColor.endsWith('22')
                    ? shape.color + '22'
                    : shape.fillColor)
                  ),
              backdropFilter: shape.fillColor === 'glass' ? 'blur(8px)' : 'none',
              WebkitBackdropFilter: shape.fillColor === 'glass' ? 'blur(8px)' : 'none',
              opacity: shape.opacity,
              cursor: currentTool === 'eraser' ? 'pointer' : (currentTool === 'select' ? 'move' : 'default')
            }}
            onPointerDown={(e) => startDragShape(e, shape)}
          >
            {/* Resize handle */}
            {selectedShapeId === shape.id && currentTool === 'select' && (
              <div 
                className="resize-handle"
                style={{
                  position: 'absolute',
                  right: '-4px',
                  bottom: '-4px',
                  width: '10px',
                  height: '10px',
                  cursor: 'se-resize',
                  backgroundColor: 'var(--accent)',
                  borderRadius: '50%',
                  border: '1.5px solid var(--bg-primary)',
                  zIndex: 10
                }}
                onPointerDown={(e) => startResizeShape(e, shape)}
              />
            )}

            {/* Text container / textarea inside shape */}
            {activeShapeTextInput && activeShapeTextInput.id === shape.id ? (
              <textarea
                ref={shapeTextInputRef}
                value={activeShapeTextInput.value}
                onChange={(e) => setActiveShapeTextInput({ id: shape.id, value: e.target.value })}
                onBlur={() => commitShapeText(shape.id)}
                onKeyDown={(e) => handleShapeTextKeyDown(e, shape.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className={`shape-textarea font-${shape.fontFamily || 'handwritten'}`}
                style={{
                  width: '100%',
                  height: '100%',
                  color: shape.color === '#ffffff' ? '#ffffff' : (shape.color === '#18181e' ? 'var(--text-primary)' : shape.color),
                  fontSize: `${Math.max(12, 14 * zoomScale)}px`
                }}
                placeholder="Type..."
              />
            ) : (
              <div 
                className={`shape-text-container font-${shape.fontFamily || 'handwritten'}`}
                style={{
                  color: shape.color === '#ffffff' ? '#ffffff' : (shape.color === '#18181e' ? 'var(--text-primary)' : shape.color),
                  fontSize: `${Math.max(12, 14 * zoomScale)}px`
                }}
                onDoubleClick={() => editShapeText(shape)}
              >
                {shape.text}
              </div>
            )}
          </div>
        ))}

        {/* Floating left style settings panel */}
        {showToolbar && (
          <div className="sketch-style-panel">
            {/* Stroke Color Section */}
            <div className="style-panel-section">
              <span className="style-panel-title">Stroke Color</span>
              <div className="style-color-grid">
                {presetColors.map((col) => {
                  const activeColor = getSelectedProperty('color', currentColor);
                  return (
                    <button
                      key={col.value}
                      className={`style-color-dot${activeColor === col.value ? ' active' : ''}`}
                      style={{
                        backgroundColor: col.value,
                        border: `1.5px solid ${col.value === '#ffffff' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)'}`
                      }}
                      onClick={() => updateSelectedColor(col.value)}
                      title={col.name}
                    />
                  );
                })}
                <button
                  className="custom-color-picker-btn"
                  onClick={() => colorPickerRef.current?.click()}
                  title="Custom Stroke Color"
                >
                  <div className="custom-color-preview" style={{ backgroundColor: getSelectedProperty('color', currentColor) }} />
                  Custom
                </button>
              </div>
            </div>

            {/* Background/Fill Section (only for shapes) */}
            {(selectedShapeId || ['rectangle', 'circle', 'diamond'].includes(currentTool)) && (
              <div className="style-panel-section">
                <span className="style-panel-title">Background Color</span>
                <div className="style-color-grid">
                  {/* None/Transparent option */}
                  <button
                    className={`style-color-dot${getSelectedProperty('fillColor', defaultFillColor) === 'transparent' ? ' active' : ''}`}
                    style={{
                      backgroundColor: 'transparent',
                      border: '1.5px dashed var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onClick={() => updateSelectedProperty('fillColor', 'transparent')}
                    title="Transparent"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  </button>
                  {presetColors.map((col) => {
                    const activeFill = getSelectedProperty('fillColor', defaultFillColor);
                    return (
                      <button
                        key={col.value}
                        className={`style-color-dot${activeFill === col.value ? ' active' : ''}`}
                        style={{
                          backgroundColor: col.value,
                          border: `1.5px solid ${col.value === '#ffffff' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)'}`
                        }}
                        onClick={() => updateSelectedProperty('fillColor', col.value)}
                        title={col.name}
                      />
                    );
                  })}
                  <button
                    className="custom-color-picker-btn"
                    onClick={() => {
                      const picker = document.getElementById('bg-color-picker');
                      picker?.click();
                    }}
                    title="Custom Fill Color"
                  >
                    <div className="custom-color-preview" style={{ backgroundColor: getSelectedProperty('fillColor', defaultFillColor) === 'transparent' ? '#ffffff' : getSelectedProperty('fillColor', defaultFillColor) }} />
                    Custom
                    <input
                      id="bg-color-picker"
                      type="color"
                      value={customFillColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomFillColor(val);
                        updateSelectedProperty('fillColor', val);
                      }}
                      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* Fill Style Section (only for shapes) */}
            {(selectedShapeId || ['rectangle', 'circle', 'diamond'].includes(currentTool)) && (
              <div className="style-panel-section">
                <span className="style-panel-title">Fill Style</span>
                <div className="style-panel-grid">
                  {[
                    { value: 'transparent', label: 'Transparent' },
                    { value: 'hachure', label: 'Hachure' },
                    { value: 'cross-hatch', label: 'Cross-Hatch' },
                    { value: 'solid', label: 'Solid' }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`style-panel-btn${getSelectedProperty('fillStyle', defaultFillStyle) === opt.value ? ' active' : ''}`}
                      onClick={() => {
                        updateSelectedProperty('fillStyle', opt.value);
                        if (opt.value === 'transparent') {
                          updateSelectedProperty('fillColor', 'transparent');
                        } else if (getSelectedProperty('fillColor', defaultFillColor) === 'transparent') {
                          updateSelectedProperty('fillColor', opt.value === 'solid' ? '#06b6d4' : 'tint');
                        }
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Stroke Width Section */}
            {(!selectedTextId && currentTool !== 'text') && (
              <div className="style-panel-section">
                <span className="style-panel-title">Stroke Width</span>
                <div className="style-panel-grid">
                  {[
                    { value: 1.5, label: 'Thin' },
                    { value: 3.5, label: 'Medium' },
                    { value: 6, label: 'Thick' }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`style-panel-btn${getSelectedProperty('strokeWidth', defaultStrokeWidth) === opt.value ? ' active' : ''}`}
                      onClick={() => updateSelectedProperty('strokeWidth', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Stroke Style Section */}
            {(!selectedTextId && currentTool !== 'text') && (
              <div className="style-panel-section">
                <span className="style-panel-title">Stroke Style</span>
                <div className="style-panel-grid">
                  {[
                    { value: 'solid', label: 'Solid' },
                    { value: 'dashed', label: 'Dashed' },
                    { value: 'dotted', label: 'Dotted' }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`style-panel-btn${getSelectedProperty('borderStyle', defaultStrokeStyle) === opt.value ? ' active' : ''}`}
                      onClick={() => updateSelectedProperty('borderStyle', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sloppiness / Roughness Section */}
            {(!selectedTextId && currentTool !== 'text') && (
              <div className="style-panel-section">
                <span className="style-panel-title">Sloppiness</span>
                <div className="style-panel-grid">
                  {[
                    { value: 0, label: 'Architect' },
                    { value: 1.5, label: 'Artist' },
                    { value: 3, label: 'Cartoonist' }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`style-panel-btn${getSelectedProperty('roughness', defaultRoughness) === opt.value ? ' active' : ''}`}
                      onClick={() => updateSelectedProperty('roughness', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Font Family Section (only for text and text-enabled shapes) */}
            {(selectedTextId || selectedShapeId || ['text', 'rectangle', 'circle', 'diamond'].includes(currentTool)) && (
              <div className="style-panel-section">
                <span className="style-panel-title">Font Family</span>
                <div className="style-panel-grid">
                  {[
                    { value: 'handwritten', label: 'Handwritten' },
                    { value: 'sans-serif', label: 'Sans-Serif' },
                    { value: 'monospace', label: 'Monospace' }
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`style-panel-btn${getSelectedProperty('fontFamily', defaultFontFamily) === opt.value ? ' active' : ''}`}
                      onClick={() => updateSelectedProperty('fontFamily', opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Opacity Section */}
            <div className="style-panel-section">
              <span className="style-panel-title">Opacity ({Math.round(getSelectedProperty('opacity', brushOpacity) * 100)}%)</span>
              <div className="opacity-slider" style={{ padding: '4px 0' }}>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={getSelectedProperty('opacity', brushOpacity)}
                  onChange={(e) => updateSelectedProperty('opacity', Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Layering & Delete Actions (only when element is selected) */}
            {(selectedShapeId || selectedTextId || selectedArrowId) && (
              <>
                <div className="menu-divider" style={{ margin: '4px 0', borderBottom: '1.5px solid var(--border)' }} />
                <div className="style-panel-section">
                  <span className="style-panel-title">Actions</span>
                  <div className="style-panel-grid">
                    {selectedShapeId && (
                      <>
                        <button
                          className="style-panel-btn"
                          onClick={() => moveShapeLayer(selectedShapeId, 'front')}
                          title="Bring to Front"
                          style={{ flex: 1 }}
                        >
                          Bring Front
                        </button>
                        <button
                          className="style-panel-btn"
                          onClick={() => moveShapeLayer(selectedShapeId, 'back')}
                          title="Send to Back"
                          style={{ flex: 1 }}
                        >
                          Send Back
                        </button>
                      </>
                    )}
                    <button
                      className="style-panel-btn delete-btn"
                      onClick={deleteSelected}
                      title="Delete Element"
                      style={{
                        flex: '1 1 100%',
                        background: 'rgba(248, 113, 113, 0.1)',
                        color: 'var(--error)',
                        borderColor: 'rgba(248, 113, 113, 0.2)'
                      }}
                    >
                      Delete Selected
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Interactive typing input overlay */}
        {activeTextInput && (
          <textarea
            ref={textInputRef}
            value={activeTextInput.value}
            onChange={(e) => setActiveTextInput({ ...activeTextInput, value: e.target.value })}
            onKeyDown={handleTextKeyDown}
            onBlur={() => commitText()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: `${activeTextInput.x * zoomScale + panOffset.x}px`,
              top: `${activeTextInput.y * zoomScale + panOffset.y}px`,
              fontSize: `${Math.max(13, brushSize * 2.5) * zoomScale}px`,
              color: currentColor,
              background: 'rgba(var(--bg-primary-rgb, 24, 24, 30), 0.85)',
              border: '1px solid var(--accent)',
              outline: 'none',
              padding: '4px 8px',
              borderRadius: '6px',
              fontFamily: "'Architects Daughter', 'Caveat', cursive",
              minWidth: `${150 * zoomScale}px`,
              minHeight: `${40 * zoomScale}px`,
              maxWidth: `${400 * zoomScale}px`,
              zIndex: 9020,
              resize: 'both',
              overflow: 'hidden',
              caretColor: 'var(--accent)',
              boxShadow: 'var(--shadow-sm)'
            }}
            placeholder="Type notes... (Ctrl+Enter to commit)"
          />
        )}
      </div>

      {/* Sleek horizontal centered top toolbar (Excalidraw-like) */}
      {showToolbar ? (
        <div className="sketch-toolbar bento-card animate-scale">
          {/* Collapse Button */}
          <button
            className="tool-btn collapse-btn"
            onClick={() => setShowToolbar(false)}
            title="Hide Toolbar"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>

          <div className="divider hide-on-stack" />

          {/* Group 1: Canvas Drawing Tools */}
          <div className="toolbar-group draw-group">
            <div className="toolbar-section main-tools">
              <button
                className={`tool-btn${currentTool === 'select' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('select'); }}
                title="Select & Move (V / 1)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                  <path d="m13 13 6 6"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'pan' || spacePressed ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('pan'); }}
                title="Pan Canvas (Hold Space / H / 2)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                  <path d="M14 10V4a2 2 0 0 0-2 2v0a2 2 0 0 0-2 2v0"/>
                  <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                  <path d="M6 14a4 4 0 0 0-4-4v0a4 4 0 0 0-4 4v7a4 4 0 0 0 4 4h8a7 7 0 0 0 7-7v-3a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'rectangle' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('rectangle'); }}
                title="Rectangle Shape (R / 3)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'diamond' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('diamond'); }}
                title="Diamond Shape (D / 4)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 12l10 10 10-10L12 2z"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'circle' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('circle'); }}
                title="Circle Shape (O / 5)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'line' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('line'); }}
                title="Straight Line (L / 6)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="19" x2="19" y2="5"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'connector' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('connector'); }}
                title="Arrow Connector (A / 7)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="19" x2="19" y2="5"/>
                  <polyline points="12 5 19 5 19 12"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'pen' && !spacePressed ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('pen'); }}
                title="Draw Freehand (P / 8)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'text' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('text'); }}
                title="Type text (T / 9)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 7 4 4 20 4 20 7"/>
                  <line x1="9" y1="20" x2="15" y2="20"/>
                  <line x1="12" y1="4" x2="12" y2="20"/>
                </svg>
              </button>
              <button
                className={`tool-btn${currentTool === 'eraser' ? ' active' : ''}`}
                onClick={() => { commitText(); setCurrentTool('eraser'); }}
                title="Erase lines, text, or shapes (E / 0)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 13"/>
                  <path d="M17 17l-4-4"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button 
          className="toolbar-toggle bento-card animate-scale"
          onClick={() => setShowToolbar(true)}
          title="Show controls"
          style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 9010 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
      )}

      {/* Floating bottom-left panel (zoom + history controls) */}
      {showToolbar && (
        <div className="sketch-bottom-left-panel">
          {/* Zoom controls */}
          <button className="tool-btn zoom-btn" style={{ width: '24px', height: '24px' }} onClick={() => zoomCentered(0.85)} title="Zoom Out">-</button>
          <button className="zoom-display-btn" style={{ padding: '2px 6px', fontSize: '11px', fontWeight: 600, minWidth: '44px' }} onClick={resetZoom} title="Reset Zoom">{Math.round(zoomScale * 100)}%</button>
          <button className="tool-btn zoom-btn" style={{ width: '24px', height: '24px' }} onClick={() => zoomCentered(1.15)} title="Zoom In">+</button>

          <div className="divider" style={{ height: '16px', margin: '0 2px' }} />

          {/* Undo/Redo */}
          <button
            className="tool-btn"
            style={{ width: '24px', height: '24px' }}
            disabled={!canUndo}
            onClick={undo}
            title="Undo (Ctrl+Z)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6"/>
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>
          </button>
          <button
            className="tool-btn"
            style={{ width: '24px', height: '24px' }}
            disabled={!canRedo}
            onClick={redo}
            title="Redo (Ctrl+Y)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6"/>
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
            </svg>
          </button>
        </div>
      )}

      {/* Floating top-right actions panel */}
      {showToolbar && (
        <div className="sketch-top-right-panel">
          {/* Grid settings trigger */}
          <div className="custom-settings-dropdown-wrapper">
            <button
              type="button"
              className={`settings-trigger-btn${showSettingsDropdown ? ' open' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowSettingsDropdown(!showSettingsDropdown);
              }}
              title="Canvas Grid Settings"
              style={{ padding: '0 8px', border: 'none', background: 'transparent' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="15" y1="3" x2="15" y2="21" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
              </svg>
            </button>

            {showSettingsDropdown && (
              <div 
                className="settings-dropdown-panel" 
                onClick={(e) => e.stopPropagation()}
                style={{ top: 'calc(100% + 10px)', right: 0 }}
              >
                {/* Background Section */}
                <div className="panel-section">
                  <div className="section-title">Background Style</div>
                  <div className="grid-style-options">
                    {[
                      { value: 'transparent', label: 'Transparent' },
                      { value: 'dot-grid', label: 'Dot Grid' },
                      { value: 'line-grid', label: 'Graph Grid' },
                      { value: 'isometric-grid', label: 'Isometric' },
                      { value: 'blackboard', label: 'Blackboard' },
                      { value: 'blueprint', label: 'Blueprint' },
                      { value: 'solid-dark', label: 'Solid Dark' },
                      { value: 'solid-light', label: 'Solid Light' }
                    ].map((style) => (
                      <button 
                        key={style.value}
                        type="button" 
                        className={`style-opt-btn${backgroundStyle === style.value ? ' active' : ''}`}
                        onClick={() => {
                          setBackgroundStyle(style.value as SketchBackgroundStyle);
                          setTimeout(() => persistCanvasSnapshot(), 10);
                        }}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid Settings */}
                {['dot-grid', 'line-grid', 'isometric-grid', 'blackboard', 'blueprint'].includes(backgroundStyle) && (
                  <div className="panel-section">
                    <div className="section-title">Grid Configuration</div>
                    
                    {/* Spacing Buttons */}
                    <div className="setting-row">
                      <span className="setting-label">Grid Spacing</span>
                      <div className="spacing-btn-group">
                        {[12, 24, 48].map((spacing) => (
                          <button
                            key={spacing}
                            type="button"
                            className={`spacing-btn${gridSpacing === spacing ? ' active' : ''}`}
                            onClick={() => {
                              setGridSpacing(spacing);
                              setTimeout(() => persistCanvasSnapshot(), 10);
                            }}
                          >
                            {spacing}px
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Snap Toggle */}
                    <div className="setting-row">
                      <span className="setting-label">Snap to Grid</span>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={snapToGrid}
                          onChange={(e) => {
                            setSnapToGrid(e.target.checked);
                            setTimeout(() => persistCanvasSnapshot(), 10);
                          }}
                        />
                        <span className="switch-slider" />
                      </label>
                    </div>
                  </div>
                )}

                {/* JSON Utilities */}
                <div className="panel-section utilities-section">
                  <div className="section-title">Utilities</div>
                  <div className="utility-buttons">
                    <button type="button" className="util-btn" onClick={exportJSON}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Export JSON
                    </button>
                    <button type="button" className="util-btn" onClick={() => jsonFileInputRef.current?.click()}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Import JSON
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="divider" style={{ height: '16px', margin: '0 2px' }} />

          {/* Action buttons: Clear, Save to Workspace, Export PNG */}
          <button
            className={`tool-btn clear-btn${clearConfirm ? ' confirming' : ''}`}
            style={{ width: '28px', height: '28px' }}
            onClick={handleClear}
            title="Clear all drawings"
          >
            {clearConfirm ? (
              <span className="confirm-text" style={{ fontSize: '9px' }}>Confirm?</span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            )}
          </button>
          
          <button
            className="tool-btn"
            style={{ width: '28px', height: '28px' }}
            onClick={downloadPNG}
            title="Export PNG File"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>

          <button
            className="tool-btn"
            style={{ width: '28px', height: '28px' }}
            disabled={isSaving}
            onClick={saveToWorkspace}
            title="Save sketch to Project folder (.soryq/sketches/)"
          >
            {isSaving ? (
              <span className="saving-spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            )}
          </button>

          <div className="divider" style={{ height: '16px', margin: '0 2px' }} />

          {/* Close button */}
          <button
            className="tool-btn exit-btn"
            style={{ width: '28px', height: '28px' }}
            onClick={exitCanvas}
            title="Close Sketch Canvas (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}
      
      <input
        ref={jsonFileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleJSONImport}
      />
    </div>
  );
}
