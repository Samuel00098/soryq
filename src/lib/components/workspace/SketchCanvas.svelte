<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { sketchCanvasOpen, closeSketchCanvas } from '$lib/stores/sketch';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { fade, scale } from 'svelte/transition';
  import { appearance, matchShortcut, userShortcuts } from '$lib/stores/settings';

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
  }

  interface SketchShape {
    id: string;
    type: 'rectangle' | 'circle';
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
    sketchTexts?: SketchText[];
    arrows?: SketchArrow[];
    shapes?: SketchShape[];
    sketchShapes?: SketchShape[];
  }

  const LEGACY_SKETCH_STATE_V3_KEY = 'soryq_sketch_state_v3';
  const LEGACY_SKETCH_STATE_V2_KEY = 'soryq_sketch_state_v2';
  const LEGACY_SKETCH_OWNER_KEY = 'soryq_sketch_legacy_owner_project';

  // State runes
  let viewportEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let gridCanvasEl = $state<HTMLCanvasElement | null>(null);
  let ctx = $state<CanvasRenderingContext2D | null>(null);
  let gridCtx = $state<CanvasRenderingContext2D | null>(null);
  
  let drawing = $state(false);
  let currentTool = $state<'select' | 'pen' | 'eraser' | 'text' | 'pan' | 'connector' | 'rectangle' | 'circle'>('select');
  let currentColor = $state('#06b6d4'); // Default Soryq Cyan
  let customColor = $state('#e2e2eb');
  let brushSize = $state(6);
  let brushOpacity = $state(1.0);

  // Layout Shapes State
  let sketchShapes = $state<SketchShape[]>([]);
  let drawingShape = $state(false);
  let shapeStartPoint = $state<Point | null>(null);
  let shapeCurrentPoint = $state<Point | null>(null);
  let selectedShapeId = $state<string | null>(null);
  let activeShapeTextInput = $state<{ id: string; value: string } | null>(null);
  let shapeTextInputEl = $state<HTMLTextAreaElement | null>(null);

  // Drag shape state
  let draggingShapeId = $state<string | null>(null);
  let dragShapeStart = { x: 0, y: 0 };
  let shapeStartCoords = { x: 0, y: 0 };

  // Resize shape state
  let resizingShapeId = $state<string | null>(null);
  let resizeShapeStart = { x: 0, y: 0 };
  let shapeStartDims = { width: 0, height: 0 };

  // Theme tracking
  let isLightTheme = $derived($appearance === 'light' || ($appearance === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches));

  // Connector drawing state
  let arrows = $state<SketchArrow[]>([]);
  let connecting = $state(false);
  let connectingFromId = $state<string | null>(null);
  let connectingFromShapeId = $state<string | null>(null);
  let connectingStartPoint = $state<Point | null>(null);
  let connectingCurrentPoint = $state<Point | null>(null);
  
  let backgroundStyle = $state<SketchBackgroundStyle>('transparent');
  let gridSpacing = $state(24);
  let snapToGrid = $state(false);
  let showSettingsDropdown = $state(false);
  let jsonFileInputEl = $state<HTMLInputElement | null>(null);

  let showToolbar = $state(true);
  let isSaving = $state(false);
  let clearConfirm = $state(false);
  let clearConfirmTimeout: any = null;
  let colorPickerEl = $state<HTMLInputElement | null>(null);

  // Zoom & Pan State
  let zoomScale = $state(1.0);
  let panOffset = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let panStart = { x: 0, y: 0 };
  let spacePressed = $state(false);

  // Text Tool State
  let activeTextInput = $state<{ x: number; y: number; value: string } | null>(null);
  let textInputEl = $state<HTMLTextAreaElement | null>(null);
  let sketchTexts = $state<SketchText[]>([]);
  let draggingTextId = $state<string | null>(null);
  let dragStart = { x: 0, y: 0 };
  let textStart = { x: 0, y: 0 };

  // Viewport sizes
  let viewportWidth = $state(800);
  let viewportHeight = $state(600);

  // Vector strokes list
  let strokes = $state<Stroke[]>([]);
  let currentStroke = $state<Stroke | null>(null);

  // History stacks
  let undoStack = $state<string[]>([]);
  let redoStack = $state<string[]>([]);
  let loadedProjectId = $state<string | null>(null);

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

  function getSketchStorageKey(projectId: string) {
    return `soryq_sketch_state_v4_${projectId}`;
  }

  function resolveStorageProjectId(projectId: string | null | undefined = loadedProjectId ?? ($activeProject?.id ?? null)) {
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

  function persistCanvasSnapshot(projectId: string | null | undefined = resolveStorageProjectId()) {
    persistStateString(JSON.stringify(createPersistedState()), projectId);
  }

  function createPersistedState(): PersistedSketchState {
    return {
      version: '4',
      backgroundStyle,
      gridSpacing,
      snapToGrid,
      zoomScale,
      panOffset: { ...panOffset },
      strokes: $state.snapshot(strokes),
      texts: $state.snapshot(sketchTexts),
      arrows: $state.snapshot(arrows),
      shapes: $state.snapshot(sketchShapes)
    };
  }

  function resetCanvasDocument() {
    strokes = [];
    sketchTexts = [];
    arrows = [];
    sketchShapes = [];
    undoStack = [];
    redoStack = [];
    selectedShapeId = null;
    activeTextInput = null;
    activeShapeTextInput = null;
    backgroundStyle = 'transparent';
    gridSpacing = 24;
    snapToGrid = false;
    zoomScale = 1.0;
    panOffset = { x: 0, y: 0 };
  }

  // Map screen coordinates to transformed local canvas world coordinates
  function screenToWorld(clientX: number, clientY: number): Point {
    if (!viewportEl) return { x: 0, y: 0 };
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    const screenX = (clientX - rect.left) / cssZoom;
    const screenY = (clientY - rect.top) / cssZoom;
    return {
      x: (screenX - panOffset.x) / zoomScale,
      y: (screenY - panOffset.y) / zoomScale
    };
  }

  // Draw background grids
  function drawGrid() {
    if (!gridCanvasEl || !gridCtx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = gridCanvasEl.width / dpr;
    const h = gridCanvasEl.height / dpr;
    
    gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridCtx.clearRect(0, 0, w, h);
    
    const isLightTheme = document.documentElement.classList.contains('light-theme');
    
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
      gridCtx.fillStyle = isLightTheme ? 'rgba(255, 255, 255, 0.85)' : 'rgba(24, 24, 30, 0.7)';
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
      gridStyleColor = isLightTheme ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
      gridStyleLineColor = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
    }

    const scaledSpacing = gridSpacing * zoomScale;
    
    if (backgroundStyle === 'dot-grid' || backgroundStyle === 'blackboard' || backgroundStyle === 'blueprint') {
      // For dot-based, if line-grid is not selected
      if (backgroundStyle === 'dot-grid' || backgroundStyle === 'blackboard' || backgroundStyle === 'blueprint') {
        // We'll draw dots if it's dot-grid (or dot settings on blackboard/blueprint)
        // Wait, for blackboard/blueprint, let's draw graph lines instead, as standard blackboard/blueprints usually have grids of lines!
        // So blackboard and blueprint will draw line-grid below.
      }
    }

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

  function drawArrow(targetCtx: CanvasRenderingContext2D, arrow: SketchArrow) {
    const start = getArrowStart(arrow);
    const end = getArrowEnd(arrow);
    if (!start || !end) return;

    targetCtx.save();
    targetCtx.strokeStyle = arrow.color;
    targetCtx.fillStyle = arrow.color;
    targetCtx.lineWidth = 2.5;
    targetCtx.globalAlpha = arrow.opacity;
    targetCtx.lineCap = 'round';

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 30) {
      const shorten = (arrow.toTextId || arrow.toShapeId) ? 32 : 6;
      const newEndX = end.x - (dx / dist) * shorten;
      const newEndY = end.y - (dy / dist) * shorten;

      targetCtx.beginPath();
      targetCtx.moveTo(start.x, start.y);
      targetCtx.lineTo(newEndX, newEndY);
      targetCtx.stroke();

      const angle = Math.atan2(newEndY - start.y, newEndX - start.x);
      targetCtx.beginPath();
      targetCtx.moveTo(newEndX, newEndY);
      targetCtx.lineTo(newEndX - 8 * Math.cos(angle - Math.PI / 6), newEndY - 8 * Math.sin(angle - Math.PI / 6));
      targetCtx.lineTo(newEndX - 8 * Math.cos(angle + Math.PI / 6), newEndY - 8 * Math.sin(angle + Math.PI / 6));
      targetCtx.closePath();
      targetCtx.fill();
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
      yy = b.y + param * D;
    }
    
    const dx = p.x - xx;
    const dy = p.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Redraw all strokes on the transparent drawing canvas
  function redraw() {
    const activeCtx = ctx;
    if (!canvasEl || !activeCtx) return;
    
    const dpr = window.devicePixelRatio || 1;
    
    // Clear canvas
    activeCtx.setTransform(1, 0, 0, 1, 0, 0);
    activeCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    
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
        const angle = Math.atan2(dy, dx);
        activeCtx.beginPath();
        activeCtx.moveTo(connectingCurrentPoint.x, connectingCurrentPoint.y);
        activeCtx.lineTo(connectingCurrentPoint.x - 6 * Math.cos(angle - Math.PI / 6), connectingCurrentPoint.y - 6 * Math.sin(angle - Math.PI / 6));
        activeCtx.lineTo(connectingCurrentPoint.x - 6 * Math.cos(angle + Math.PI / 6), connectingCurrentPoint.y - 6 * Math.sin(angle + Math.PI / 6));
        activeCtx.closePath();
        activeCtx.fill();
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
      }
      activeCtx.stroke();
      activeCtx.restore();
    }
  }

  // Save state to undo history
  function saveState(projectId: string | null | undefined = resolveStorageProjectId()) {
    const stateObj = createPersistedState();
    const stateStr = JSON.stringify(stateObj);
    
    undoStack = [...undoStack, stateStr];
    if (undoStack.length > 50) {
      undoStack.shift();
    }
    
    redoStack = [];
    persistStateString(stateStr, projectId);
  }

  // Restore drawing state
  function restoreState(
    stateStr: string,
    options: { persist?: boolean; projectId?: string | null } = {}
  ) {
    try {
      const stateObj = JSON.parse(stateStr) as PersistedSketchState;
      backgroundStyle = stateObj.backgroundStyle ?? 'transparent';
      gridSpacing = stateObj.gridSpacing ?? 24;
      snapToGrid = stateObj.snapToGrid ?? false;
      zoomScale = stateObj.zoomScale ?? 1.0;
      panOffset = stateObj.panOffset ?? { x: 0, y: 0 };
      strokes = stateObj.strokes ?? [];
      sketchTexts = stateObj.texts ?? stateObj.sketchTexts ?? [];
      arrows = stateObj.arrows ?? [];
      sketchShapes = stateObj.shapes ?? stateObj.sketchShapes ?? [];
      if (options.persist !== false) {
        persistStateString(stateStr, options.projectId);
      }
      drawGrid();
      redraw();
    } catch (e) {
      console.error('Failed to restore state:', e);
    }
  }

  // Load sketch from local storage
  function loadSavedSketch(projectId: string | null | undefined = resolveStorageProjectId()) {
    resetCanvasDocument();
    if (typeof localStorage === 'undefined') {
      drawGrid();
      redraw();
      return;
    }

    const resolvedProjectId = resolveStorageProjectId(projectId);
    if (!resolvedProjectId) {
      drawGrid();
      redraw();
      return;
    }

    const projectKey = getSketchStorageKey(resolvedProjectId);
    const savedProjectState = localStorage.getItem(projectKey);
    if (savedProjectState) {
      restoreState(savedProjectState, { persist: false, projectId: resolvedProjectId });
      undoStack = [savedProjectState];
      return;
    }

    const legacyOwner = localStorage.getItem(LEGACY_SKETCH_OWNER_KEY);
    if (!legacyOwner || legacyOwner === resolvedProjectId) {
      const legacyState = localStorage.getItem(LEGACY_SKETCH_STATE_V3_KEY) ?? localStorage.getItem(LEGACY_SKETCH_STATE_V2_KEY);
      if (legacyState) {
        restoreState(legacyState, { persist: false, projectId: resolvedProjectId });
        undoStack = [legacyState];
        persistStateString(legacyState, resolvedProjectId);
        localStorage.setItem(LEGACY_SKETCH_OWNER_KEY, resolvedProjectId);
        return;
      }
    }

    drawGrid();
    redraw();
  }

  // Export drawing data to JSON file
  function exportJSON() {
    try {
      const data = {
        ...createPersistedState(),
        version: '1.1.0',
        sketchTexts: $state.snapshot(sketchTexts),
        sketchShapes: $state.snapshot(sketchShapes)
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
      
      showSettingsDropdown = false;
      showToast('Canvas exported successfully', 'success');
    } catch (err) {
      console.error('Failed to export canvas:', err);
      showToast('Failed to export canvas', 'error');
    }
  }

  // Import drawing data from JSON file
  function handleJSONImport(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);
        
        if (data.backgroundStyle !== undefined) backgroundStyle = data.backgroundStyle;
        if (data.gridSpacing !== undefined) gridSpacing = data.gridSpacing;
        if (data.snapToGrid !== undefined) snapToGrid = data.snapToGrid;
        if (data.zoomScale !== undefined) zoomScale = data.zoomScale;
        if (data.panOffset !== undefined) panOffset = data.panOffset;
        if (Array.isArray(data.strokes)) strokes = data.strokes;
        if (Array.isArray(data.sketchTexts)) sketchTexts = data.sketchTexts;
        if (Array.isArray(data.arrows)) arrows = data.arrows;
        if (Array.isArray(data.sketchShapes)) {
          sketchShapes = data.sketchShapes;
        } else {
          sketchShapes = [];
        }
        
        saveState();
        drawGrid();
        redraw();
        
        showSettingsDropdown = false;
        showToast('Canvas imported successfully', 'success');
      } catch (err) {
        console.error('Failed to import canvas:', err);
        showToast('Invalid file format or corrupted canvas data', 'error');
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  // Handle outside click to close custom settings dropdown
  $effect(() => {
    if (!showSettingsDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const wrapper = document.querySelector('.custom-settings-dropdown-wrapper');
      if (wrapper && !wrapper.contains(e.target as Node)) {
        showSettingsDropdown = false;
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  });

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
        opacity: brushOpacity
      };
      sketchTexts = [...sketchTexts, newText];
      saveState(projectId);
    }
    activeTextInput = null;
  }

  // Pointer down (start drawing, typing, or panning)
  function handlePointerDown(e: PointerEvent) {
    // Deselect shape if clicking background
    const target = e.target as HTMLElement;
    if (!target.closest('.floating-shape') && !target.closest('.shape-context-menu')) {
      selectedShapeId = null;
    }

    if (e.button === 1 || e.button === 2 || currentTool === 'pan' || spacePressed) {
      // Pan mode
      panning = true;
      panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      try {
        viewportEl?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (e.button !== 0) return; // Only draw/type with left click
    if (!canvasEl || !ctx || !viewportEl) return;

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
        arrows = arrows.filter((_, idx) => idx !== clickedArrowIndex);
        saveState();
        redraw();
        return;
      }
    }

    if (currentTool === 'rectangle' || currentTool === 'circle') {
      e.preventDefault();
      if (activeTextInput) {
        commitText();
      }
      drawingShape = true;
      shapeStartPoint = worldCoords;
      shapeCurrentPoint = worldCoords;
      try {
        viewportEl.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (currentTool === 'connector') {
      e.preventDefault();
      if (activeTextInput) {
        commitText();
      }
      connectingStartPoint = worldCoords;
      connectingCurrentPoint = worldCoords;
      connecting = true;
      connectingFromId = null;
      connectingFromShapeId = null;
      try {
        viewportEl.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (currentTool === 'text') {
      e.preventDefault();
      if (activeTextInput) {
        commitText();
      }
      activeTextInput = { x: worldCoords.x, y: worldCoords.y, value: '' };
      return;
    }

    if (activeTextInput) {
      commitText();
    }

    // Don't start freeform drawing if in select tool
    if (currentTool === 'select') return;

    try {
      viewportEl.setPointerCapture(e.pointerId);
    } catch {}

    drawing = true;
    currentStroke = {
      points: [worldCoords],
      color: currentColor,
      width: brushSize,
      opacity: brushOpacity,
      isEraser: currentTool === 'eraser'
    };

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

  function handlePointerMove(e: PointerEvent) {
    if (panning) {
      panOffset = {
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      };
      drawGrid();
      redraw();
      return;
    }

    if (drawingShape) {
      shapeCurrentPoint = screenToWorld(e.clientX, e.clientY);
      redraw();
      return;
    }

    if (connecting) {
      connectingCurrentPoint = screenToWorld(e.clientX, e.clientY);
      redraw();
      return;
    }

    if (currentTool === 'text' || currentTool === 'pan' || currentTool === 'select') return;
    if (!drawing || !ctx || !canvasEl || !currentStroke) return;
    
    const worldCoords = screenToWorld(e.clientX, e.clientY);
    const lastPoint = currentStroke.points[currentStroke.points.length - 1];
    if (lastPoint && lastPoint.x === worldCoords.x && lastPoint.y === worldCoords.y) return;
    
    currentStroke.points.push(worldCoords);

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

    const len = currentStroke.points.length;
    if (len === 2) {
      ctx.beginPath();
      ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
      ctx.lineTo(currentStroke.points[1].x, currentStroke.points[1].y);
      ctx.stroke();
    } else if (len > 2) {
      const i = len - 2;
      const xc = (currentStroke.points[i].x + currentStroke.points[i + 1].x) / 2;
      const yc = (currentStroke.points[i].y + currentStroke.points[i + 1].y) / 2;
      const prev_xc = (currentStroke.points[i - 1].x + currentStroke.points[i].x) / 2;
      const prev_yc = (currentStroke.points[i - 1].y + currentStroke.points[i].y) / 2;
      
      ctx.beginPath();
      ctx.moveTo(prev_xc, prev_yc);
      ctx.quadraticCurveTo(currentStroke.points[i].x, currentStroke.points[i].y, xc, yc);
      ctx.stroke();
    }
  }

  // Pointer up (drawing or panning finished)
  function handlePointerUp(e: PointerEvent) {
    if (panning) {
      panning = false;
      try {
        viewportEl?.releasePointerCapture(e.pointerId);
      } catch {}
      return;
    }

    if (drawingShape) {
      try {
        viewportEl?.releasePointerCapture(e.pointerId);
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
            type: currentTool as 'rectangle' | 'circle',
            x,
            y,
            width,
            height,
            color: currentColor,
            fillColor: 'transparent',
            borderStyle: 'solid',
            borderRadius: currentTool === 'circle' ? 9999 : 8,
            opacity: brushOpacity,
            text: ''
          };
          
          sketchShapes = [...sketchShapes, newShape];
          saveState();
          
          // Switch to select tool so the shape can be modified/positioned
          currentTool = 'select';
          selectedShapeId = newShape.id;
        }
      }
      drawingShape = false;
      shapeStartPoint = null;
      shapeCurrentPoint = null;
      redraw();
      return;
    }

    if (connecting) {
      try {
        viewportEl?.releasePointerCapture(e.pointerId);
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
      const newArrow: SketchArrow = {
        id: Math.random().toString(36).substring(2, 9),
        fromTextId: connectingFromId || undefined,
        fromShapeId: connectingFromShapeId || undefined,
        toTextId: targetTextId,
        toShapeId: targetShapeId,
        fromPoint: (connectingFromId || connectingFromShapeId) ? undefined : (connectingStartPoint || undefined),
        toPoint: (targetTextId || targetShapeId) ? undefined : worldCoords,
        color: currentColor,
        opacity: brushOpacity
      };

      arrows = [...arrows, newArrow];
      saveState();

      connecting = false;
      connectingFromId = null;
      connectingFromShapeId = null;
      connectingStartPoint = null;
      connectingCurrentPoint = null;
      
      redraw();
      return;
    }

    if (currentTool === 'text' || currentTool === 'pan' || currentTool === 'select') return;
    if (!drawing || !currentStroke) return;
    try {
      viewportEl?.releasePointerCapture(e.pointerId);
    } catch {}
    
    drawing = false;
    strokes = [...strokes, currentStroke];
    currentStroke = null;
    
    saveState();
    redraw();
  }
  // Drag text elements
  function startDragText(e: PointerEvent, text: SketchText) {
    if (currentTool === 'pen') return; // Bubble up to canvas to draw strokes

    if (currentTool === 'eraser') {
      sketchTexts = sketchTexts.filter(t => t.id !== text.id);
      arrows = arrows.filter(a => a.fromTextId !== text.id && a.toTextId !== text.id);
      saveState();
      redraw();
      return;
    }

    if (currentTool === 'connector') {
      e.stopPropagation();
      e.preventDefault();
      connectingFromId = text.id;
      connectingFromShapeId = null;
      const worldCoords = screenToWorld(e.clientX, e.clientY);
      connectingStartPoint = worldCoords;
      connectingCurrentPoint = worldCoords;
      connecting = true;
      try {
        viewportEl?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    
    e.stopPropagation();
    commitText();

    draggingTextId = text.id;
    dragStart = { x: e.clientX, y: e.clientY };
    textStart = { x: text.x, y: text.y };

    window.addEventListener('pointermove', handleTextDragMove);
    window.addEventListener('pointerup', handleTextDragUp);
  }

  function handleTextDragMove(e: PointerEvent) {
    if (!draggingTextId || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    
    const deltaX = ((e.clientX - dragStart.x) / cssZoom) / zoomScale;
    const deltaY = ((e.clientY - dragStart.y) / cssZoom) / zoomScale;
    
    sketchTexts = sketchTexts.map(t => {
      if (t.id === draggingTextId) {
        let targetX = textStart.x + deltaX;
        let targetY = textStart.y + deltaY;
        
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
    });
    redraw();
  }

  function handleTextDragUp() {
    if (draggingTextId) {
      draggingTextId = null;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleTextDragMove);
    window.removeEventListener('pointerup', handleTextDragUp);
  }

  // Drag shape elements
  function startDragShape(e: PointerEvent, shape: SketchShape) {
    if (currentTool === 'pen') return; // Bubble up to canvas to draw strokes

    if (currentTool === 'eraser') {
      sketchShapes = sketchShapes.filter(s => s.id !== shape.id);
      arrows = arrows.filter(a => a.fromShapeId !== shape.id && a.toShapeId !== shape.id);
      saveState();
      redraw();
      return;
    }

    if (currentTool === 'connector') {
      e.stopPropagation();
      e.preventDefault();
      connectingFromShapeId = shape.id;
      connectingFromId = null;
      const worldCoords = screenToWorld(e.clientX, e.clientY);
      connectingStartPoint = worldCoords;
      connectingCurrentPoint = worldCoords;
      connecting = true;
      try {
        viewportEl?.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }

    // Set selected shape
    selectedShapeId = shape.id;

    if (e.target && (e.target as HTMLElement).classList.contains('resize-handle')) {
      return; // Handled by resize handler
    }

    e.stopPropagation();
    commitText();

    draggingShapeId = shape.id;
    dragShapeStart = { x: e.clientX, y: e.clientY };
    shapeStartCoords = { x: shape.x, y: shape.y };

    window.addEventListener('pointermove', handleShapeDragMove);
    window.addEventListener('pointerup', handleShapeDragUp);
  }

  function handleShapeDragMove(e: PointerEvent) {
    if (!draggingShapeId || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    
    const deltaX = ((e.clientX - dragShapeStart.x) / cssZoom) / zoomScale;
    const deltaY = ((e.clientY - dragShapeStart.y) / cssZoom) / zoomScale;
    
    sketchShapes = sketchShapes.map(s => {
      if (s.id === draggingShapeId) {
        let targetX = shapeStartCoords.x + deltaX;
        let targetY = shapeStartCoords.y + deltaY;
        
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
    });
    redraw();
  }

  function handleShapeDragUp() {
    if (draggingShapeId) {
      draggingShapeId = null;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleShapeDragMove);
    window.removeEventListener('pointerup', handleShapeDragUp);
  }

  // Resize shape elements
  function startResizeShape(e: PointerEvent, shape: SketchShape) {
    e.stopPropagation();
    e.preventDefault();
    resizingShapeId = shape.id;
    resizeShapeStart = { x: e.clientX, y: e.clientY };
    shapeStartDims = { width: shape.width, height: shape.height };

    window.addEventListener('pointermove', handleShapeResizeMove);
    window.addEventListener('pointerup', handleShapeResizeUp);
  }

  function handleShapeResizeMove(e: PointerEvent) {
    if (!resizingShapeId || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    
    const deltaX = ((e.clientX - resizeShapeStart.x) / cssZoom) / zoomScale;
    const deltaY = ((e.clientY - resizeShapeStart.y) / cssZoom) / zoomScale;
    
    sketchShapes = sketchShapes.map(s => {
      if (s.id === resizingShapeId) {
        let targetWidth = shapeStartDims.width + deltaX;
        let targetHeight = shapeStartDims.height + deltaY;
        
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
    });
    redraw();
  }

  function handleShapeResizeUp() {
    if (resizingShapeId) {
      resizingShapeId = null;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleShapeResizeMove);
    window.removeEventListener('pointerup', handleShapeResizeUp);
  }

  // Edit text inside shape
  function editShapeText(shape: SketchShape) {
    commitText();
    activeShapeTextInput = { id: shape.id, value: shape.text };
  }

  function commitShapeText(id: string) {
    if (!activeShapeTextInput) return;
    const textVal = activeShapeTextInput.value;
    sketchShapes = sketchShapes.map(s => {
      if (s.id === id) {
        return { ...s, text: textVal };
      }
      return s;
    });
    activeShapeTextInput = null;
    saveState();
  }

  function handleShapeTextKeyDown(e: KeyboardEvent, id: string) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      activeShapeTextInput = null;
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitShapeText(id);
    }
  }

  // Update shape properties
  function updateShapeProperty(id: string, property: keyof SketchShape, value: any) {
    sketchShapes = sketchShapes.map(s => {
      if (s.id === id) {
        let val = value;
        if (property === 'fillColor' && value.endsWith('22')) {
          val = s.color + '22';
        }
        return { ...s, [property]: val };
      }
      return s;
    });
    saveState();
    redraw();
  }

  function updateShapeColor(id: string, color: string) {
    sketchShapes = sketchShapes.map(s => {
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
    saveState();
    redraw();
  }

  function moveShapeLayer(id: string, direction: 'front' | 'back') {
    const shape = sketchShapes.find(s => s.id === id);
    if (!shape) return;
    
    const remaining = sketchShapes.filter(s => s.id !== id);
    if (direction === 'front') {
      sketchShapes = [...remaining, shape];
    } else {
      sketchShapes = [shape, ...remaining];
    }
    saveState();
    redraw();
  }

  function deleteShape(id: string) {
    sketchShapes = sketchShapes.filter(s => s.id !== id);
    arrows = arrows.filter(a => a.fromShapeId !== id && a.toShapeId !== id);
    if (selectedShapeId === id) {
      selectedShapeId = null;
    }
    saveState();
    redraw();
  }

  // Edit existing text boxes
  function editExistingText(text: SketchText) {
    commitText();
    activeTextInput = { x: text.x, y: text.y, value: text.value };
    currentColor = text.color;
    brushSize = Math.round(text.fontSize / 2.5);
    brushOpacity = text.opacity;
    sketchTexts = sketchTexts.filter(t => t.id !== text.id);
  }

  // Zoom centered on coordinates
  function zoomCentered(factor: number) {
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const beforeZoomX = (centerX - panOffset.x) / zoomScale;
    const beforeZoomY = (centerY - panOffset.y) / zoomScale;
    
    let nextZoom = factor > 1 ? Math.min(5.0, zoomScale * factor) : Math.max(0.1, zoomScale * factor);
    
    panOffset = {
      x: centerX - beforeZoomX * nextZoom,
      y: centerY - beforeZoomY * nextZoom
    };
    zoomScale = nextZoom;
    
    drawGrid();
    redraw();
  }

  function resetZoom() {
    zoomScale = 1.0;
    panOffset = { x: 0, y: 0 };
    drawGrid();
    redraw();
  }

  // Wheel listener (touchpad gestures + mouse wheel zoom)
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    if (!viewportEl) return;
    
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    
    const mouseX = (e.clientX - rect.left) / cssZoom;
    const mouseY = (e.clientY - rect.top) / cssZoom;
    
    if (e.ctrlKey) {
      // Touchpad Pinch gesture or Ctrl + Mouse Wheel
      const zoomFactor = 1 - e.deltaY * 0.01;
      
      const beforeZoomX = (mouseX - panOffset.x) / zoomScale;
      const beforeZoomY = (mouseY - panOffset.y) / zoomScale;
      
      let nextZoom = Math.min(5.0, Math.max(0.1, zoomScale * zoomFactor));
      
      panOffset = {
        x: mouseX - beforeZoomX * nextZoom,
        y: mouseY - beforeZoomY * nextZoom
      };
      zoomScale = nextZoom;
    } else {
      // Two-finger scroll panning
      panOffset = {
        x: panOffset.x - e.deltaX / cssZoom,
        y: panOffset.y - e.deltaY / cssZoom
      };
    }
    
    drawGrid();
    redraw();
  }

  // Undo last action
  function undo() {
    commitText();
    if (undoStack.length === 0) return;
    
    const currentStateObj = createPersistedState();
    redoStack = [...redoStack, JSON.stringify(currentStateObj)];
    
    const updatedUndo = [...undoStack];
    updatedUndo.pop();
    undoStack = updatedUndo;
    
    if (undoStack.length > 0) {
      const prevStateStr = undoStack[undoStack.length - 1];
      restoreState(prevStateStr);
    } else {
      resetCanvasDocument();
      clearPersistedSketch();
      drawGrid();
      redraw();
    }
  }

  // Redo action
  function redo() {
    commitText();
    if (redoStack.length === 0) return;
    
    const nextStateStr = redoStack[redoStack.length - 1];
    const updatedRedo = [...redoStack];
    updatedRedo.pop();
    redoStack = updatedRedo;
    
    undoStack = [...undoStack, nextStateStr];
    restoreState(nextStateStr);
  }

  // Clear canvas
  function handleClear() {
    commitText();
    if (!clearConfirm) {
      clearConfirm = true;
      if (clearConfirmTimeout) clearTimeout(clearConfirmTimeout);
      clearConfirmTimeout = setTimeout(() => {
        clearConfirm = false;
      }, 2000);
      return;
    }
    
    clearConfirm = false;
    resetCanvasDocument();
    clearPersistedSketch();
    drawGrid();
    redraw();
    showToast('Canvas cleared', 'info');
  }

  // Export current sketch drawing as a PNG image download
  function compilePNG(): HTMLCanvasElement | null {
    if (!viewportEl) return null;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewportWidth;
    tempCanvas.height = viewportHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;
    
    const w = tempCanvas.width;
    const h = tempCanvas.height;
    const isLightTheme = document.documentElement.classList.contains('light-theme');
    
    // Draw background
    if (backgroundStyle === 'solid-dark') {
      tempCtx.fillStyle = '#121216';
      tempCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'solid-light') {
      tempCtx.fillStyle = '#f3f3f6';
      tempCtx.fillRect(0, 0, w, h);
    } else if (backgroundStyle === 'dot-grid' || backgroundStyle === 'line-grid') {
      tempCtx.fillStyle = isLightTheme ? '#ffffff' : '#18181e';
      tempCtx.fillRect(0, 0, w, h);
    } else {
      // transparent mode - use theme color background
      tempCtx.fillStyle = isLightTheme ? '#ffffff' : '#18181e';
      tempCtx.fillRect(0, 0, w, h);
    }
    
    // Draw Grid Lines/Dots
    if (backgroundStyle === 'dot-grid') {
      tempCtx.fillStyle = isLightTheme ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
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
      tempCtx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
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
      tempCtx.font = `500 ${displayFontSize}px sans-serif`;
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
      tempCtx.save();
      tempCtx.globalAlpha = shape.opacity;
      
      const x = shape.x * zoomScale + panOffset.x;
      const y = shape.y * zoomScale + panOffset.y;
      const w = shape.width * zoomScale;
      const h = shape.height * zoomScale;
      const borderW = Math.max(1, 2 * zoomScale);
      
      tempCtx.strokeStyle = shape.color;
      tempCtx.lineWidth = borderW;
      
      if (shape.borderStyle === 'dashed') {
        tempCtx.setLineDash([4 * zoomScale, 4 * zoomScale]);
      } else if (shape.borderStyle === 'dotted') {
        tempCtx.setLineDash([1 * zoomScale, 3 * zoomScale]);
      } else {
        tempCtx.setLineDash([]);
      }
      
      if (shape.fillColor === 'glass') {
        tempCtx.fillStyle = isLightTheme ? 'rgba(255, 255, 255, 0.45)' : 'rgba(24, 24, 30, 0.45)';
      } else if (shape.fillColor === 'transparent') {
        tempCtx.fillStyle = 'transparent';
      } else if (shape.fillColor === 'tint' || shape.fillColor.endsWith('22')) {
        tempCtx.fillStyle = shape.color + '22';
      } else {
        tempCtx.fillStyle = shape.fillColor;
      }
      
      tempCtx.beginPath();
      if (shape.type === 'circle') {
        tempCtx.arc(x + w / 2, y + h / 2, Math.max(w, h) / 2, 0, Math.PI * 2);
      } else {
        const r = shape.borderRadius * zoomScale;
        tempCtx.roundRect(x, y, w, h, r);
      }
      
      if (shape.fillColor !== 'transparent') {
        tempCtx.fill();
      }
      if (shape.borderStyle !== 'none') {
        tempCtx.stroke();
      }
      
      if (shape.text) {
        tempCtx.fillStyle = shape.color === '#ffffff' ? '#ffffff' : (shape.color === '#18181e' ? (isLightTheme ? '#18181e' : '#ffffff') : shape.color);
        const displayFontSize = Math.max(11, 13 * zoomScale);
        tempCtx.font = `500 ${displayFontSize}px sans-serif`;
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';
        
        const lines = shape.text.split('\n');
        const lineHeight = displayFontSize * 1.25;
        const totalHeight = lines.length * lineHeight;
        const startY = y + h / 2 - totalHeight / 2 + lineHeight / 2;
        
        lines.forEach((line, index) => {
          tempCtx.fillText(line, x + w / 2, startY + index * lineHeight);
        });
      }
      tempCtx.restore();
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
    const project = $activeProject;
    if (!project) {
      showToast('No active project folder open', 'warning');
      return;
    }
    
    const compiled = compilePNG();
    if (!compiled) return;
    
    isSaving = true;
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
      isSaving = false;
    }
  }

  // Handle global key events
  function handleKeyDown(e: KeyboardEvent) {
    const isTyping = document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';
    const activeShortcuts = $userShortcuts || [];
    const canvasZoomInShortcut = activeShortcuts.find((shortcut) => shortcut && shortcut.id === 'canvasZoomIn');
    const canvasZoomOutShortcut = activeShortcuts.find((shortcut) => shortcut && shortcut.id === 'canvasZoomOut');
    const canvasResetZoomShortcut = activeShortcuts.find((shortcut) => shortcut && shortcut.id === 'canvasResetZoom');
    
    if (e.key === 'Escape') {
      if (activeTextInput) {
        e.stopPropagation();
        activeTextInput = null; // Cancel typing session
      } else if (activeShapeTextInput) {
        e.stopPropagation();
        activeShapeTextInput = null; // Cancel shape text typing
      } else {
        exitCanvas();
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId && !isTyping) {
      deleteShape(selectedShapeId);
    } else if (e.code === 'Space' && !isTyping) {
      spacePressed = true;
      if (currentTool !== 'pan') {
        e.preventDefault();
      }
    } else if (!isTyping) {
      if (canvasZoomInShortcut && matchShortcut(e, canvasZoomInShortcut.keys)) {
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

  // Handle global key up events
  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spacePressed = false;
    }
  }

  // Keyboard shortcut commit for text input
  function handleTextKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      activeTextInput = null;
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitText();
    }
  }

  function exitCanvas() {
    commitText();
    closeSketchCanvas();
  }

  let resizeObserver: ResizeObserver | null = null;

  function handleResize() {
    if (!viewportEl || !canvasEl || !gridCanvasEl) return;
    const newWidth = viewportEl.clientWidth;
    const newHeight = viewportEl.clientHeight;
    if (newWidth === 0 || newHeight === 0) return;
    
    // Adjust pan offset to keep drawings centered relative to the viewport on resize
    if (viewportWidth > 0 && viewportHeight > 0) {
      panOffset = {
        x: panOffset.x + (newWidth - viewportWidth) / 2,
        y: panOffset.y + (newHeight - viewportHeight) / 2
      };
    }
    
    viewportWidth = newWidth;
    viewportHeight = newHeight;
    
    const dpr = window.devicePixelRatio || 1;
    
    // Scale backing store by device pixel ratio to keep lines super crisp
    canvasEl.width = viewportWidth * dpr;
    canvasEl.height = viewportHeight * dpr;
    gridCanvasEl.width = viewportWidth * dpr;
    gridCanvasEl.height = viewportHeight * dpr;
    
    drawGrid();
    redraw();
  }

  onMount(() => {
    if (viewportEl && canvasEl && gridCanvasEl) {
      ctx = canvasEl.getContext('2d');
      gridCtx = gridCanvasEl.getContext('2d');
      
      // Run handleResize once synchronously to set initial canvas size
      handleResize();
      
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(viewportEl);

      viewportEl.addEventListener('wheel', handleWheel, { passive: false });

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    }
  });

  onDestroy(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    if (viewportEl) {
      viewportEl.removeEventListener('wheel', handleWheel);
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    if (clearConfirmTimeout) clearTimeout(clearConfirmTimeout);
  });

  $effect(() => {
    if (!ctx || !gridCtx) return;
    const projectId = $activeProject?.id ?? null;
    if (projectId === loadedProjectId) return;

    if (loadedProjectId) {
      commitText(loadedProjectId);
    }

    loadSavedSketch(projectId);
    loadedProjectId = projectId;
  });

  // Focus the textarea dynamically upon creation
  $effect(() => {
    if (activeTextInput && textInputEl) {
      textInputEl.focus();
    }
  });

  $effect(() => {
    if (activeShapeTextInput && shapeTextInputEl) {
      shapeTextInputEl.focus();
    }
  });

  // Watch backgroundStyle, gridSpacing, and appearance theme updates to redraw grid & canvas
  $effect(() => {
    const _style = backgroundStyle;
    const _spacing = gridSpacing;
    const _app = $appearance;
    drawGrid();
    redraw();
  });
</script>

<div 
  class="sketch-overlay"
  transition:fade={{ duration: 180 }}
>
  <div 
    bind:this={viewportEl}
    class="canvas-viewport"
    style="
      cursor: {spacePressed || currentTool === 'pan' ? (panning ? 'grabbing' : 'grab') : (currentTool === 'eraser' ? 'cell' : (currentTool === 'text' ? 'text' : (['rectangle', 'circle'].includes(currentTool) ? 'crosshair' : (currentTool === 'select' ? 'default' : 'crosshair'))))};
    "
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  >
    <!-- 1. Background Grid Canvas -->
    <canvas
      bind:this={gridCanvasEl}
      class="grid-canvas"
    ></canvas>
    
    <!-- 2. Drawings Canvas -->
    <canvas
      bind:this={canvasEl}
      class="draw-canvas"
    ></canvas>

    <!-- Render floating text blocks on top of local coordinate space -->
    {#each sketchTexts as text (text.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="floating-text"
        data-text-id={text.id}
        style="
          position: absolute;
          left: {text.x * zoomScale + panOffset.x}px;
          top: {text.y * zoomScale + panOffset.y}px;
          font-size: {text.fontSize * zoomScale}px;
          color: {text.color};
          opacity: {text.opacity};
          cursor: {currentTool === 'eraser' ? 'pointer' : (currentTool === 'select' ? 'move' : 'default')};
        "
        onpointerdown={e => startDragText(e, text)}
        ondblclick={() => editExistingText(text)}
      >
        {text.value}
      </div>
    {/each}

    <!-- Render floating shapes on top of local coordinate space -->
    {#each sketchShapes as shape (shape.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="floating-shape {shape.type}"
        class:active-selected={selectedShapeId === shape.id && currentTool === 'select'}
        data-shape-id={shape.id}
        style="
          position: absolute;
          left: {shape.x * zoomScale + panOffset.x}px;
          top: {shape.y * zoomScale + panOffset.y}px;
          width: {shape.width * zoomScale}px;
          height: {shape.height * zoomScale}px;
          border: {shape.borderStyle === 'none' ? 'none' : `${Math.max(1, 2 * zoomScale)}px ${shape.borderStyle} ${shape.color}`};
          border-radius: {shape.type === 'circle' ? '50%' : `${shape.borderRadius * zoomScale}px`};
          background-color: {
            shape.fillColor === 'glass'
              ? (isLightTheme ? 'rgba(255, 255, 255, 0.45)' : 'rgba(24, 24, 30, 0.45)')
              : (shape.fillColor === 'transparent'
                ? 'transparent'
                : (shape.fillColor === 'tint' || shape.fillColor.endsWith('22')
                  ? shape.color + '22'
                  : shape.fillColor)
                )
          };
          backdrop-filter: {shape.fillColor === 'glass' ? 'blur(8px)' : 'none'};
          -webkit-backdrop-filter: {shape.fillColor === 'glass' ? 'blur(8px)' : 'none'};
          opacity: {shape.opacity};
          cursor: {currentTool === 'eraser' ? 'pointer' : (currentTool === 'select' ? 'move' : 'default')};
        "
        onpointerdown={e => startDragShape(e, shape)}
      >
        <!-- Resize handle -->
        {#if selectedShapeId === shape.id && currentTool === 'select'}
          <div 
            class="resize-handle"
            style="
              position: absolute;
              right: -4px;
              bottom: -4px;
              width: 10px;
              height: 10px;
              cursor: se-resize;
              background-color: var(--accent);
              border-radius: 50%;
              border: 1.5px solid var(--bg-primary);
              z-index: 10;
            "
            onpointerdown={e => startResizeShape(e, shape)}
          ></div>
        {/if}

        <!-- Text container / textarea inside shape -->
        {#if activeShapeTextInput && activeShapeTextInput.id === shape.id}
          <textarea
            bind:this={shapeTextInputEl}
            bind:value={activeShapeTextInput.value}
            onblur={() => commitShapeText(shape.id)}
            onkeydown={e => handleShapeTextKeyDown(e, shape.id)}
            onpointerdown={e => e.stopPropagation()}
            class="shape-textarea"
            style="
              width: 100%;
              height: 100%;
              color: {shape.color === '#ffffff' ? '#ffffff' : (shape.color === '#18181e' ? 'var(--text-primary)' : shape.color)};
              font-size: {Math.max(12, 14 * zoomScale)}px;
            "
            placeholder="Type..."
          ></textarea>
        {:else}
          <div 
            class="shape-text-container"
            style="
              color: {shape.color === '#ffffff' ? '#ffffff' : (shape.color === '#18181e' ? 'var(--text-primary)' : shape.color)};
              font-size: {Math.max(12, 14 * zoomScale)}px;
            "
            ondblclick={() => editShapeText(shape)}
          >
            {shape.text}
          </div>
        {/if}
      </div>
    {/each}

    <!-- Floating shape context toolbar -->
    {#if selectedShapeId && currentTool === 'select'}
      {#each sketchShapes.filter(s => s.id === selectedShapeId) as activeShape (activeShape.id)}
        <div
          class="shape-context-menu bento-card"
          style="
            position: absolute;
            left: {(activeShape.x + activeShape.width / 2) * zoomScale + panOffset.x}px;
            top: {activeShape.y * zoomScale + panOffset.y - 12}px;
            transform: translate(-50%, -100%);
            z-index: 9030;
          "
          transition:scale={{ start: 0.9, duration: 120 }}
          onpointerdown={e => e.stopPropagation()}
        >
          <!-- Fill options -->
          <div class="menu-section">
            <span class="section-lbl">Fill</span>
            <button
              class="menu-btn"
              class:active={activeShape.fillColor === 'transparent'}
              onclick={() => updateShapeProperty(activeShape.id, 'fillColor', 'transparent')}
              title="Transparent"
            >
              None
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.fillColor === 'glass'}
              onclick={() => updateShapeProperty(activeShape.id, 'fillColor', 'glass')}
              title="Frosted Glass"
            >
              Glass
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.fillColor === 'tint' || activeShape.fillColor.endsWith('22')}
              onclick={() => updateShapeProperty(activeShape.id, 'fillColor', 'tint')}
              title="Color Tint"
            >
              Tint
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.fillColor !== 'transparent' && activeShape.fillColor !== 'glass' && !activeShape.fillColor.endsWith('22')}
              onclick={() => updateShapeProperty(activeShape.id, 'fillColor', activeShape.color)}
              title="Solid Color"
            >
              Solid
            </button>
          </div>

          <div class="menu-divider"></div>

          <!-- Border Style -->
          <div class="menu-section">
            <span class="section-lbl">Border</span>
            <button
              class="menu-btn"
              class:active={activeShape.borderStyle === 'solid'}
              onclick={() => updateShapeProperty(activeShape.id, 'borderStyle', 'solid')}
              title="Solid Border"
            >
              Solid
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.borderStyle === 'dashed'}
              onclick={() => updateShapeProperty(activeShape.id, 'borderStyle', 'dashed')}
              title="Dashed Border"
            >
              Dash
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.borderStyle === 'dotted'}
              onclick={() => updateShapeProperty(activeShape.id, 'borderStyle', 'dotted')}
              title="Dotted Border"
            >
              Dot
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.borderStyle === 'none'}
              onclick={() => updateShapeProperty(activeShape.id, 'borderStyle', 'none')}
              title="No Border"
            >
              None
            </button>
          </div>

          <div class="menu-divider"></div>

          <!-- Colors -->
          <div class="menu-section color-section">
            {#each presetColors as col}
              <button
                class="color-dot-mini"
                style="background-color: {col.value};"
                class:active={activeShape.color === col.value}
                onclick={() => updateShapeColor(activeShape.id, col.value)}
                title={col.name}
              ></button>
            {/each}
          </div>

          <div class="menu-divider"></div>

          <!-- Layering and Delete -->
          <div class="menu-section action-section">
            <button
              class="menu-icon-btn"
              onclick={() => moveShapeLayer(activeShape.id, 'front')}
              title="Bring to Front"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </button>
            <button
              class="menu-icon-btn"
              onclick={() => moveShapeLayer(activeShape.id, 'back')}
              title="Send to Back"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 22 2 17 12 12 22 17 12 22" />
                <polyline points="2 7 12 2 22 7" />
                <polyline points="2 12 12 7 22 12" />
              </svg>
            </button>
            <button
              class="menu-icon-btn delete-btn"
              onclick={() => deleteShape(activeShape.id)}
              title="Delete Shape"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      {/each}
    {/if}

    <!-- Interactive typing input overlay node -->
    {#if activeTextInput}
      <textarea
        bind:this={textInputEl}
        bind:value={activeTextInput.value}
        onkeydown={handleTextKeyDown}
        onblur={() => commitText()}
        onpointerdown={e => e.stopPropagation()}
        style="
          position: absolute;
          left: {activeTextInput.x * zoomScale + panOffset.x}px;
          top: {activeTextInput.y * zoomScale + panOffset.y}px;
          font-size: {Math.max(13, brushSize * 2.5) * zoomScale}px;
          color: {currentColor};
          background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.85);
          border: 1px solid var(--accent);
          outline: none;
          padding: 4px 8px;
          border-radius: 6px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          min-width: {150 * zoomScale}px;
          min-height: {40 * zoomScale}px;
          max-width: {400 * zoomScale}px;
          z-index: 9020;
          resize: both;
          overflow: hidden;
          caret-color: var(--accent);
          box-shadow: var(--shadow-sm);
        "
        placeholder="Type notes... (Ctrl+Enter to commit)"
      ></textarea>
    {/if}
  </div>

  <!-- Sleek floatable toolbar -->
  {#if showToolbar}
    <div 
      class="sketch-toolbar bento-card"
      transition:scale={{ start: 0.95, duration: 160 }}
    >
      <!-- Collapse Button inside toolbar -->
      <button
        class="tool-btn collapse-btn"
        onclick={() => showToolbar = false}
        title="Hide Toolbar"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>

      <div class="divider hide-on-stack"></div>

      <!-- Group 1: Canvas Drawing Tools -->
      <div class="toolbar-group draw-group">
        <!-- Mode selection: Select / Pen / Eraser / Text / Rectangle / Circle / Connector / Hand(Pan) -->
        <div class="toolbar-section main-tools">
          <button
            class="tool-btn"
            class:active={currentTool === 'select'}
            onclick={() => { commitText(); currentTool = 'select'; }}
            title="Select & Move (V)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
              <path d="m13 13 6 6"/>
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'pen' && !spacePressed}
            onclick={() => { commitText(); currentTool = 'pen'; }}
            title="Draw (Pen)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'eraser'}
            onclick={() => { commitText(); currentTool = 'eraser'; }}
            title="Erase (Click lines, text, or shapes)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 13"/>
              <path d="M17 17l-4-4"/>
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'text'}
            onclick={() => { commitText(); currentTool = 'text'; }}
            title="Type notes (Text Tool)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'rectangle'}
            onclick={() => { commitText(); currentTool = 'rectangle'; }}
            title="Rectangle Shape"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'circle'}
            onclick={() => { commitText(); currentTool = 'circle'; }}
            title="Circle Shape"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'connector'}
            onclick={() => { commitText(); currentTool = 'connector'; }}
            title="Arrow Connector (Drag notes or shapes)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="19" x2="19" y2="5"/>
              <polyline points="12 5 19 5 19 12"/>
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'pan' || spacePressed}
            onclick={() => { commitText(); currentTool = 'pan'; }}
            title="Pan Canvas (Hold Space or Hand Tool)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
              <path d="M14 10V4a2 2 0 0 0-2 2v0a2 2 0 0 0-2 2v0"/>
              <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
              <path d="M6 14a4 4 0 0 0-4-4v0a4 4 0 0 0-4 4v7a4 4 0 0 0 4 4h8a7 7 0 0 0 7-7v-3a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2"/>
            </svg>
          </button>
        </div>

        <div class="divider"></div>

        <!-- Quick brush size / font size options -->
        <div class="toolbar-section sizes">
          <button
            class="size-btn"
            class:active={brushSize === 2}
            onclick={() => brushSize = 2}
            onpointerdown={e => e.preventDefault()}
            title="Fine brush / 13px Text"
          >
            <span class="dot size-xs"></span>
          </button>
          <button
            class="size-btn"
            class:active={brushSize === 6}
            onclick={() => brushSize = 6}
            onpointerdown={e => e.preventDefault()}
            title="Medium brush / 18px Text"
          >
            <span class="dot size-sm"></span>
          </button>
          <button
            class="size-btn"
            class:active={brushSize === 14}
            onclick={() => brushSize = 14}
            onpointerdown={e => e.preventDefault()}
            title="Thick brush / 35px Text"
          >
            <span class="dot size-md"></span>
          </button>
          <button
            class="size-btn"
            class:active={brushSize === 32}
            onclick={() => brushSize = 32}
            onpointerdown={e => e.preventDefault()}
            title="Highlighter / 80px Text"
          >
            <span class="dot size-lg"></span>
          </button>
        </div>

        <div class="divider"></div>

        <!-- Preset and custom colors -->
        <div class="toolbar-section colors">
          {#each presetColors as col}
            <button
              class="color-dot"
              class:active={currentColor === col.value && currentTool !== 'eraser'}
              style="background-color: {col.value}; border: 1.5px solid {col.value === '#ffffff' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)'}"
              onclick={() => { currentColor = col.value; if (currentTool === 'eraser') currentTool = 'pen'; }}
              onpointerdown={e => e.preventDefault()}
              title={col.name}
            ></button>
          {/each}
          <button
            class="color-dot custom-color-trigger"
            class:active={currentColor === customColor && currentTool !== 'eraser'}
            style="background-image: conic-gradient(red, yellow, green, cyan, blue, magenta, red);"
            onclick={() => colorPickerEl?.click()}
            onpointerdown={e => e.preventDefault()}
            title="Custom Color"
          >
            <input
              type="color"
              bind:this={colorPickerEl}
              bind:value={customColor}
              oninput={() => { currentColor = customColor; if (currentTool === 'eraser') currentTool = 'pen'; }}
              class="hidden-color-picker"
            />
          </button>
        </div>

        <!-- Highlighter opacity slider -->
        {#if currentTool !== 'eraser'}
          <div class="divider"></div>
          <div class="toolbar-section opacity-slider" transition:fade={{ duration: 100 }}>
            <span class="slider-label">Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              bind:value={brushOpacity}
              title="Brush/Text Opacity"
            />
            <span class="slider-val">{Math.round(brushOpacity * 100)}%</span>
          </div>
        {/if}
      </div>

      <!-- Main group-to-group divider -->
      <div class="divider group-divider hide-on-stack"></div>

      <!-- Group 2: Canvas Settings & Actions -->
      <div class="toolbar-group utility-group">
        <!-- Grid and Background settings dropdown -->
        <div class="toolbar-section custom-settings-dropdown-wrapper">
          <button
            type="button"
            class="settings-trigger-btn"
            class:open={showSettingsDropdown}
            onclick={(e) => {
              e.stopPropagation();
              showSettingsDropdown = !showSettingsDropdown;
            }}
            title="Canvas Grid & Export Settings"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
            </svg>
            <span class="active-style-label">
              {backgroundStyle === 'transparent' ? 'Transparent' :
               backgroundStyle === 'dot-grid' ? 'Dot Grid' :
               backgroundStyle === 'line-grid' ? 'Graph Grid' :
               backgroundStyle === 'isometric-grid' ? 'Isometric' :
               backgroundStyle === 'blackboard' ? 'Blackboard' :
               backgroundStyle === 'blueprint' ? 'Blueprint' :
               backgroundStyle === 'solid-dark' ? 'Solid Dark' : 'Solid Light'}
            </span>
            <svg class="dd-chevron" class:rotated={showSettingsDropdown} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {#if showSettingsDropdown}
            <div 
              class="settings-dropdown-panel" 
              onclick={(e) => e.stopPropagation()}
              transition:fade={{ duration: 100 }}
            >
              <!-- Background Section -->
              <div class="panel-section">
                <div class="section-title">Background Style</div>
                <div class="grid-style-options">
                  {#each [
                    { value: 'transparent', label: 'Transparent' },
                    { value: 'dot-grid', label: 'Dot Grid' },
                    { value: 'line-grid', label: 'Graph Grid' },
                    { value: 'isometric-grid', label: 'Isometric' },
                    { value: 'blackboard', label: 'Blackboard' },
                    { value: 'blueprint', label: 'Blueprint' },
                    { value: 'solid-dark', label: 'Solid Dark' },
                    { value: 'solid-light', label: 'Solid Light' }
                  ] as style}
                    <button 
                      type="button" 
                      class="style-opt-btn"
                      class:active={backgroundStyle === style.value}
                      onclick={() => {
                        backgroundStyle = style.value as SketchBackgroundStyle;
                        persistCanvasSnapshot();
                        drawGrid();
                        redraw();
                      }}
                    >
                      {style.label}
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Grid Settings -->
              {#if ['dot-grid', 'line-grid', 'isometric-grid', 'blackboard', 'blueprint'].includes(backgroundStyle)}
                <div class="panel-section">
                  <div class="section-title">Grid Configuration</div>
                  
                  <!-- Spacing Buttons -->
                  <div class="setting-row">
                    <span class="setting-label">Grid Spacing</span>
                    <div class="spacing-btn-group">
                      {#each [12, 24, 48] as spacing}
                        <button
                          type="button"
                          class="spacing-btn"
                          class:active={gridSpacing === spacing}
                          onclick={() => {
                            gridSpacing = spacing;
                            persistCanvasSnapshot();
                            drawGrid();
                            redraw();
                          }}
                        >
                          {spacing}px
                        </button>
                      {/each}
                    </div>
                  </div>

                  <!-- Snap Toggle -->
                  <div class="setting-row">
                    <span class="setting-label">Snap to Grid</span>
                    <label class="switch-control">
                      <input
                        type="checkbox"
                        bind:checked={snapToGrid}
                        onchange={() => persistCanvasSnapshot()}
                      />
                      <span class="switch-slider"></span>
                    </label>
                  </div>
                </div>
              {/if}

              <!-- JSON Utilities -->
              <div class="panel-section utilities-section">
                <div class="section-title">Utilities</div>
                <div class="utility-buttons">
                  <button type="button" class="util-btn" onclick={exportJSON}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export JSON
                  </button>
                  <button type="button" class="util-btn" onclick={() => jsonFileInputEl?.click()}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Import JSON
                  </button>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <div class="divider"></div>

        <!-- GPU-accelerated Zoom control items -->
        <div class="toolbar-section zoom-controls">
          <button class="tool-btn zoom-btn" onclick={() => zoomCentered(0.85)} title="Zoom Out">-</button>
          <button class="zoom-display-btn" onclick={resetZoom} title="Reset Zoom (1:1 / Center)">{Math.round(zoomScale * 100)}%</button>
          <button class="tool-btn zoom-btn" onclick={() => zoomCentered(1.15)} title="Zoom In">+</button>
        </div>

        <div class="divider"></div>

        <!-- Action buttons: undo, redo, clear, save, close -->
        <div class="toolbar-section actions">
          <button
            class="action-btn"
            disabled={undoStack.length === 0}
            onclick={undo}
            title="Undo"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7v6h6"/>
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>
          </button>
          <button
            class="action-btn"
            disabled={redoStack.length === 0}
            onclick={redo}
            title="Redo"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 7v6h-6"/>
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
            </svg>
          </button>
          <button
            class="action-btn clear-btn"
            class:confirming={clearConfirm}
            onclick={handleClear}
            title="Clear all drawings"
          >
            {#if clearConfirm}
              <span class="confirm-text">Confirm?</span>
            {:else}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            {/if}
          </button>
          <button
            class="action-btn"
            onclick={downloadPNG}
            title="Download PNG File"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button
            class="action-btn save-btn"
            disabled={isSaving}
            onclick={saveToWorkspace}
            title="Save sketch to Project folder"
          >
            {#if isSaving}
              <span class="saving-spinner"></span>
            {:else}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            {/if}
          </button>
        </div>

        <div class="divider"></div>

        <!-- Exit button -->
        <div class="toolbar-section close-section">
          <button
            class="exit-btn"
            onclick={exitCanvas}
            title="Close Sketch Canvas (Esc)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Floating display controls toggle when toolbar is hidden -->
  {#if !showToolbar}
    <button 
      class="toolbar-toggle bento-card"
      onclick={() => showToolbar = true}
      title="Show controls"
      transition:scale={{ start: 0.9, duration: 150 }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    </button>
  {/if}
  
  <input
    type="file"
    accept=".json"
    style="display: none;"
    bind:this={jsonFileInputEl}
    onchange={handleJSONImport}
  />
</div>

<style>
  .sketch-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    background:
      radial-gradient(circle at top, rgba(var(--accent-rgb, 6, 182, 212), 0.08), transparent 42%),
      rgba(var(--bg-primary-rgb, 24, 24, 30), var(--frost-surface, 0.84));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(1.1);
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(1.1);
    transition: background-color 0.22s ease;
    border-radius: var(--bento-radius, 12px);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
    container-type: inline-size;
    container-name: sketch-container;
  }

  :root.light-theme .sketch-overlay {
    background:
      radial-gradient(circle at top, rgba(var(--accent-rgb, 6, 182, 212), 0.1), transparent 42%),
      rgba(255, 255, 255, var(--frost-surface, 0.88));
  }

  .canvas-viewport {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--bento-radius, 12px);
    background:
      linear-gradient(180deg, rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.58), rgba(var(--bg-primary-rgb, 24, 24, 30), 0.5));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  :root.light-theme .canvas-viewport {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(243, 243, 246, 0.52));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }

  .grid-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    z-index: 1;
  }

  .draw-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    z-index: 2;
  }

  /* Floating committed text labels */
  .floating-text {
    padding: 3px 6px;
    user-select: none;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-weight: 500;
    line-height: 1.25;
    border: 1px dashed transparent;
    border-radius: 4px;
    transition: background-color 0.15s, border-color 0.15s;
    white-space: pre-wrap;
    touch-action: none;
    z-index: 3;
    transform-origin: 0 0;
  }

  .floating-text:hover {
    background-color: rgba(255, 255, 255, 0.05);
    border-color: var(--accent);
  }

  :root.light-theme .floating-text:hover {
    background-color: rgba(0, 0, 0, 0.04);
  }

  /* Floating shapes */
  .floating-shape {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    touch-action: none;
    z-index: 3;
    transform-origin: 0 0;
    transition: box-shadow 0.15s, background-color 0.15s;
  }

  .floating-shape:hover {
    box-shadow: 0 0 0 1.5px var(--accent-light);
  }

  .floating-shape.active-selected {
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* Shape context menu */
  .shape-context-menu {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-md);
    min-height: 32px;
    white-space: nowrap;
    animation: popIn 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  :root.light-theme .shape-context-menu {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(0, 0, 0, 0.08);
  }

  @keyframes popIn {
    from { transform: translate(-50%, -85%) scale(0.95); opacity: 0; }
    to { transform: translate(-50%, -100%) scale(1); opacity: 1; }
  }

  .menu-section {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .section-lbl {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-right: 4px;
  }

  .menu-btn {
    font-size: 10px;
    font-weight: 600;
    padding: 3px 6px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-btn.active {
    background: var(--accent-light);
    color: var(--accent);
    border-color: rgba(var(--accent-rgb, 6, 182, 212), 0.15);
  }

  .menu-divider {
    width: 1px;
    height: 14px;
    background-color: var(--border);
    margin: 0 2px;
  }

  .color-dot-mini {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    cursor: pointer;
    border: 1.5px solid transparent;
    transition: transform 0.1s ease;
  }

  .color-dot-mini:hover {
    transform: scale(1.2);
  }

  .color-dot-mini.active {
    transform: scale(1.2);
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--bg-primary);
  }

  .menu-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .menu-icon-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .menu-icon-btn.delete-btn:hover {
    color: var(--error);
    background: rgba(248, 113, 113, 0.12);
  }

  /* Shape Text Editing */
  .shape-text-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    text-align: center;
    white-space: pre-wrap;
    overflow: hidden;
    line-height: 1.25;
    padding: 8px;
  }

  .shape-textarea {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none !important;
    outline: none !important;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
    font-family: inherit;
    resize: none;
    text-align: center;
    overflow: hidden;
    padding: 8px;
    margin: 0;
    box-sizing: border-box;
  }

  /* Toolbar */
  .sketch-toolbar {
    position: absolute;
    top: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 14px;
    width: min(1120px, calc(100% - 40px));
    max-width: calc(100% - 40px);
    z-index: 9010;
    box-shadow: var(--shadow-lg);
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.72);
    border: 1px solid var(--border);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-radius: 16px;
    min-height: 48px;
    height: auto;
    overflow: visible !important;
    transition: all 0.2s ease;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    transition: all 0.2s ease;
  }

  .collapse-btn {
    opacity: 0.8;
  }

  .collapse-btn:hover {
    color: var(--accent) !important;
    background-color: var(--accent-light) !important;
  }

  :root.light-theme .sketch-toolbar {
    background: rgba(255, 255, 255, 0.8);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .main-tools {
    display: grid;
    grid-template-columns: repeat(8, minmax(32px, 1fr));
    gap: 6px;
  }

  .divider {
    width: 1px;
    height: 20px;
    background-color: var(--border);
    margin: 0 4px;
  }

  :root.light-theme .divider {
    background-color: rgba(0, 0, 0, 0.08);
  }

  /* Tool Buttons */
  .tool-btn, .action-btn, .exit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: var(--text-secondary);
    transition: all 0.15s ease;
  }

  .tool-btn:hover, .action-btn:not(:disabled):hover, .exit-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .tool-btn.active {
    color: var(--accent);
    background-color: var(--accent-light);
  }

  .action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .exit-btn:hover {
    color: var(--error);
    background-color: rgba(248, 113, 113, 0.12);
  }

  /* Size Selector */
  .sizes {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .size-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    transition: all 0.15s ease;
  }

  .size-btn:hover {
    background-color: var(--bg-hover);
  }

  .size-btn.active {
    background-color: var(--bg-active);
  }

  .size-btn .dot {
    background-color: var(--text-secondary);
    border-radius: 50%;
    transition: background-color 0.15s ease;
  }

  .size-btn.active .dot {
    background-color: var(--accent);
  }

  .size-xs { width: 3px; height: 3px; }
  .size-sm { width: 6px; height: 6px; }
  .size-md { width: 10px; height: 10px; }
  .size-lg { width: 16px; height: 16px; }

  /* Colors */
  .colors {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .color-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    cursor: pointer;
    position: relative;
    transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.15s ease;
  }

  .color-dot:hover {
    transform: scale(1.2);
  }

  .color-dot.active {
    transform: scale(1.2);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 3.5px var(--accent);
  }

  :root.light-theme .color-dot.active {
    box-shadow: 0 0 0 2px #ffffff, 0 0 0 3.5px var(--accent);
  }

  .custom-color-trigger {
    overflow: hidden;
  }

  .hidden-color-picker {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  /* Slider */
  .opacity-slider {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .slider-label {
    opacity: 0.8;
  }

  .slider-val {
    width: 32px;
    text-align: right;
    font-family: var(--font-mono, monospace);
  }

  .opacity-slider input[type="range"] {
    width: 60px;
    height: 3px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--input-border);
    outline: none;
    border-radius: 99px;
  }

  .opacity-slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    transition: transform 0.1s ease;
  }

  .opacity-slider input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  /* Custom Settings Dropdown & Utilities styles */
  .custom-settings-dropdown-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .settings-trigger-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.45);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
    transition: all 0.15s ease;
    height: 32px;
  }

  .settings-trigger-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.65);
  }

  .settings-trigger-btn.open {
    border-color: var(--accent);
    color: var(--text-primary);
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.8);
  }

  .active-style-label {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dd-chevron {
    flex-shrink: 0;
    opacity: 0.55;
    transition: transform 0.18s ease, opacity 0.15s;
  }

  .dd-chevron.rotated {
    transform: rotate(180deg);
    opacity: 0.9;
  }

  .settings-dropdown-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 280px;
    max-width: min(280px, calc(100vw - 32px));
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.85);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 9020;
  }

  :root.light-theme .settings-dropdown-panel {
    background: rgba(255, 255, 255, 0.92);
    border-color: rgba(0, 0, 0, 0.08);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12);
  }

  .panel-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .panel-section:not(:last-child) {
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
  }

  :root.light-theme .panel-section:not(:last-child) {
    border-bottom-color: rgba(0, 0, 0, 0.06);
  }

  .section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 2px;
  }

  .grid-style-options {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .style-opt-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .style-opt-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-focus);
  }

  .style-opt-btn.active {
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-primary));
    color: var(--text-primary);
    border-color: var(--accent);
    font-weight: 600;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .setting-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .spacing-btn-group {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.15);
    padding: 2px;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  :root.light-theme .spacing-btn-group {
    background: rgba(0, 0, 0, 0.03);
  }

  .spacing-btn {
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 600;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .spacing-btn:hover {
    color: var(--text-primary);
  }

  .spacing-btn.active {
    background: var(--accent);
    color: #ffffff;
  }

  .switch-control {
    position: relative;
    display: inline-block;
    width: 34px;
    height: 18px;
  }

  .switch-control input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .switch-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border);
    transition: .2s;
    border-radius: 18px;
  }

  .switch-slider:before {
    position: absolute;
    content: "";
    height: 12px;
    width: 12px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .2s;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .switch-control input:checked + .switch-slider {
    background-color: var(--accent);
  }

  .switch-control input:checked + .switch-slider:before {
    transform: translateX(16px);
  }

  .utility-buttons {
    display: flex;
    gap: 8px;
  }

  .util-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.3);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .util-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .util-btn svg {
    flex-shrink: 0;
  }

  /* Zoom controls display */
  .zoom-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
  }

  .zoom-btn {
    font-weight: 600;
    font-size: 14px;
    width: 24px;
    height: 24px;
  }

  .zoom-display-btn {
    min-width: 58px;
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    color: var(--text-secondary);
    padding: 4px 6px;
    border-radius: 4px;
    transition: color 0.15s, background-color 0.15s;
  }

  .zoom-display-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  /* Clear Confirm styling */
  .clear-btn {
    transition: width 0.2s ease, background-color 0.15s;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .clear-btn.confirming {
    width: 76px;
    color: #ffffff;
    background-color: var(--error);
  }

  .clear-btn.confirming:hover {
    background-color: #ef4444;
  }

  /* Save Spinner */
  .saving-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Toggle Button */
  .toolbar-toggle {
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    z-index: 9015;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.75);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .toolbar-toggle:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--accent);
    transform: scale(1.05);
  }

  :root.light-theme .toolbar-toggle {
    background: rgba(255, 255, 255, 0.85);
    border-color: rgba(0, 0, 0, 0.08);
  }

  /* Responsive Toolbar adaptations for smaller screens */
  @container sketch-container (max-width: 1160px) {
    .sketch-toolbar {
      top: 16px;
      width: min(100%, calc(100% - 24px));
      max-width: calc(100% - 24px);
      flex-direction: column;
      padding: 10px 16px;
      gap: 10px;
      border-radius: 20px;
    }
    .hide-on-stack {
      display: none !important;
    }
    .toolbar-group {
      width: 100%;
      justify-content: center;
    }
    .draw-group,
    .utility-group {
      row-gap: 10px;
    }
    .main-tools {
      grid-template-columns: repeat(4, minmax(32px, 1fr));
      justify-items: center;
    }
    .actions {
      justify-content: center;
    }
    .close-section {
      width: auto;
      justify-content: center;
    }
    .settings-dropdown-panel {
      right: auto;
      left: 50%;
      transform: translateX(-50%);
    }
  }

  @container sketch-container (max-width: 768px) {
    .sketch-toolbar {
      top: 12px;
      padding: 10px 12px;
      gap: 8px;
      border-radius: 18px;
    }
    .active-style-label {
      display: none;
    }
    .opacity-slider .slider-label {
      display: none;
    }
    .draw-group {
      justify-content: center;
      gap: 6px;
    }
    .main-tools {
      grid-template-columns: repeat(4, minmax(30px, 1fr));
      width: 100%;
    }
    .toolbar-section {
      justify-content: center;
    }
    .colors {
      justify-content: center;
    }
    .opacity-slider {
      justify-content: center;
      width: 100%;
    }
    .opacity-slider input[type="range"] {
      width: min(120px, 42vw);
    }
    .settings-trigger-btn {
      padding-inline: 10px;
    }
    .actions {
      gap: 4px;
    }
    .sketch-toolbar .divider:not(.group-divider) {
      display: none;
    }
  }

  @container sketch-container (max-width: 560px) {
    .sketch-toolbar {
      width: min(100%, calc(100% - 16px));
      max-width: calc(100% - 16px);
      padding: 8px 10px;
      gap: 6px;
      border-radius: 16px;
    }
    .tool-btn, .action-btn, .exit-btn {
      width: 30px;
      height: 30px;
    }
    .main-tools {
      grid-template-columns: repeat(4, minmax(28px, 1fr));
      gap: 4px;
    }
    .size-btn {
      width: 24px;
      height: 24px;
    }
    .color-dot {
      width: 16px;
      height: 16px;
    }
    .zoom-display-btn {
      min-width: 52px;
      font-size: 10px;
      padding: 4px 5px;
    }
    .settings-dropdown-panel {
      width: min(280px, calc(100vw - 20px));
    }
  }
</style>
