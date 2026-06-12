<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { sketchCanvasOpen, closeSketchCanvas } from '$lib/stores/sketch';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { fade, scale } from 'svelte/transition';
  import { appearance, matchShortcut, userShortcuts } from '$lib/stores/settings';
  import {
    roughRect,
    roughEllipse,
    roughDiamond,
    roughArrow,
    makeSeed,
    type RoughFillStyle,
    type RoughOptions
  } from '$lib/utils/roughSketch';

  interface Point {
    x: number;
    y: number;
  }

  type SketchShapeType = 'rectangle' | 'circle' | 'ellipse' | 'diamond';
  type FillStyle = RoughFillStyle;
  type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'none';
  type EdgeStyle = 'sharp' | 'round';
  type TextAlign = 'left' | 'center' | 'right';
  type TextWeight = '400' | '600' | '700';

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
    fontFamily?: string;
    fontWeight?: TextWeight;
    fontStyle?: 'normal' | 'italic';
    textAlign?: TextAlign;
  }

  interface SketchShape {
    id: string;
    type: SketchShapeType;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    fillColor: string; // 'transparent' | 'glass' | 'tint' | hex color
    borderStyle: StrokeStyle;
    borderRadius: number;
    opacity: number;
    text: string;
    // Hand-drawn ("Excalidraw") styling — optional for back-compat.
    seed?: number;
    roughness?: number; // 0 = clean, 1 = artist, 2 = cartoonist
    fillStyle?: FillStyle;
    edges?: EdgeStyle;
    strokeWidth?: number;
    rotation?: number; // radians, clockwise; undefined/0 = unrotated
  }

  interface SketchImage {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    src: string; // data URL (capped/downscaled on import)
    opacity: number;
    rotation?: number; // radians, clockwise
    naturalWidth?: number;
    naturalHeight?: number;
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
    // Hand-drawn styling — optional for back-compat.
    arrowType?: 'arrow' | 'line';
    seed?: number;
    roughness?: number;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
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
    backgroundOpacity?: number;
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
    images?: SketchImage[];
    sketchImages?: SketchImage[];
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
  type SketchTool =
    | 'select'
    | 'pen'
    | 'eraser'
    | 'text'
    | 'pan'
    | 'arrow'
    | 'line'
    | 'rectangle'
    | 'circle'
    | 'diamond'
    | 'image';
  let currentTool = $state<SketchTool>('select');
  let currentColor = $state('#f8fafc');
  let customColor = $state('#f8fafc');
  let brushSize = $state(6);
  let brushOpacity = $state(1.0);

  // Hand-drawn ("Excalidraw") style defaults applied to new shapes/lines/arrows
  let currentRoughness = $state(1); // 0 = clean, 1 = artist, 2 = cartoonist
  let currentFillStyle = $state<FillStyle>('solid');
  let currentFillColor = $state('transparent'); // 'transparent' | 'glass' | 'tint' | hex
  let currentStrokeStyle = $state<StrokeStyle>('solid');
  let currentEdges = $state<EdgeStyle>('round');
  let currentBorderRadius = $state(8);
  let showProperties = $state(true);
  const sketchFontStack = "'Segoe Print', 'Bradley Hand ITC', 'Comic Sans MS', cursive";
  const cleanFontStack = "Nunito, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const codeFontStack = "'Comic Shanns', 'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
  const serifFontStack = "Georgia, 'Times New Roman', serif";
  let currentTextFontFamily = $state(sketchFontStack);
  let currentTextWeight = $state<TextWeight>('600');
  let currentTextStyle = $state<'normal' | 'italic'>('normal');
  let currentTextAlign = $state<TextAlign>('left');

  const markerFontStack = "'Permanent Marker', 'Segoe Print', 'Bradley Hand ITC', cursive";
  const roundedFontStack = "'Baloo 2', Nunito, 'Segoe UI', system-ui, sans-serif";
  const textFontOptions = [
    { label: 'Sketch', value: sketchFontStack },
    { label: 'Marker', value: markerFontStack },
    { label: 'Clean', value: cleanFontStack },
    { label: 'Rounded', value: roundedFontStack },
    { label: 'Code', value: codeFontStack },
    { label: 'Serif', value: serifFontStack }
  ];
  const textAlignOptions: TextAlign[] = ['left', 'center', 'right'];
  const fontSizeOptions = [
    { label: 'S', value: 16 },
    { label: 'M', value: 24 },
    { label: 'L', value: 36 },
    { label: 'XL', value: 56 }
  ];
  const roughnessOptions = [
    { value: 0, label: 'Clean' },
    { value: 1, label: 'Pencil' },
    { value: 2, label: 'Loose' }
  ];
  const fillStyleOptions: Array<{ value: FillStyle; label: string }> = [
    { value: 'solid', label: 'Solid' },
    { value: 'hachure', label: 'Hatch' },
    { value: 'cross-hatch', label: 'Cross' }
  ];

  const SHAPE_TOOLS: SketchTool[] = ['rectangle', 'circle', 'diamond'];
  const LINEAR_TOOLS: SketchTool[] = ['arrow', 'line'];
  function isShapeTool(t: SketchTool) {
    return SHAPE_TOOLS.includes(t);
  }
  function isLinearTool(t: SketchTool) {
    return LINEAR_TOOLS.includes(t);
  }

  // Derive a per-element shape stroke width from the active brush size.
  function shapeStrokeWidth(width: number) {
    return Math.max(1, width * 0.55);
  }
  function strokeStyleDash(style: StrokeStyle, width: number): number[] | null {
    if (style === 'dashed') return [Math.max(6, width * 3), Math.max(5, width * 2.5)];
    if (style === 'dotted') return [Math.max(0.5, width * 0.6), Math.max(4, width * 2.5)];
    return null;
  }

  // Layout Shapes State
  let sketchShapes = $state<SketchShape[]>([]);
  let drawingShape = $state(false);
  let shapeStartPoint = $state<Point | null>(null);
  let shapeCurrentPoint = $state<Point | null>(null);
  let selectedShapeId = $state<string | null>(null);
  let multiSelectedIds = $state<string[]>([]);
  let activeShapeTextInput = $state<{ id: string; value: string } | null>(null);

  // Marquee (rubber-band) selection state
  let marqueeActive = $state(false);
  let marqueeStart = $state<Point | null>(null);
  let marqueeCurrent = $state<Point | null>(null);
  let groupDragging = $state(false);
  let groupDragStart = { x: 0, y: 0 };
  let groupStartPositions = new Map<string, { x: number; y: number }>();
  let shapeTextInputEl = $state<HTMLTextAreaElement | null>(null);

  // Drag shape state
  let draggingShapeId = $state<string | null>(null);
  let dragShapeStart = { x: 0, y: 0 };
  let shapeStartCoords = { x: 0, y: 0 };

  // Resize shape state
  let resizingShapeId = $state<string | null>(null);
  let resizeShapeStart = { x: 0, y: 0 };
  let shapeStartDims = { width: 0, height: 0 };
  // Which handle is being dragged: corners + rotation.
  type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
  let resizeHandle = $state<ResizeHandle>('se');
  let shapeStartOrigin = { x: 0, y: 0 };
  // Rotation state (shared by shapes + images)
  let rotatingId = $state<string | null>(null);
  let rotatingKind = $state<'shape' | 'image'>('shape');
  let rotateCenter = { x: 0, y: 0 };
  let rotateStartAngle = 0;
  let rotateStartRotation = 0;

  // --- Images ---------------------------------------------------------------
  let sketchImages = $state<SketchImage[]>([]);
  let selectedImageId = $state<string | null>(null);
  let draggingImageId = $state<string | null>(null);
  let dragImageStart = { x: 0, y: 0 };
  let imageStartCoords = { x: 0, y: 0 };
  let resizingImageId = $state<string | null>(null);
  let resizeImageStart = { x: 0, y: 0 };
  let imageStartDims = { width: 0, height: 0 };
  let imageStartOrigin = { x: 0, y: 0 };
  let imageResizeHandle = $state<ResizeHandle>('se');
  let imageFileInputEl = $state<HTMLInputElement | null>(null);
  // Decoded <img> elements keyed by image id, for PNG export.
  let imageElements = new Map<string, HTMLImageElement>();
  // Largest dimension (px) an imported image is downscaled to before storing.
  const MAX_IMAGE_DIM = 1600;

  // Theme tracking
  let isLightTheme = $derived($appearance === 'light' || ($appearance === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches));
  let defaultCanvasInk = $derived(isLightTheme ? '#18181e' : '#f8fafc');
  let lastAppliedDefaultInk = $state('#f8fafc');

  // When the 'transparent' background is active, scale the overlay + viewport
  // backdrop by backgroundOpacity so it can go from the default dark look all
  // the way to fully see-through (revealing the workspace behind).
  let overlayBackdropStyle = $derived.by(() => {
    if (backgroundStyle !== 'transparent') return '';
    const a = backgroundOpacity;
    const blur = (18 * a).toFixed(2);
    const filter = `backdrop-filter: blur(${blur}px) saturate(1.05); -webkit-backdrop-filter: blur(${blur}px) saturate(1.05);`;
    if (isLightTheme) {
      return `background: linear-gradient(135deg, rgba(15,118,110,${0.08 * a}), transparent 24%), linear-gradient(180deg, rgba(246,248,251,${0.94 * a}), rgba(238,242,246,${0.9 * a})); ${filter}`;
    }
    return `background: linear-gradient(135deg, rgba(6,182,212,${0.07 * a}), transparent 24%), linear-gradient(180deg, rgba(11,13,18,${0.96 * a}), rgba(16,18,24,${0.92 * a})); ${filter}`;
  });
  let viewportBackdropStyle = $derived.by(() => {
    if (backgroundStyle !== 'transparent') return '';
    const a = backgroundOpacity;
    if (isLightTheme) {
      return `background: repeating-linear-gradient(0deg, rgba(15,23,42,${0.045 * a}) 0 1px, transparent 1px 48px), repeating-linear-gradient(90deg, rgba(15,23,42,${0.035 * a}) 0 1px, transparent 1px 48px), linear-gradient(180deg, rgba(255,255,255,${0.72 * a}), rgba(244,247,250,${0.62 * a})); box-shadow: inset 0 1px 0 rgba(255,255,255,${0.72 * a}), inset 0 -80px 120px rgba(15,23,42,${0.06 * a});`;
    }
    return `background: repeating-linear-gradient(0deg, rgba(255,255,255,${0.025 * a}) 0 1px, transparent 1px 48px), repeating-linear-gradient(90deg, rgba(255,255,255,${0.018 * a}) 0 1px, transparent 1px 48px), linear-gradient(180deg, rgba(12,15,21,${0.78 * a}), rgba(16,19,26,${0.64 * a})); box-shadow: inset 0 1px 0 rgba(255,255,255,${0.06 * a}), inset 0 -80px 120px rgba(0,0,0,${0.16 * a});`;
  });

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
  // Backdrop opacity for the 'transparent' background (0 = fully see-through).
  let backgroundOpacity = $state(1);
  let showSettingsDropdown = $state(false);
  let showFontDropdown = $state(false);
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
  let selectedTextId = $state<string | null>(null);
  let draggingTextId = $state<string | null>(null);
  let dragStart = { x: 0, y: 0 };
  let textStart = { x: 0, y: 0 };
  let selectedPanelText = $derived(sketchTexts.find(t => t.id === selectedTextId) ?? null);
  let selectedPanelShape = $derived(sketchShapes.find(s => s.id === selectedShapeId) ?? null);
  let selectedPanelImage = $derived(sketchImages.find(im => im.id === selectedImageId) ?? null);
  let panelFontFamily = $derived(selectedPanelText?.fontFamily ?? currentTextFontFamily);
  let panelFontSize = $derived(selectedPanelText?.fontSize ?? Math.max(13, Math.round(brushSize * 2.5)));
  let panelTextAlign = $derived(selectedPanelText?.textAlign ?? currentTextAlign);
  let panelOpacity = $derived(selectedPanelText?.opacity ?? selectedPanelShape?.opacity ?? selectedPanelImage?.opacity ?? brushOpacity);
  let panelFillColor = $derived(selectedPanelShape?.fillColor ?? currentFillColor);
  let panelFillStyle = $derived(selectedPanelShape?.fillStyle ?? currentFillStyle);
  let panelEdges = $derived(selectedPanelShape?.edges ?? currentEdges);
  let panelBorderRadius = $derived(selectedPanelShape?.borderRadius ?? currentBorderRadius);

  // Viewport sizes
  let viewportWidth = $state(800);
  let viewportHeight = $state(600);

  function contextMenuStyle(anchorX: number, anchorY: number, estimatedWidth: number) {
    const margin = 12;
    const panelReserve = showProperties ? (viewportWidth <= 768 ? 300 : 320) : 0;
    const rightEdge = Math.max(margin + 220, viewportWidth - margin - panelReserve);
    const availableWidth = Math.max(220, rightEdge - margin);
    const menuWidth = Math.min(estimatedWidth, availableWidth);
    const unclampedLeft = anchorX - menuWidth / 2;
    const left = Math.min(Math.max(unclampedLeft, margin), Math.max(margin, rightEdge - menuWidth));

    return `
      position: absolute;
      left: ${Math.round(left)}px;
      top: ${Math.round(anchorY - 12)}px;
      transform: translateY(-100%);
      z-index: 9030;
      --context-menu-max-width: ${Math.round(availableWidth)}px;
    `;
  }

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

  function adaptiveInkForBackground(style: SketchBackgroundStyle): string {
    if (style === 'blackboard') return '#f7f0d8';
    if (style === 'blueprint') return '#d8ecff';
    if (style === 'solid-dark') return '#f8fafc';
    if (style === 'solid-light' || style === 'line-grid' || style === 'dot-grid' || style === 'isometric-grid') return '#18181e';
    return isLightTheme ? '#18181e' : '#f8fafc';
  }

  function adaptCanvasElementsToBackground(style: SketchBackgroundStyle) {
    const ink = adaptiveInkForBackground(style);
    currentColor = ink;
    customColor = ink;
    strokes = strokes.map((stroke) => stroke.isEraser ? stroke : { ...stroke, color: ink });
    sketchTexts = sketchTexts.map((text) => ({ ...text, color: ink }));
    arrows = arrows.map((arrow) => ({ ...arrow, color: ink }));
    sketchShapes = sketchShapes.map((shape) => ({
      ...shape,
      color: ink,
      fillColor:
        shape.fillColor === 'tint' || shape.fillColor.endsWith('22')
          ? 'tint'
          : shape.fillColor
    }));
  }

  function setBackgroundStyle(style: SketchBackgroundStyle) {
    backgroundStyle = style;
    adaptCanvasElementsToBackground(style);
    persistCanvasSnapshot();
    drawGrid();
    redraw();
  }

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

  let quotaWarned = false;
  function persistStateString(stateStr: string, projectId: string | null | undefined = resolveStorageProjectId()) {
    if (typeof localStorage === 'undefined') return;
    const resolvedProjectId = resolveStorageProjectId(projectId);
    if (!resolvedProjectId) return;
    try {
      localStorage.setItem(getSketchStorageKey(resolvedProjectId), stateStr);
      quotaWarned = false;
    } catch (err) {
      // Most likely the browser storage quota was exceeded (large images).
      // Keep the in-memory canvas intact; just warn once and skip persisting.
      console.error('Failed to persist sketch (storage quota?):', err);
      if (!quotaWarned) {
        quotaWarned = true;
        showToast('Canvas too large to auto-save locally — export to keep it', 'warning');
      }
    }
  }

  function persistCanvasSnapshot(projectId: string | null | undefined = resolveStorageProjectId()) {
    persistStateString(JSON.stringify(createPersistedState()), projectId);
  }

  function createPersistedState(): PersistedSketchState {
    return {
      version: '4',
      backgroundStyle,
      backgroundOpacity,
      gridSpacing,
      snapToGrid,
      zoomScale,
      panOffset: { ...panOffset },
      strokes: $state.snapshot(strokes),
      texts: $state.snapshot(sketchTexts),
      arrows: $state.snapshot(arrows),
      shapes: $state.snapshot(sketchShapes),
      images: $state.snapshot(sketchImages)
    };
  }

  function resetCanvasDocument() {
    strokes = [];
    sketchTexts = [];
    arrows = [];
    sketchShapes = [];
    sketchImages = [];
    imageElements.clear();
    undoStack = [];
    redoStack = [];
    selectedShapeId = null;
    selectedImageId = null;
    activeTextInput = null;
    activeShapeTextInput = null;
    selectedTextId = null;
    backgroundStyle = 'transparent';
    backgroundOpacity = 1;
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

  // Stable fallback seed for elements saved before hand-drawn styling existed.
  function seedFromId(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h) || 1;
  }

  function arrowRoughOptions(arrow: SketchArrow): RoughOptions {
    const sw = arrow.strokeWidth ?? 2.5;
    return {
      stroke: arrow.color,
      strokeWidth: sw,
      roughness: arrow.roughness ?? 0,
      seed: arrow.seed ?? seedFromId(arrow.id),
      fill: null,
      lineDash: strokeStyleDash(arrow.strokeStyle ?? 'solid', sw)
    };
  }

  function drawArrow(targetCtx: CanvasRenderingContext2D, arrow: SketchArrow) {
    const start = getArrowStart(arrow);
    const end = getArrowEnd(arrow);
    if (!start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 6) return;

    targetCtx.save();
    targetCtx.globalAlpha = arrow.opacity;

    // Pull the endpoint back so the head doesn't overlap a connected object.
    const shorten = arrow.toTextId || arrow.toShapeId ? 30 : 4;
    const endX = end.x - (dx / dist) * shorten;
    const endY = end.y - (dy / dist) * shorten;

    const withHead = (arrow.arrowType ?? 'arrow') === 'arrow';
    roughArrow(targetCtx, start.x, start.y, endX, endY, withHead, arrowRoughOptions(arrow));
    targetCtx.restore();
  }

  // --- Hand-drawn shape rendering (canvas) ----------------------------------
  function resolveShapeFillColor(shape: SketchShape): string | null {
    const fc = shape.fillColor;
    if (!fc || fc === 'transparent') return null;
    if (fc === 'glass') return isLightTheme ? 'rgba(255, 255, 255, 0.42)' : 'rgba(28, 28, 38, 0.45)';
    if (fc === 'tint' || fc.endsWith('22')) return shape.color + '33';
    return fc;
  }

  function shapeRoughOptions(shape: SketchShape): RoughOptions {
    const sw = shape.strokeWidth ?? 2;
    const noStroke = shape.borderStyle === 'none';
    return {
      stroke: noStroke ? 'rgba(0,0,0,0)' : shape.color,
      strokeWidth: sw,
      roughness: shape.roughness ?? 0,
      seed: shape.seed ?? seedFromId(shape.id),
      fill: resolveShapeFillColor(shape),
      fillStyle: shape.fillStyle ?? 'solid',
      lineDash: strokeStyleDash(shape.borderStyle, sw),
      hachureGap: Math.max(5, sw * 3.5)
    };
  }

  // targetCtx must already be in WORLD space (zoom/pan transform applied).
  function drawSketchShape(targetCtx: CanvasRenderingContext2D, shape: SketchShape) {
    targetCtx.save();
    targetCtx.globalAlpha = shape.opacity;
    if (shape.rotation) {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      targetCtx.translate(cx, cy);
      targetCtx.rotate(shape.rotation);
      targetCtx.translate(-cx, -cy);
    }
    const o = shapeRoughOptions(shape);
    if (shape.type === 'rectangle') {
      const r = shape.edges === 'sharp' ? 0 : shape.borderRadius ?? 8;
      roughRect(targetCtx, shape.x, shape.y, shape.width, shape.height, r, o);
    } else if (shape.type === 'diamond') {
      roughDiamond(targetCtx, shape.x, shape.y, shape.width, shape.height, o);
    } else {
      // 'circle' (legacy) and 'ellipse' both fill the bounding box as an ellipse
      roughEllipse(targetCtx, shape.x, shape.y, shape.width, shape.height, o);
    }
    targetCtx.restore();
  }

  // Paint an image in WORLD space (zoom/pan transform already applied).
  // Used for PNG export/save; live display uses DOM <img> elements.
  function paintImage(targetCtx: CanvasRenderingContext2D, image: SketchImage) {
    const el = imageElements.get(image.id);
    if (!el || !el.complete || el.naturalWidth === 0) return;
    targetCtx.save();
    targetCtx.globalAlpha = image.opacity;
    if (image.rotation) {
      const cx = image.x + image.width / 2;
      const cy = image.y + image.height / 2;
      targetCtx.translate(cx, cy);
      targetCtx.rotate(image.rotation);
      targetCtx.translate(-cx, -cy);
    }
    targetCtx.drawImage(el, image.x, image.y, image.width, image.height);
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

    // Draw hand-drawn shapes (canvas owns the visuals; divs are interaction frames)
    sketchShapes.forEach(shape => {
      drawSketchShape(activeCtx, shape);
    });
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
        activeCtx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
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
      backgroundOpacity = stateObj.backgroundOpacity ?? 1;
      gridSpacing = stateObj.gridSpacing ?? 24;
      snapToGrid = stateObj.snapToGrid ?? false;
      zoomScale = stateObj.zoomScale ?? 1.0;
      panOffset = stateObj.panOffset ?? { x: 0, y: 0 };
      strokes = stateObj.strokes ?? [];
      sketchTexts = stateObj.texts ?? stateObj.sketchTexts ?? [];
      arrows = stateObj.arrows ?? [];
      sketchShapes = stateObj.shapes ?? stateObj.sketchShapes ?? [];
      sketchImages = stateObj.images ?? stateObj.sketchImages ?? [];
      syncImageElements();
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
        sketchShapes: $state.snapshot(sketchShapes),
        sketchImages: $state.snapshot(sketchImages)
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
        if (data.backgroundOpacity !== undefined) backgroundOpacity = data.backgroundOpacity;
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
        if (Array.isArray(data.sketchImages)) {
          sketchImages = data.sketchImages;
        } else if (Array.isArray(data.images)) {
          sketchImages = data.images;
        } else {
          sketchImages = [];
        }
        syncImageElements();

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

  // Handle outside click to close custom dropdowns (settings and font)
  $effect(() => {
    if (!showSettingsDropdown && !showFontDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showSettingsDropdown) {
        const wrapper = document.querySelector('.custom-settings-dropdown-wrapper');
        if (wrapper && !wrapper.contains(target)) {
          showSettingsDropdown = false;
        }
      }
      if (showFontDropdown) {
        const wrapper = document.querySelector('.font-dropdown-wrapper');
        if (wrapper && !wrapper.contains(target)) {
          showFontDropdown = false;
        }
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  });

  // Reset font dropdown when selectedTextId changes
  $effect(() => {
    const _id = selectedTextId;
    showFontDropdown = false;
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
        opacity: brushOpacity,
        fontFamily: currentTextFontFamily,
        fontWeight: currentTextWeight,
        fontStyle: currentTextStyle,
        textAlign: currentTextAlign
      };
      sketchTexts = [...sketchTexts, newText];
      selectedTextId = newText.id;
      saveState(projectId);
    }
    activeTextInput = null;
  }

  // Pointer down (start drawing, typing, or panning)
  function handlePointerDown(e: PointerEvent) {
    // Deselect shape if clicking background
    const target = e.target as HTMLElement;
    if (
      !target.closest('.floating-shape') &&
      !target.closest('.floating-text') &&
      !target.closest('.floating-image') &&
      !target.closest('.shape-context-menu') &&
      !target.closest('.text-context-menu') &&
      !target.closest('.image-context-menu')
    ) {
      selectedShapeId = null;
      selectedTextId = null;
      selectedImageId = null;
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

    if (isShapeTool(currentTool)) {
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

    if (isLinearTool(currentTool)) {
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
            type: currentTool as SketchShapeType,
            x,
            y,
            width,
            height,
            color: currentColor,
            fillColor: currentFillColor,
            borderStyle: currentStrokeStyle,
            borderRadius: currentEdges === 'sharp' ? 0 : currentBorderRadius,
            opacity: brushOpacity,
            text: '',
            seed: makeSeed(),
            roughness: currentRoughness,
            fillStyle: currentFillStyle,
            edges: currentEdges,
            strokeWidth: shapeStrokeWidth(brushSize)
          };
          
          sketchShapes = [...sketchShapes, newShape];
          saveState();
          
          // Switch to select tool so the shape can be modified/positioned
          currentTool = 'select';
          selectedShapeId = newShape.id;
          selectedTextId = null;
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
        opacity: brushOpacity,
        arrowType: currentTool === 'line' ? 'line' : 'arrow',
        seed: makeSeed(),
        roughness: currentRoughness,
        strokeWidth: Math.max(2, shapeStrokeWidth(brushSize)),
        strokeStyle: currentStrokeStyle
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
    if (isShapeTool(currentTool)) return; // Let shape tools draw over existing text.

    if (currentTool === 'eraser') {
      sketchTexts = sketchTexts.filter(t => t.id !== text.id);
      arrows = arrows.filter(a => a.fromTextId !== text.id && a.toTextId !== text.id);
      if (selectedTextId === text.id) selectedTextId = null;
      saveState();
      redraw();
      return;
    }

    if (isLinearTool(currentTool)) {
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
    selectedTextId = text.id;
    selectedShapeId = null;
    if (multiSelectedIds.includes(text.id)) {
      beginGroupDrag(e);
      return;
    }

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
    if (isShapeTool(currentTool)) return; // Let shape tools draw over existing shapes.

    if (currentTool === 'eraser') {
      sketchShapes = sketchShapes.filter(s => s.id !== shape.id);
      arrows = arrows.filter(a => a.fromShapeId !== shape.id && a.toShapeId !== shape.id);
      saveState();
      redraw();
      return;
    }

    if (isLinearTool(currentTool)) {
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
    selectedTextId = null;
    if (multiSelectedIds.includes(shape.id)) {
      beginGroupDrag(e);
      return;
    }

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

  // Resize shape elements (any corner; rotation-aware)
  function startResizeShape(e: PointerEvent, shape: SketchShape, handle: ResizeHandle = 'se') {
    e.stopPropagation();
    e.preventDefault();
    resizingShapeId = shape.id;
    resizeHandle = handle;
    resizeShapeStart = { x: e.clientX, y: e.clientY };
    shapeStartDims = { width: shape.width, height: shape.height };
    shapeStartOrigin = { x: shape.x, y: shape.y };

    window.addEventListener('pointermove', handleShapeResizeMove);
    window.addEventListener('pointerup', handleShapeResizeUp);
  }

  function handleShapeResizeMove(e: PointerEvent) {
    if (!resizingShapeId || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;

    const dxWorld = ((e.clientX - resizeShapeStart.x) / cssZoom) / zoomScale;
    const dyWorld = ((e.clientY - resizeShapeStart.y) / cssZoom) / zoomScale;

    const shape = sketchShapes.find((s) => s.id === resizingShapeId);
    const rot = shape?.rotation ?? 0;
    const local = toLocalDelta(dxWorld, dyWorld, rot);
    let next = computeResize(shapeStartOrigin, shapeStartDims, resizeHandle, local.dx, local.dy, rot, 15, false);

    if (snapToGrid && !rot) {
      next = {
        ...next,
        width: Math.max(15, Math.round(next.width / gridSpacing) * gridSpacing),
        height: Math.max(15, Math.round(next.height / gridSpacing) * gridSpacing)
      };
    }

    sketchShapes = sketchShapes.map((s) => (s.id === resizingShapeId ? { ...s, ...next } : s));
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
        if (property === 'fillColor') {
          const fillColor = typeof value === 'string' ? value : 'transparent';
          val = fillColor.endsWith('22') ? s.color + '22' : fillColor;
          return {
            ...s,
            fillColor: val,
            fillStyle: val === 'transparent' ? s.fillStyle : 'solid'
          };
        }
        if (property === 'fillStyle') {
          return {
            ...s,
            fillStyle: value as FillStyle,
            fillColor: s.fillColor === 'transparent' ? 'tint' : s.fillColor
          };
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
        // Tint follows the stroke colour; an independent solid fill stays put.
        if (fillColor !== 'transparent' && fillColor !== 'glass' && fillColor.endsWith('22')) {
          fillColor = color + '22';
        }
        return { ...s, color, fillColor };
      }
      return s;
    });
    saveState();
    redraw();
  }

  // Set an independent, freely-chosen solid fill colour for a shape.
  function setShapeFillCustom(id: string, hex: string) {
    currentFillColor = hex;
    currentFillStyle = 'solid';
    updateShapeProperty(id, 'fillColor', hex);
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

  // --- Resize handle geometry (shared by shapes + images) -------------------
  const RESIZE_HANDLES: Array<{ h: ResizeHandle; pos: string; cursor: string }> = [
    { h: 'nw', pos: 'left:-5px; top:-5px;', cursor: 'nwse-resize' },
    { h: 'ne', pos: 'right:-5px; top:-5px;', cursor: 'nesw-resize' },
    { h: 'sw', pos: 'left:-5px; bottom:-5px;', cursor: 'nesw-resize' },
    { h: 'se', pos: 'right:-5px; bottom:-5px;', cursor: 'nwse-resize' }
  ];

  // Compute a new {x,y,width,height} from a corner-handle drag.
  // dxL/dyL are the pointer delta already expressed in the element's local
  // (un-rotated) frame. Unrotated elements anchor on the opposite corner;
  // rotated elements resize symmetrically about their centre (keeps it stable).
  function computeResize(
    origin: { x: number; y: number },
    dims: { width: number; height: number },
    handle: ResizeHandle,
    dxL: number,
    dyL: number,
    rot: number,
    min: number,
    lockAspect: boolean
  ) {
    const w = dims.width;
    const h = dims.height;
    let nw = handle === 'se' || handle === 'ne' ? w + dxL : w - dxL;
    let nh = handle === 'se' || handle === 'sw' ? h + dyL : h - dyL;
    if (lockAspect && w > 0 && h > 0) {
      const ratio = w / h;
      if (Math.abs(nw) / ratio >= Math.abs(nh)) nh = nw / ratio;
      else nw = nh * ratio;
    }
    nw = Math.max(min, nw);
    nh = Math.max(min, nh);
    if (rot) {
      const cx = origin.x + w / 2;
      const cy = origin.y + h / 2;
      return { x: cx - nw / 2, y: cy - nh / 2, width: nw, height: nh };
    }
    const anchorX = handle === 'nw' || handle === 'sw' ? origin.x + w : origin.x;
    const anchorY = handle === 'nw' || handle === 'ne' ? origin.y + h : origin.y;
    const nx = handle === 'nw' || handle === 'sw' ? anchorX - nw : anchorX;
    const ny = handle === 'nw' || handle === 'ne' ? anchorY - nh : anchorY;
    return { x: nx, y: ny, width: nw, height: nh };
  }

  // Express a world-space pointer delta in an element's local frame.
  function toLocalDelta(dxWorld: number, dyWorld: number, rot: number) {
    if (!rot) return { dx: dxWorld, dy: dyWorld };
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    return { dx: dxWorld * cos - dyWorld * sin, dy: dxWorld * sin + dyWorld * cos };
  }

  // --- Rotation (shapes + images) -------------------------------------------
  function startRotate(
    e: PointerEvent,
    kind: 'shape' | 'image',
    el: { id: string; x: number; y: number; width: number; height: number; rotation?: number }
  ) {
    e.stopPropagation();
    e.preventDefault();
    rotatingId = el.id;
    rotatingKind = kind;
    rotateCenter = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const p = screenToWorld(e.clientX, e.clientY);
    rotateStartAngle = Math.atan2(p.y - rotateCenter.y, p.x - rotateCenter.x);
    rotateStartRotation = el.rotation ?? 0;
    window.addEventListener('pointermove', handleRotateMove);
    window.addEventListener('pointerup', handleRotateUp);
  }

  function handleRotateMove(e: PointerEvent) {
    if (!rotatingId) return;
    const p = screenToWorld(e.clientX, e.clientY);
    let next =
      rotateStartRotation +
      (Math.atan2(p.y - rotateCenter.y, p.x - rotateCenter.x) - rotateStartAngle);
    if (e.shiftKey) {
      const step = Math.PI / 12; // 15° increments
      next = Math.round(next / step) * step;
    }
    if (rotatingKind === 'shape') {
      sketchShapes = sketchShapes.map((s) => (s.id === rotatingId ? { ...s, rotation: next } : s));
    } else {
      sketchImages = sketchImages.map((im) => (im.id === rotatingId ? { ...im, rotation: next } : im));
    }
    redraw();
  }

  function handleRotateUp() {
    if (rotatingId) {
      rotatingId = null;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleRotateMove);
    window.removeEventListener('pointerup', handleRotateUp);
  }

  // --- Images ---------------------------------------------------------------
  // Keep the decoded-element cache in sync with the image list (for export).
  function syncImageElements() {
    for (const id of [...imageElements.keys()]) {
      if (!sketchImages.some((img) => img.id === id)) imageElements.delete(id);
    }
    sketchImages.forEach((img) => {
      if (imageElements.has(img.id)) return;
      const el = new Image();
      el.onload = () => redraw();
      el.src = img.src;
      imageElements.set(img.id, el);
    });
  }

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function decodeImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
  }

  // Downscale oversized images so persisted data URLs stay reasonable.
  function normalizeImage(img: HTMLImageElement, mime: string, originalSrc: string) {
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    const longest = Math.max(natW, natH);
    if (longest <= MAX_IMAGE_DIM || longest === 0) {
      return { src: originalSrc, width: natW, height: natH };
    }
    const scale = MAX_IMAGE_DIM / longest;
    const w = Math.round(natW * scale);
    const h = Math.round(natH * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    if (!cx) return { src: originalSrc, width: natW, height: natH };
    cx.drawImage(img, 0, 0, w, h);
    const outMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const src = c.toDataURL(outMime, outMime === 'image/jpeg' ? 0.85 : undefined);
    return { src, width: w, height: h };
  }

  // Place a new image centred in the viewport (or at a drop point), scaled to fit.
  function placeImageWorld(naturalWidth: number, naturalHeight: number, dropWorld?: Point) {
    const maxW = Math.min(viewportWidth * 0.6, 520) / zoomScale;
    const maxH = Math.min(viewportHeight * 0.6, 520) / zoomScale;
    let w = naturalWidth || 320;
    let h = naturalHeight || 240;
    const ratio = Math.min(maxW / w, maxH / h, 1);
    w = Math.max(24, w * ratio);
    h = Math.max(24, h * ratio);
    const cx = dropWorld ? dropWorld.x : (viewportWidth / 2 - panOffset.x) / zoomScale;
    const cy = dropWorld ? dropWorld.y : (viewportHeight / 2 - panOffset.y) / zoomScale;
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  }

  function addImageElement(src: string, naturalWidth: number, naturalHeight: number, dropWorld?: Point) {
    const placed = placeImageWorld(naturalWidth, naturalHeight, dropWorld);
    const newImage: SketchImage = {
      id: Math.random().toString(36).substring(2, 9),
      ...placed,
      src,
      opacity: 1,
      rotation: 0,
      naturalWidth,
      naturalHeight
    };
    sketchImages = [...sketchImages, newImage];
    const el = new Image();
    el.onload = () => redraw();
    el.src = src;
    imageElements.set(newImage.id, el);
    currentTool = 'select';
    selectedImageId = newImage.id;
    selectedShapeId = null;
    selectedTextId = null;
    saveState();
    redraw();
  }

  async function ingestImageBlob(blob: Blob, dropWorld?: Point) {
    const dataUrl = await blobToDataUrl(blob);
    const img = await decodeImage(dataUrl);
    const normalized = normalizeImage(img, blob.type, dataUrl);
    addImageElement(normalized.src, normalized.width, normalized.height, dropWorld);
  }

  function triggerImagePicker() {
    commitText();
    imageFileInputEl?.click();
  }

  async function handleImageFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    for (const file of Array.from(input.files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        await ingestImageBlob(file);
      } catch (err) {
        console.error('Failed to load image:', err);
        showToast('Failed to load image', 'error');
      }
    }
    input.value = '';
  }

  async function handlePaste(e: ClipboardEvent) {
    const isTyping =
      document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';
    if (isTyping) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          try {
            await ingestImageBlob(blob);
          } catch (err) {
            console.error('Failed to paste image:', err);
          }
        }
      }
    }
  }

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some((i) => i.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  async function handleDrop(e: DragEvent) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    if (!Array.from(files).some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    const dropWorld = screenToWorld(e.clientX, e.clientY);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        await ingestImageBlob(file, dropWorld);
      } catch (err) {
        console.error('Failed to drop image:', err);
      }
    }
  }

  function startDragImage(e: PointerEvent, image: SketchImage) {
    if (currentTool === 'pen' || isShapeTool(currentTool) || isLinearTool(currentTool)) return;
    if (currentTool === 'eraser') {
      deleteImage(image.id);
      return;
    }
    const target = e.target as HTMLElement;
    if (target?.classList.contains('resize-handle') || target?.classList.contains('rotate-handle')) {
      return; // handled by dedicated handlers
    }
    e.stopPropagation();
    commitText();
    selectedImageId = image.id;
    selectedShapeId = null;
    selectedTextId = null;
    draggingImageId = image.id;
    dragImageStart = { x: e.clientX, y: e.clientY };
    imageStartCoords = { x: image.x, y: image.y };
    window.addEventListener('pointermove', handleImageDragMove);
    window.addEventListener('pointerup', handleImageDragUp);
  }

  function handleImageDragMove(e: PointerEvent) {
    if (!draggingImageId || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    const deltaX = (e.clientX - dragImageStart.x) / cssZoom / zoomScale;
    const deltaY = (e.clientY - dragImageStart.y) / cssZoom / zoomScale;
    sketchImages = sketchImages.map((im) => {
      if (im.id !== draggingImageId) return im;
      let targetX = imageStartCoords.x + deltaX;
      let targetY = imageStartCoords.y + deltaY;
      if (snapToGrid) {
        targetX = Math.round(targetX / gridSpacing) * gridSpacing;
        targetY = Math.round(targetY / gridSpacing) * gridSpacing;
      }
      return { ...im, x: targetX, y: targetY };
    });
    redraw();
  }

  function handleImageDragUp() {
    if (draggingImageId) {
      draggingImageId = null;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleImageDragMove);
    window.removeEventListener('pointerup', handleImageDragUp);
  }

  function startResizeImage(e: PointerEvent, image: SketchImage, handle: ResizeHandle) {
    e.stopPropagation();
    e.preventDefault();
    resizingImageId = image.id;
    imageResizeHandle = handle;
    resizeImageStart = { x: e.clientX, y: e.clientY };
    imageStartDims = { width: image.width, height: image.height };
    imageStartOrigin = { x: image.x, y: image.y };
    window.addEventListener('pointermove', handleImageResizeMove);
    window.addEventListener('pointerup', handleImageResizeUp);
  }

  function handleImageResizeMove(e: PointerEvent) {
    if (!resizingImageId || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    const dxWorld = (e.clientX - resizeImageStart.x) / cssZoom / zoomScale;
    const dyWorld = (e.clientY - resizeImageStart.y) / cssZoom / zoomScale;
    const image = sketchImages.find((im) => im.id === resizingImageId);
    const rot = image?.rotation ?? 0;
    const local = toLocalDelta(dxWorld, dyWorld, rot);
    // Aspect lock by default; hold Shift to free-resize.
    const next = computeResize(imageStartOrigin, imageStartDims, imageResizeHandle, local.dx, local.dy, rot, 24, !e.shiftKey);
    sketchImages = sketchImages.map((im) => (im.id === resizingImageId ? { ...im, ...next } : im));
    redraw();
  }

  function handleImageResizeUp() {
    if (resizingImageId) {
      resizingImageId = null;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleImageResizeMove);
    window.removeEventListener('pointerup', handleImageResizeUp);
  }

  function moveImageLayer(id: string, direction: 'front' | 'back') {
    const image = sketchImages.find((im) => im.id === id);
    if (!image) return;
    const remaining = sketchImages.filter((im) => im.id !== id);
    sketchImages = direction === 'front' ? [...remaining, image] : [image, ...remaining];
    saveState();
    redraw();
  }

  function updateImageProperty(id: string, property: keyof SketchImage, value: any) {
    sketchImages = sketchImages.map((im) => (im.id === id ? { ...im, [property]: value } : im));
    saveState();
    redraw();
  }

  function deleteImage(id: string) {
    sketchImages = sketchImages.filter((im) => im.id !== id);
    imageElements.delete(id);
    if (selectedImageId === id) selectedImageId = null;
    saveState();
    redraw();
  }

  function updateTextProperty(id: string, property: keyof SketchText, value: any) {
    sketchTexts = sketchTexts.map(t => t.id === id ? { ...t, [property]: value } : t);
    saveState();
    redraw();
  }

  function updateTextColor(id: string, color: string) {
    currentColor = color;
    updateTextProperty(id, 'color', color);
  }

  function moveTextLayer(id: string, direction: 'front' | 'back') {
    const text = sketchTexts.find(t => t.id === id);
    if (!text) return;
    const remaining = sketchTexts.filter(t => t.id !== id);
    sketchTexts = direction === 'front' ? [...remaining, text] : [text, ...remaining];
    saveState();
    redraw();
  }

  function deleteText(id: string) {
    sketchTexts = sketchTexts.filter(t => t.id !== id);
    arrows = arrows.filter(a => a.fromTextId !== id && a.toTextId !== id);
    if (selectedTextId === id) selectedTextId = null;
    saveState();
    redraw();
  }

  function setPanelColor(color: string) {
    currentColor = color;
    customColor = color;
    if (selectedTextId) {
      updateTextColor(selectedTextId, color);
    } else if (selectedShapeId) {
      updateShapeColor(selectedShapeId, color);
    }
    if (currentTool === 'eraser') currentTool = 'pen';
  }

  function setPanelFontFamily(fontFamily: string) {
    currentTextFontFamily = fontFamily;
    if (selectedTextId) updateTextProperty(selectedTextId, 'fontFamily', fontFamily);
  }

  function setPanelFontSize(fontSize: number) {
    brushSize = Math.max(2, Math.round(fontSize / 2.5));
    if (selectedTextId) updateTextProperty(selectedTextId, 'fontSize', fontSize);
  }

  function setPanelTextAlign(textAlign: TextAlign) {
    currentTextAlign = textAlign;
    if (selectedTextId) updateTextProperty(selectedTextId, 'textAlign', textAlign);
  }

  function setPanelOpacity(opacity: number) {
    const bounded = Math.max(0.1, Math.min(1, opacity));
    brushOpacity = bounded;
    if (selectedTextId) {
      updateTextProperty(selectedTextId, 'opacity', bounded);
    } else if (selectedShapeId) {
      updateShapeProperty(selectedShapeId, 'opacity', bounded);
    } else if (selectedImageId) {
      updateImageProperty(selectedImageId, 'opacity', bounded);
    }
  }

  function setPanelFillColor(fillColor: string) {
    currentFillColor = fillColor;
    if (fillColor !== 'transparent') currentFillStyle = 'solid';
    if (selectedShapeId) updateShapeProperty(selectedShapeId, 'fillColor', fillColor);
  }

  function setPanelFillStyle(fillStyle: FillStyle) {
    currentFillStyle = fillStyle;
    if (currentFillColor === 'transparent') currentFillColor = 'tint';
    if (selectedShapeId) updateShapeProperty(selectedShapeId, 'fillStyle', fillStyle);
  }

  // --- Shape edges (sharp vs rounded corners) -------------------------------
  function setShapeEdges(id: string, edges: EdgeStyle) {
    sketchShapes = sketchShapes.map((s) => {
      if (s.id !== id) return s;
      // Round with no radius yet → give it a sensible default.
      const borderRadius = edges === 'round' && (!s.borderRadius || s.borderRadius < 1) ? 8 : s.borderRadius;
      return { ...s, edges, borderRadius };
    });
    saveState();
    redraw();
  }

  function setShapeBorderRadius(id: string, radius: number) {
    const r = Math.max(0, Math.round(radius));
    sketchShapes = sketchShapes.map((s) =>
      s.id === id ? { ...s, borderRadius: r, edges: r === 0 ? 'sharp' : 'round' } : s
    );
    saveState();
    redraw();
  }

  function setPanelEdges(edges: EdgeStyle) {
    currentEdges = edges;
    if (edges === 'round' && currentBorderRadius < 1) currentBorderRadius = 8;
    if (selectedShapeId) setShapeEdges(selectedShapeId, edges);
  }

  function setPanelBorderRadius(radius: number) {
    currentBorderRadius = Math.max(0, Math.round(radius));
    currentEdges = currentBorderRadius === 0 ? 'sharp' : 'round';
    if (selectedShapeId) setShapeBorderRadius(selectedShapeId, currentBorderRadius);
  }

  function moveSelectedLayer(direction: 'front' | 'back') {
    if (selectedTextId) {
      moveTextLayer(selectedTextId, direction);
    } else if (selectedShapeId) {
      moveShapeLayer(selectedShapeId, direction);
    }
  }

  // Edit existing text boxes
  function editExistingText(text: SketchText) {
    commitText();
    activeTextInput = { x: text.x, y: text.y, value: text.value };
    currentColor = text.color;
    brushSize = Math.round(text.fontSize / 2.5);
    brushOpacity = text.opacity;
    currentTextFontFamily = text.fontFamily ?? currentTextFontFamily;
    currentTextWeight = text.fontWeight ?? '600';
    currentTextStyle = text.fontStyle ?? 'normal';
    currentTextAlign = text.textAlign ?? 'left';
    selectedTextId = text.id;
    selectedShapeId = null;
    sketchTexts = sketchTexts.filter(t => t.id !== text.id);
  }

  // Zoom around a specific screen point (unscaled viewport coords).
  function applyZoomAtPoint(nextZoom: number, screenX: number, screenY: number) {
    nextZoom = Math.min(5.0, Math.max(0.1, nextZoom));
    const beforeX = (screenX - panOffset.x) / zoomScale;
    const beforeY = (screenY - panOffset.y) / zoomScale;
    panOffset = { x: screenX - beforeX * nextZoom, y: screenY - beforeY * nextZoom };
    zoomScale = nextZoom;
    drawGrid();
    redraw();
  }

  // Step zoom by a clean 10% increment, snapping so it always lands on round
  // values — so it returns to exactly 100%. Centred on the viewport.
  function zoomByStep(direction: number) {
    if (!viewportEl) return;
    const centerX = viewportEl.clientWidth / 2;
    const centerY = viewportEl.clientHeight / 2;
    const currentPct = Math.round(zoomScale * 100);
    const onStep = currentPct % 10 === 0;
    let nextPct: number;
    if (onStep) {
      nextPct = currentPct + direction * 10;
    } else {
      // Snap to the next 10% boundary in the direction of travel.
      nextPct = direction > 0 ? Math.ceil(currentPct / 10) * 10 : Math.floor(currentPct / 10) * 10;
    }
    nextPct = Math.min(500, Math.max(10, nextPct));
    applyZoomAtPoint(nextPct / 100, centerX, centerY);
  }

  // Back-compat wrapper for keyboard shortcuts — routes through stepped zoom.
  function zoomCentered(factor: number) {
    zoomByStep(factor >= 1 ? 1 : -1);
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
      // Touchpad pinch gesture or Ctrl + mouse wheel — smooth zoom at cursor.
      const zoomFactor = 1 - e.deltaY * 0.01;
      applyZoomAtPoint(zoomScale * zoomFactor, mouseX, mouseY);
    } else {
      // Two-finger scroll panning
      panOffset = {
        x: panOffset.x - e.deltaX / cssZoom,
        y: panOffset.y - e.deltaY / cssZoom
      };
      drawGrid();
      redraw();
    }
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
    
    // Draw imported images (world space, behind strokes/shapes/text)
    tempCtx.setTransform(zoomScale, 0, 0, zoomScale, panOffset.x, panOffset.y);
    sketchImages.forEach(image => {
      paintImage(tempCtx, image);
    });
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.globalAlpha = 1.0;

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
      tempCtx.font = `${text.fontStyle ?? 'normal'} ${text.fontWeight ?? '600'} ${displayFontSize}px ${text.fontFamily ?? sketchFontStack}`;
      tempCtx.textAlign = text.textAlign ?? 'left';
      tempCtx.textBaseline = 'top';
      
      const screenX = text.x * zoomScale + panOffset.x;
      const screenY = text.y * zoomScale + panOffset.y;
      
      const lines = text.value.split('\n');
      const lineHeight = displayFontSize * 1.25;
      lines.forEach((line, index) => {
        tempCtx.fillText(line, screenX, screenY + index * lineHeight);
      });
    });

    // Draw hand-drawn shape bodies in world space (matches the live canvas)
    tempCtx.setTransform(zoomScale, 0, 0, zoomScale, panOffset.x, panOffset.y);
    sketchShapes.forEach(shape => {
      drawSketchShape(tempCtx, shape);
    });
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.globalAlpha = 1.0;

    // Draw shape labels (screen space)
    sketchShapes.forEach(shape => {
      if (!shape.text) return;
      const x = shape.x * zoomScale + panOffset.x;
      const y = shape.y * zoomScale + panOffset.y;
      const w = shape.width * zoomScale;
      const h = shape.height * zoomScale;
      tempCtx.save();
      tempCtx.globalAlpha = shape.opacity;
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

  // --- Tool shortcuts & multi-selection -------------------------------------
  const TOOL_KEYS: Record<string, SketchTool> = {
    v: 'select', '1': 'select',
    p: 'pen', '2': 'pen',
    e: 'eraser', '3': 'eraser',
    r: 'rectangle', '4': 'rectangle',
    o: 'circle', '5': 'circle',
    d: 'diamond', '6': 'diamond',
    l: 'line', '7': 'line',
    a: 'arrow', t: 'text', '8': 'text',
    h: 'pan'
  };
  function selectToolByKey(key: string): boolean {
    const tool = TOOL_KEYS[key.toLowerCase()];
    if (!tool) return false;
    commitText();
    currentTool = tool;
    if (tool !== 'select') clearSelection();
    return true;
  }

  function clearSelection() {
    selectedShapeId = null;
    selectedTextId = null;
    selectedImageId = null;
    multiSelectedIds = [];
  }

  function selectAll() {
    commitText();
    currentTool = 'select';
    selectedShapeId = null;
    selectedImageId = null;
    multiSelectedIds = [
      ...sketchShapes.map((s) => s.id),
      ...sketchTexts.map((t) => t.id),
      ...sketchImages.map((im) => im.id)
    ];
    redraw();
  }

  function deleteSelection() {
    const ids = new Set<string>(multiSelectedIds);
    if (selectedShapeId) ids.add(selectedShapeId);
    if (selectedTextId) ids.add(selectedTextId);
    if (selectedImageId) ids.add(selectedImageId);
    if (ids.size === 0) return;
    sketchShapes = sketchShapes.filter((s) => !ids.has(s.id));
    sketchTexts = sketchTexts.filter((t) => !ids.has(t.id));
    sketchImages = sketchImages.filter((im) => {
      if (ids.has(im.id)) {
        imageElements.delete(im.id);
        return false;
      }
      return true;
    });
    arrows = arrows.filter(
      (a) =>
        !(a.fromShapeId && ids.has(a.fromShapeId)) &&
        !(a.toShapeId && ids.has(a.toShapeId)) &&
        !(a.fromTextId && ids.has(a.fromTextId)) &&
        !(a.toTextId && ids.has(a.toTextId))
    );
    clearSelection();
    saveState();
    redraw();
  }

  function rectsIntersect(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number
  ): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function updateMarqueeSelection() {
    if (!marqueeStart || !marqueeCurrent) return;
    const x = Math.min(marqueeStart.x, marqueeCurrent.x);
    const y = Math.min(marqueeStart.y, marqueeCurrent.y);
    const w = Math.abs(marqueeCurrent.x - marqueeStart.x);
    const h = Math.abs(marqueeCurrent.y - marqueeStart.y);
    const ids: string[] = [];
    sketchShapes.forEach((s) => {
      if (rectsIntersect(x, y, w, h, s.x, s.y, s.width, s.height)) ids.push(s.id);
    });
    sketchTexts.forEach((t) => {
      const b = getTextBounds(t);
      if (rectsIntersect(x, y, w, h, t.x, t.y, b.w, b.h)) ids.push(t.id);
    });
    sketchImages.forEach((im) => {
      if (rectsIntersect(x, y, w, h, im.x, im.y, im.width, im.height)) ids.push(im.id);
    });
    multiSelectedIds = ids;
  }

  // Group drag (move several selected elements together)
  function beginGroupDrag(e: PointerEvent) {
    e.stopPropagation();
    commitText();
    groupDragging = true;
    groupDragStart = { x: e.clientX, y: e.clientY };
    groupStartPositions = new Map();
    multiSelectedIds.forEach((id) => {
      const s = sketchShapes.find((x) => x.id === id);
      if (s) {
        groupStartPositions.set(id, { x: s.x, y: s.y });
        return;
      }
      const t = sketchTexts.find((x) => x.id === id);
      if (t) {
        groupStartPositions.set(id, { x: t.x, y: t.y });
        return;
      }
      const im = sketchImages.find((x) => x.id === id);
      if (im) groupStartPositions.set(id, { x: im.x, y: im.y });
    });
    window.addEventListener('pointermove', handleGroupDragMove);
    window.addEventListener('pointerup', handleGroupDragUp);
  }

  function handleGroupDragMove(e: PointerEvent) {
    if (!groupDragging || !viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const cssZoom = rect.width / viewportEl.clientWidth;
    const dx = ((e.clientX - groupDragStart.x) / cssZoom) / zoomScale;
    const dy = ((e.clientY - groupDragStart.y) / cssZoom) / zoomScale;
    sketchShapes = sketchShapes.map((s) => {
      const start = groupStartPositions.get(s.id);
      return start ? { ...s, x: start.x + dx, y: start.y + dy } : s;
    });
    sketchTexts = sketchTexts.map((t) => {
      const start = groupStartPositions.get(t.id);
      return start ? { ...t, x: start.x + dx, y: start.y + dy } : t;
    });
    sketchImages = sketchImages.map((im) => {
      const start = groupStartPositions.get(im.id);
      return start ? { ...im, x: start.x + dx, y: start.y + dy } : im;
    });
    redraw();
  }

  function handleGroupDragUp() {
    if (groupDragging) {
      groupDragging = false;
      saveState();
      redraw();
    }
    window.removeEventListener('pointermove', handleGroupDragMove);
    window.removeEventListener('pointerup', handleGroupDragUp);
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && (selectedShapeId || selectedTextId || selectedImageId || multiSelectedIds.length)) {
      e.preventDefault();
      deleteSelection();
    } else if (e.code === 'Space' && !isTyping) {
      spacePressed = true;
      if (currentTool !== 'pan') {
        e.preventDefault();
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !isTyping) {
      e.preventDefault();
      selectAll();
    } else if (!isTyping && !e.ctrlKey && !e.metaKey && !e.altKey && selectToolByKey(e.key)) {
      e.preventDefault();
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
      viewportEl.addEventListener('dragover', handleDragOver);
      viewportEl.addEventListener('drop', handleDrop);

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      window.addEventListener('paste', handlePaste);
    }
  });

  onDestroy(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    if (viewportEl) {
      viewportEl.removeEventListener('wheel', handleWheel);
      viewportEl.removeEventListener('dragover', handleDragOver);
      viewportEl.removeEventListener('drop', handleDrop);
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('paste', handlePaste);
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

  $effect(() => {
    const ink = defaultCanvasInk;
    if (ink === lastAppliedDefaultInk) return;
    if (currentColor === lastAppliedDefaultInk && customColor === lastAppliedDefaultInk) {
      currentColor = ink;
      customColor = ink;
    }
    lastAppliedDefaultInk = ink;
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
  style={overlayBackdropStyle}
  transition:fade={{ duration: 180 }}
>
  <div 
    bind:this={viewportEl}
    class="canvas-viewport"
    style="
      cursor: {spacePressed || currentTool === 'pan' ? (panning ? 'grabbing' : 'grab') : (currentTool === 'eraser' ? 'cell' : (currentTool === 'text' ? 'text' : (isShapeTool(currentTool) ? 'crosshair' : (currentTool === 'select' ? 'default' : 'crosshair'))))};
      {viewportBackdropStyle}
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

    <!-- Render imported images (behind strokes/shapes/text) -->
    {#each sketchImages as image (image.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="floating-image"
        class:active-selected={(selectedImageId === image.id || multiSelectedIds.includes(image.id)) && currentTool === 'select'}
        data-image-id={image.id}
        style="
          position: absolute;
          left: {image.x * zoomScale + panOffset.x}px;
          top: {image.y * zoomScale + panOffset.y}px;
          width: {image.width * zoomScale}px;
          height: {image.height * zoomScale}px;
          transform: rotate({image.rotation ?? 0}rad);
          transform-origin: 50% 50%;
          opacity: {image.opacity};
          cursor: {currentTool === 'eraser' ? 'pointer' : (currentTool === 'select' ? 'move' : 'default')};
        "
        onpointerdown={e => startDragImage(e, image)}
      >
        <img class="floating-image-el" src={image.src} alt="" draggable="false" />
        {#if selectedImageId === image.id && currentTool === 'select'}
          {#each RESIZE_HANDLES as hd}
            <div
              class="resize-handle"
              style="position: absolute; {hd.pos} cursor: {hd.cursor};"
              onpointerdown={e => startResizeImage(e, image, hd.h)}
            ></div>
          {/each}
          <div
            class="rotate-handle"
            onpointerdown={e => startRotate(e, 'image', image)}
            title="Rotate (hold Shift to snap)"
          ></div>
        {/if}
      </div>
    {/each}

    <!-- Render floating text blocks on top of local coordinate space -->
    {#each sketchTexts as text (text.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="floating-text"
        class:active-selected={selectedTextId === text.id && currentTool === 'select'}
        data-text-id={text.id}
        style="
          position: absolute;
          left: {text.x * zoomScale + panOffset.x}px;
          top: {text.y * zoomScale + panOffset.y}px;
          font-size: {text.fontSize * zoomScale}px;
          font-family: {text.fontFamily ?? sketchFontStack};
          font-weight: {text.fontWeight ?? '600'};
          font-style: {text.fontStyle ?? 'normal'};
          text-align: {text.textAlign ?? 'left'};
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
        class:active-selected={(selectedShapeId === shape.id || multiSelectedIds.includes(shape.id)) && currentTool === 'select'}
        class:glass-fill={shape.fillColor === 'glass'}
        data-shape-id={shape.id}
        style="
          position: absolute;
          left: {shape.x * zoomScale + panOffset.x}px;
          top: {shape.y * zoomScale + panOffset.y}px;
          width: {shape.width * zoomScale}px;
          height: {shape.height * zoomScale}px;
          transform: rotate({shape.rotation ?? 0}rad);
          transform-origin: 50% 50%;
          border-radius: {shape.type === 'circle' || shape.type === 'ellipse' ? '50%' : `${(shape.edges === 'sharp' ? 0 : shape.borderRadius) * zoomScale}px`};
          backdrop-filter: {shape.fillColor === 'glass' ? 'blur(8px)' : 'none'};
          -webkit-backdrop-filter: {shape.fillColor === 'glass' ? 'blur(8px)' : 'none'};
          cursor: {currentTool === 'eraser' ? 'pointer' : (currentTool === 'select' ? 'move' : 'default')};
        "
        onpointerdown={e => startDragShape(e, shape)}
      >
        <!-- Resize handles (4 corners) + rotate handle -->
        {#if selectedShapeId === shape.id && currentTool === 'select'}
          {#each RESIZE_HANDLES as hd}
            <div
              class="resize-handle"
              style="position: absolute; {hd.pos} cursor: {hd.cursor};"
              onpointerdown={e => startResizeShape(e, shape, hd.h)}
            ></div>
          {/each}
          <div
            class="rotate-handle"
            onpointerdown={e => startRotate(e, 'shape', shape)}
            title="Rotate (hold Shift to snap)"
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

    <!-- Floating text context toolbar -->
    {#if selectedTextId && currentTool === 'select' && !showSettingsDropdown}
      {#each sketchTexts.filter(t => t.id === selectedTextId) as activeText (activeText.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="text-context-menu bento-card"
          style={contextMenuStyle(activeText.x * zoomScale + panOffset.x, activeText.y * zoomScale + panOffset.y, 690)}
          transition:scale={{ start: 0.9, duration: 120 }}
          onpointerdown={e => e.stopPropagation()}
        >
          <div class="menu-section">
            <span class="section-lbl">Font</span>
            <div class="menu-dropdown-wrapper font-dropdown-wrapper">
              <button
                type="button"
                class="menu-dropdown-trigger"
                class:open={showFontDropdown}
                onclick={(e) => {
                  e.stopPropagation();
                  showFontDropdown = !showFontDropdown;
                }}
                title="Font family"
              >
                <span>
                  {textFontOptions.find(f => f.value === (activeText.fontFamily ?? currentTextFontFamily))?.label ?? 'Sketch'}
                </span>
                <svg class="dd-chevron" class:rotated={showFontDropdown} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {#if showFontDropdown}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div 
                  class="menu-dropdown-panel font-dropdown-panel" 
                  onclick={(e) => e.stopPropagation()}
                  transition:fade={{ duration: 100 }}
                >
                  {#each textFontOptions as font}
                    <button 
                      type="button" 
                      class="dropdown-opt-btn"
                      class:active={(activeText.fontFamily ?? currentTextFontFamily) === font.value}
                      onclick={() => {
                        updateTextProperty(activeText.id, 'fontFamily', font.value);
                        showFontDropdown = false;
                      }}
                      style="font-family: {font.value};"
                    >
                      {font.label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section">
            <button class="menu-btn" onclick={() => updateTextProperty(activeText.id, 'fontSize', Math.max(8, Math.round(activeText.fontSize) - 2))} title="Smaller text">A-</button>
            <input
              class="menu-size-input"
              type="number"
              min="8"
              max="200"
              value={Math.round(activeText.fontSize)}
              onchange={(e) => {
                const n = Number((e.currentTarget as HTMLInputElement).value);
                updateTextProperty(activeText.id, 'fontSize', Math.max(8, Math.min(200, n || activeText.fontSize)));
              }}
              onpointerdown={(e) => e.stopPropagation()}
              title="Font size (px)"
            />
            <button class="menu-btn" onclick={() => updateTextProperty(activeText.id, 'fontSize', Math.min(200, Math.round(activeText.fontSize) + 2))} title="Larger text">A+</button>
            <button
              class="menu-btn"
              class:active={(activeText.fontWeight ?? '600') === '700'}
              onclick={() => updateTextProperty(activeText.id, 'fontWeight', (activeText.fontWeight ?? '600') === '700' ? '600' : '700')}
              title="Bold"
            >
              B
            </button>
            <button
              class="menu-btn"
              class:active={(activeText.fontStyle ?? 'normal') === 'italic'}
              onclick={() => updateTextProperty(activeText.id, 'fontStyle', (activeText.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic')}
              title="Italic"
            >
              I
            </button>
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section">
            {#each ['left', 'center', 'right'] as align}
              <button
                class="menu-btn"
                class:active={(activeText.textAlign ?? 'left') === align}
                onclick={() => updateTextProperty(activeText.id, 'textAlign', align)}
                title={`Align ${align}`}
              >
                {align.slice(0, 1).toUpperCase()}
              </button>
            {/each}
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section color-section">
            {#each presetColors as col}
              <button
                class="color-dot-mini"
                style="background-color: {col.value};"
                class:active={activeText.color === col.value}
                onclick={() => updateTextColor(activeText.id, col.value)}
                title={col.name}
              ></button>
            {/each}
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section action-section">
            <button class="menu-icon-btn" onclick={() => moveTextLayer(activeText.id, 'front')} title="Bring Text to Front">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </button>
            <button class="menu-icon-btn" onclick={() => moveTextLayer(activeText.id, 'back')} title="Send Text to Back">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 22 2 17 12 12 22 17 12 22" />
                <polyline points="2 7 12 2 22 7" />
                <polyline points="2 12 12 7 22 12" />
              </svg>
            </button>
            <button class="menu-icon-btn" onclick={() => editExistingText(activeText)} title="Edit Text">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
            </button>
            <button class="menu-icon-btn delete-btn" onclick={() => deleteText(activeText.id)} title="Delete Text">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      {/each}
    {/if}

    <!-- Floating shape context toolbar -->
    {#if selectedShapeId && currentTool === 'select' && !showSettingsDropdown}
      {#each sketchShapes.filter(s => s.id === selectedShapeId) as activeShape (activeShape.id)}
        <div
          class="shape-context-menu bento-card"
          style={contextMenuStyle((activeShape.x + activeShape.width / 2) * zoomScale + panOffset.x, activeShape.y * zoomScale + panOffset.y, 720)}
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
              title="Tinted Fill"
            >
              Tint
            </button>
            <button
              class="menu-btn"
              class:active={activeShape.fillColor !== 'transparent' && activeShape.fillColor !== 'glass' && !activeShape.fillColor.endsWith('22')}
              onclick={() => updateShapeProperty(activeShape.id, 'fillColor', activeShape.color)}
              title="Solid Fill (matches border)"
            >
              Solid
            </button>
            <label class="menu-fill-color" title="Pick a custom fill colour">
              <span
                class="fill-color-chip"
                style="background: {activeShape.fillColor !== 'transparent' && activeShape.fillColor !== 'glass' && !activeShape.fillColor.endsWith('22') ? activeShape.fillColor : 'transparent'};"
              ></span>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(activeShape.fillColor) ? activeShape.fillColor : '#06b6d4'}
                oninput={(e) => setShapeFillCustom(activeShape.id, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          </div>

          <div class="menu-divider"></div>

          <!-- Fill Texture -->
          <div class="menu-section">
            <span class="section-lbl">Texture</span>
            {#each fillStyleOptions as option}
              <button
                class="menu-btn"
                class:active={(activeShape.fillStyle ?? 'solid') === option.value}
                onclick={() => updateShapeProperty(activeShape.id, 'fillStyle', option.value)}
                title={`${option.label} fill`}
              >
                {option.label}
              </button>
            {/each}
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

          {#if activeShape.type === 'rectangle'}
            <div class="menu-divider"></div>
            <div class="menu-section">
              <span class="section-lbl">Edges</span>
              <button
                class="menu-btn"
                class:active={(activeShape.edges ?? 'round') === 'round'}
                onclick={() => setShapeEdges(activeShape.id, 'round')}
                title="Rounded corners"
              >
                Round
              </button>
              <button
                class="menu-btn"
                class:active={activeShape.edges === 'sharp'}
                onclick={() => setShapeEdges(activeShape.id, 'sharp')}
                title="Sharp corners"
              >
                Sharp
              </button>
            </div>
          {/if}

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

    <!-- Floating image context toolbar -->
    {#if selectedImageId && currentTool === 'select' && !showSettingsDropdown}
      {#each sketchImages.filter(im => im.id === selectedImageId) as activeImage (activeImage.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="image-context-menu bento-card"
          style={contextMenuStyle((activeImage.x + activeImage.width / 2) * zoomScale + panOffset.x, activeImage.y * zoomScale + panOffset.y, 230)}
          transition:scale={{ start: 0.9, duration: 120 }}
          onpointerdown={e => e.stopPropagation()}
        >
          <div class="menu-section">
            <span class="section-lbl">Opacity</span>
            <input
              class="menu-range"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={activeImage.opacity}
              oninput={(e) => updateImageProperty(activeImage.id, 'opacity', Number((e.currentTarget as HTMLInputElement).value))}
              title="Image opacity"
            />
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section action-section">
            <button class="menu-icon-btn" onclick={() => updateImageProperty(activeImage.id, 'rotation', 0)} title="Reset rotation">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.7 3"/>
                <polyline points="3 4 3 9 8 9"/>
              </svg>
            </button>
            <button class="menu-icon-btn" onclick={() => moveImageLayer(activeImage.id, 'front')} title="Bring to Front">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
              </svg>
            </button>
            <button class="menu-icon-btn" onclick={() => moveImageLayer(activeImage.id, 'back')} title="Send to Back">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 22 2 17 12 12 22 17 12 22"/>
                <polyline points="2 7 12 2 22 7"/>
                <polyline points="2 12 12 7 22 12"/>
              </svg>
            </button>
            <button class="menu-icon-btn delete-btn" onclick={() => deleteImage(activeImage.id)} title="Delete Image">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
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
          font-family: {currentTextFontFamily};
          font-weight: {currentTextWeight};
          font-style: {currentTextStyle};
          text-align: {currentTextAlign};
          color: {currentColor};
          background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.85);
          border: 1px solid var(--accent);
          outline: none;
          padding: 4px 8px;
          border-radius: 6px;
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

  {#if showToolbar}
    {#if showProperties}
      <aside
        class="sketch-properties-panel bento-card"
        transition:scale={{ start: 0.96, duration: 140 }}
        onpointerdown={(e) => e.stopPropagation()}
      >
        <div class="properties-header">
          <span>{selectedPanelText ? 'Text' : selectedPanelShape ? 'Shape' : 'Style'}</span>
          <button class="panel-icon-btn" onclick={() => showProperties = false} title="Hide properties">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 15 12 9 6 15"/>
            </svg>
          </button>
        </div>

        <div class="properties-scroll-body">
        <div class="properties-section">
          <span class="properties-label">Stroke</span>
          <div class="properties-swatches">
            {#each presetColors as col}
              <button
                class="property-swatch"
                class:active={currentColor === col.value || selectedPanelText?.color === col.value || selectedPanelShape?.color === col.value}
                style="background-color: {col.value};"
                onclick={() => setPanelColor(col.value)}
                title={col.name}
              ></button>
            {/each}
          </div>
        </div>

        <div class="properties-section">
          <span class="properties-label">Sketch</span>
          <div class="segmented">
            {#each roughnessOptions as option}
              <button
                class:active={(selectedPanelShape?.roughness ?? currentRoughness) === option.value}
                onclick={() => {
                  currentRoughness = option.value;
                  if (selectedShapeId) updateShapeProperty(selectedShapeId, 'roughness', option.value);
                }}
                title={`${option.label} stroke`}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="properties-section">
          <span class="properties-label">Fill</span>
          <div class="segmented fill-segmented">
            <button
              class:active={panelFillColor === 'transparent'}
              onclick={() => setPanelFillColor('transparent')}
              title="No fill"
            >
              None
            </button>
            <button
              class:active={panelFillColor === 'glass'}
              onclick={() => setPanelFillColor('glass')}
              title="Frosted fill"
            >
              Glass
            </button>
            <button
              class:active={panelFillColor === 'tint' || panelFillColor.endsWith('22')}
              onclick={() => setPanelFillColor('tint')}
              title="Tinted fill"
            >
              Tint
            </button>
            <button
              class:active={panelFillColor !== 'transparent' && panelFillColor !== 'glass' && !panelFillColor.endsWith('22') && panelFillStyle === 'solid'}
              onclick={() => setPanelFillColor(currentColor)}
              title="Solid color fill (matches stroke)"
            >
              Solid
            </button>
          </div>
          <label class="panel-fill-color" title="Pick a custom fill colour">
            <span
              class="fill-color-chip"
              style="background: {panelFillColor !== 'transparent' && panelFillColor !== 'glass' && !panelFillColor.endsWith('22') ? panelFillColor : 'transparent'};"
            ></span>
            <span class="fill-color-label">Custom fill</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(panelFillColor) ? panelFillColor : '#06b6d4'}
              oninput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                currentFillColor = v;
                currentFillStyle = 'solid';
                if (selectedShapeId) setShapeFillCustom(selectedShapeId, v);
              }}
            />
          </label>
        </div>

        <div class="properties-section">
          <span class="properties-label">Texture</span>
          <div class="segmented">
            {#each fillStyleOptions as option}
              <button
                class:active={panelFillStyle === option.value}
                onclick={() => setPanelFillStyle(option.value)}
                title={`${option.label} fill`}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="properties-section">
          <div class="properties-label-row">
            <span class="properties-label">Edges</span>
            <span class="properties-value">{panelEdges === 'sharp' ? 0 : panelBorderRadius}px</span>
          </div>
          <div class="segmented edges-segmented">
            <button
              class:active={panelEdges === 'round'}
              onclick={() => setPanelEdges('round')}
              title="Rounded corners"
            >
              Round
            </button>
            <button
              class:active={panelEdges === 'sharp'}
              onclick={() => setPanelEdges('sharp')}
              title="Sharp corners"
            >
              Sharp
            </button>
          </div>
          <input
            class="property-range"
            type="range"
            min="0"
            max="48"
            step="1"
            value={panelEdges === 'sharp' ? 0 : panelBorderRadius}
            oninput={(e) => setPanelBorderRadius(Number((e.currentTarget as HTMLInputElement).value))}
            title="Corner radius"
          />
        </div>

        <div class="properties-section">
          <span class="properties-label">Font family</span>
          <div class="font-buttons">
            {#each textFontOptions as font}
              <button
                class:active={panelFontFamily === font.value}
                onclick={() => setPanelFontFamily(font.value)}
                title={font.label}
                style="font-family: {font.value};"
              >
                {font.label.slice(0, 2)}
              </button>
            {/each}
          </div>
        </div>

        <div class="properties-section">
          <div class="properties-label-row">
            <span class="properties-label">Font size</span>
            <input
              class="property-number"
              type="number"
              min="8"
              max="200"
              value={Math.round(panelFontSize)}
              onchange={(e) => {
                const n = Number((e.currentTarget as HTMLInputElement).value);
                setPanelFontSize(Math.max(8, Math.min(200, n || panelFontSize)));
              }}
              title="Custom font size (px)"
            />
          </div>
          <div class="segmented size-segmented">
            {#each fontSizeOptions as option}
              <button
                class:active={Math.abs(panelFontSize - option.value) < 2}
                onclick={() => setPanelFontSize(option.value)}
                title={`${option.value}px`}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="properties-section">
          <span class="properties-label">Text align</span>
          <div class="icon-row">
            {#each textAlignOptions as align}
              <button
                class:active={panelTextAlign === align}
                onclick={() => setPanelTextAlign(align)}
                title={`Align ${align}`}
              >
                {align === 'left' ? 'L' : align === 'center' ? 'C' : 'R'}
              </button>
            {/each}
          </div>
        </div>

        <div class="properties-section">
          <div class="properties-label-row">
            <span class="properties-label">Opacity</span>
            <span class="properties-value">{Math.round(panelOpacity * 100)}</span>
          </div>
          <input
            class="property-range"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={panelOpacity}
            oninput={(e) => setPanelOpacity(Number((e.currentTarget as HTMLInputElement).value))}
            title="Opacity"
          />
        </div>

        <div class="properties-section">
          <span class="properties-label">Layers</span>
          <div class="icon-row">
            <button
              disabled={!selectedPanelText && !selectedPanelShape}
              onclick={() => moveSelectedLayer('back')}
              title="Send to back"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m12 19-8-4 8-4 8 4-8 4Z"/>
                <path d="m4 9 8-4 8 4"/>
              </svg>
            </button>
            <button
              disabled={!selectedPanelText && !selectedPanelShape}
              onclick={() => moveSelectedLayer('front')}
              title="Bring to front"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m12 5 8 4-8 4-8-4 8-4Z"/>
                <path d="m4 15 8 4 8-4"/>
              </svg>
            </button>
          </div>
        </div>
        </div>
      </aside>
    {:else}
      <button
        class="properties-toggle bento-card"
        onclick={() => showProperties = true}
        title="Show properties"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 21v-7"/>
          <path d="M4 10V3"/>
          <path d="M12 21v-9"/>
          <path d="M12 8V3"/>
          <path d="M20 21v-5"/>
          <path d="M20 12V3"/>
          <path d="M2 14h4"/>
          <path d="M10 8h4"/>
          <path d="M18 16h4"/>
        </svg>
      </button>
    {/if}
  {/if}

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
            title="Rectangle (R)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'circle'}
            onclick={() => { commitText(); currentTool = 'circle'; }}
            title="Ellipse (O)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'diamond'}
            onclick={() => { commitText(); currentTool = 'diamond'; }}
            title="Diamond (D)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2 22 12 12 22 2 12 Z" />
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'line'}
            onclick={() => { commitText(); currentTool = 'line'; }}
            title="Line (L) — drag freely or between objects"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="20" x2="20" y2="4"/>
            </svg>
          </button>
          <button
            class="tool-btn"
            class:active={currentTool === 'arrow'}
            onclick={() => { commitText(); currentTool = 'arrow'; }}
            title="Arrow (A) — drag freely or between objects"
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
          <button
            class="tool-btn"
            onclick={triggerImagePicker}
            title="Insert image (or paste / drag-drop)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
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
              showFontDropdown = false;
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
                      onclick={() => setBackgroundStyle(style.value as SketchBackgroundStyle)}
                    >
                      {style.label}
                    </button>
                  {/each}
                </div>
              </div>

              <!-- Transparent backdrop opacity -->
              {#if backgroundStyle === 'transparent'}
                <div class="panel-section">
                  <div class="section-title">Backdrop Opacity</div>
                  <div class="setting-row">
                    <input
                      class="backdrop-range"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={backgroundOpacity}
                      oninput={(e) => {
                        backgroundOpacity = Number((e.currentTarget as HTMLInputElement).value);
                        persistCanvasSnapshot();
                      }}
                      title="Backdrop opacity (0% = fully see-through)"
                    />
                    <span class="setting-label">{Math.round(backgroundOpacity * 100)}%</span>
                  </div>
                </div>
              {/if}

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
          <button class="tool-btn zoom-btn" onclick={() => zoomByStep(-1)} title="Zoom Out (−10%)">-</button>
          <button class="zoom-display-btn" onclick={resetZoom} title="Reset Zoom (1:1 / Center)">{Math.round(zoomScale * 100)}%</button>
          <button class="tool-btn zoom-btn" onclick={() => zoomByStep(1)} title="Zoom In (+10%)">+</button>
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
  <input
    type="file"
    accept="image/*"
    multiple
    style="display: none;"
    bind:this={imageFileInputEl}
    onchange={handleImageFileInput}
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
      linear-gradient(135deg, rgba(6, 182, 212, 0.07), transparent 24%),
      linear-gradient(180deg, rgba(11, 13, 18, 0.96), rgba(16, 18, 24, 0.92));
    backdrop-filter: blur(var(--glass-blur, 18px)) saturate(1.05);
    -webkit-backdrop-filter: blur(var(--glass-blur, 18px)) saturate(1.05);
    transition: background-color 0.22s ease;
    border-radius: 8px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
    container-type: inline-size;
    container-name: sketch-container;
  }

  :root.light-theme .sketch-overlay {
    background:
      linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 24%),
      linear-gradient(180deg, rgba(246, 248, 251, 0.94), rgba(238, 242, 246, 0.9));
  }

  .canvas-viewport {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 8px;
    background:
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 48px),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.018) 0 1px, transparent 1px 48px),
      linear-gradient(180deg, rgba(12, 15, 21, 0.78), rgba(16, 19, 26, 0.64));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      inset 0 -80px 120px rgba(0, 0, 0, 0.16);
  }

  :root.light-theme .canvas-viewport {
    background:
      repeating-linear-gradient(0deg, rgba(15, 23, 42, 0.045) 0 1px, transparent 1px 48px),
      repeating-linear-gradient(90deg, rgba(15, 23, 42, 0.035) 0 1px, transparent 1px 48px),
      linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(244, 247, 250, 0.62));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      inset 0 -80px 120px rgba(15, 23, 42, 0.06);
  }

  .sketch-properties-panel {
    position: absolute;
    top: 92px;
    right: 20px;
    z-index: 9025;
    width: 236px;
    max-height: calc(100% - 112px);
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-radius: 8px;
    background: rgba(12, 15, 21, 0.86);
    box-shadow: 0 18px 46px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  :root.light-theme .sketch-properties-panel {
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 18px 46px rgba(15, 23, 42, 0.13);
  }

  .properties-header,
  .properties-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .properties-header {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 14px 14px 10px;
    background: rgba(12, 15, 21, 0.92);
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 12%, var(--border));
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  :root.light-theme .properties-header {
    background: rgba(255, 255, 255, 0.94);
    border-bottom-color: rgba(0, 0, 0, 0.06);
  }

  .properties-scroll-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 13px;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
    padding: 14px;
  }

  .properties-section {
    display: grid;
    gap: 8px;
  }

  .properties-label {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
  }

  .properties-value {
    color: var(--text-secondary);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }

  .properties-swatches,
  .font-buttons,
  .icon-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .property-swatch {
    width: 28px;
    height: 28px;
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    border-radius: 6px;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }

  .property-swatch.active {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .size-segmented {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .fill-segmented {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .edges-segmented {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .segmented button,
  .font-buttons button,
  .icon-row button,
  .panel-icon-btn,
  .properties-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.58);
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
  }

  .segmented button {
    height: 30px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .font-buttons button,
  .icon-row button,
  .panel-icon-btn,
  .properties-toggle {
    width: 32px;
    height: 32px;
  }

  .segmented button:hover,
  .font-buttons button:hover,
  .icon-row button:hover,
  .panel-icon-btn:hover,
  .properties-toggle:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .segmented button.active,
  .font-buttons button.active,
  .icon-row button.active {
    border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
    color: var(--accent);
    background: var(--accent-light);
  }

  .icon-row button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .property-range {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--input-border);
    border-radius: 999px;
    outline: none;
  }

  .property-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .properties-toggle {
    position: absolute;
    top: 96px;
    right: 22px;
    z-index: 9025;
    background: rgba(12, 15, 21, 0.84);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
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

  .floating-text.active-selected {
    background-color: rgba(var(--accent-rgb, 6, 182, 212), 0.08);
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(var(--accent-rgb, 6, 182, 212), 0.12);
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

  /* Floating images */
  .floating-image {
    box-sizing: border-box;
    user-select: none;
    touch-action: none;
    z-index: 3;
    transform-origin: 50% 50%;
  }

  .floating-image-el {
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    pointer-events: none;
    border-radius: 2px;
    -webkit-user-drag: none;
  }

  .floating-image:hover {
    box-shadow: 0 0 0 1.5px var(--accent-light);
  }

  .floating-image.active-selected {
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* Shared resize + rotate handles (shapes & images) */
  .resize-handle {
    width: 10px;
    height: 10px;
    background-color: var(--accent);
    border: 1.5px solid var(--bg-primary);
    border-radius: 50%;
    z-index: 10;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .rotate-handle {
    position: absolute;
    left: 50%;
    top: -26px;
    width: 12px;
    height: 12px;
    transform: translateX(-50%);
    background-color: var(--bg-primary);
    border: 1.5px solid var(--accent);
    border-radius: 50%;
    cursor: grab;
    z-index: 10;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .rotate-handle::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 11px;
    width: 1.5px;
    height: 14px;
    transform: translateX(-50%);
    background-color: var(--accent);
  }

  .rotate-handle:active {
    cursor: grabbing;
  }

  /* Image context menu (reuses shape/text menu look) */
  .image-context-menu {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(12, 15, 21, 0.9);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
    border-radius: 8px;
    box-shadow: var(--shadow-md);
    min-height: 32px;
    max-width: var(--context-menu-max-width, calc(100% - 24px));
    box-sizing: border-box;
    animation: popIn 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  :root.light-theme .image-context-menu {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .menu-range {
    width: 78px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--input-border);
    border-radius: 999px;
    outline: none;
  }

  .menu-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .menu-size-input {
    width: 44px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.55);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    outline: none;
  }

  :root.light-theme .menu-size-input {
    background: rgba(255, 255, 255, 0.75);
  }

  .property-number {
    width: 58px;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.55);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    outline: none;
  }

  .property-number:focus,
  .menu-size-input:focus {
    border-color: var(--accent);
  }

  /* Custom fill-colour controls */
  .menu-fill-color,
  .panel-fill-color {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .panel-fill-color {
    margin-top: 8px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.45);
  }

  .panel-fill-color:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  }

  .fill-color-chip {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid rgba(255, 255, 255, 0.22);
    background-image:
      linear-gradient(45deg, rgba(255, 255, 255, 0.12) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(255, 255, 255, 0.12) 25%, transparent 25%);
    background-size: 8px 8px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
    flex-shrink: 0;
  }

  .fill-color-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .menu-fill-color input[type='color'],
  .panel-fill-color input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: none;
    padding: 0;
  }

  /* Shape context menu */
  .shape-context-menu,
  .text-context-menu {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(12, 15, 21, 0.9);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
    border-radius: 8px;
    box-shadow: var(--shadow-md);
    min-height: 32px;
    max-width: var(--context-menu-max-width, calc(100% - 24px));
    box-sizing: border-box;
    overflow: visible !important;
    animation: popIn 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  :root.light-theme .shape-context-menu,
  :root.light-theme .text-context-menu {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(0, 0, 0, 0.08);
  }

  @keyframes popIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .menu-section {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
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
    white-space: nowrap;
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

  /* Custom Font Dropdown */
  .menu-dropdown-wrapper {
    position: relative;
    display: inline-block;
    overflow: visible;
  }

  .menu-dropdown-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 24px;
    min-width: 78px;
    max-width: 96px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.55);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }

  .menu-dropdown-trigger:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .menu-dropdown-trigger.open {
    border-color: var(--accent);
    background: var(--accent-light);
  }

  .menu-dropdown-panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 110px;
    max-height: min(220px, calc(100vh - 96px));
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
    background: rgba(12, 15, 21, 0.94);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 6px;
    box-shadow: var(--shadow-md);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 9999;
  }

  :root.light-theme .menu-dropdown-trigger {
    background: rgba(255, 255, 255, 0.75);
  }

  :root.light-theme .menu-dropdown-panel {
    background: rgba(255, 255, 255, 0.94);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .dropdown-opt-btn {
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 500;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s ease;
    width: 100%;
    white-space: nowrap;
  }

  .dropdown-opt-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dropdown-opt-btn.active {
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 600;
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
    left: 50%;
    top: 18px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
    width: min(1040px, calc(100% - 40px));
    max-width: calc(100% - 40px);
    z-index: 9010;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
    background:
      linear-gradient(180deg, rgba(22, 26, 34, 0.92), rgba(11, 13, 18, 0.92));
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-top-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border-radius: 8px;
    min-height: 48px;
    height: auto;
    overflow: visible !important;
    transition: transform 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
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
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(242, 245, 248, 0.92));
    border-color: rgba(15, 23, 42, 0.1);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.14);
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
    grid-template-columns: repeat(11, minmax(28px, 1fr));
    gap: 6px;
    padding: 3px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.18);
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
    border-radius: 6px;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .tool-btn:hover, .action-btn:not(:disabled):hover, .exit-btn:hover {
    color: var(--text-primary);
    background-color: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .tool-btn.active {
    color: #ffffff;
    background: linear-gradient(180deg, var(--accent-hover), var(--accent));
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow: 0 8px 18px rgba(15, 118, 110, 0.3);
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
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .size-btn:hover {
    background-color: var(--bg-hover);
  }

  .size-btn.active {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
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
    width: 19px;
    height: 19px;
    border-radius: 5px;
    cursor: pointer;
    position: relative;
    transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.15s ease;
  }

  .color-dot:hover {
    transform: translateY(-1px);
  }

  .color-dot.active {
    transform: translateY(-1px);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 3.5px var(--accent), 0 8px 18px rgba(0, 0, 0, 0.25);
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
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid var(--border);
    border-radius: 6px;
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
    background: rgba(255, 255, 255, 0.08);
  }

  .settings-trigger-btn.open {
    border-color: var(--accent);
    color: var(--text-primary);
    background: rgba(15, 118, 110, 0.16);
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
    bottom: auto;
    right: 0;
    width: 280px;
    max-width: min(280px, calc(100vw - 32px));
    background: rgba(12, 15, 21, 0.94);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 9050;
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

  .backdrop-range {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--input-border);
    border-radius: 999px;
    outline: none;
  }

  .backdrop-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
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
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--border);
    border-radius: 6px;
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
    border-radius: 8px;
    z-index: 9015;
    background: rgba(12, 15, 21, 0.84);
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
      top: 14px;
      width: min(100%, calc(100% - 16px));
      max-width: calc(100% - 16px);
      flex-direction: row;
      align-content: center;
      padding: 8px 10px;
      gap: 6px;
      border-radius: 8px;
    }
    .hide-on-stack {
      display: none !important;
    }
    .toolbar-group {
      width: auto;
      justify-content: center;
      gap: 6px;
    }
    .draw-group,
    .utility-group {
      row-gap: 6px;
    }
    .main-tools {
      grid-template-columns: repeat(11, minmax(26px, 1fr));
      justify-items: center;
      width: auto;
      gap: 4px;
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
    .sketch-properties-panel {
      top: 112px;
      right: 16px;
      max-height: calc(100% - 132px);
    }
    .properties-toggle {
      top: 116px;
      right: 18px;
    }
  }

  @container sketch-container (max-width: 768px) {
    .sketch-toolbar {
      top: 10px;
      padding: 7px 8px;
      gap: 5px;
      border-radius: 8px;
    }
    .active-style-label {
      display: none;
    }
    .opacity-slider .slider-label {
      display: none;
    }
    .draw-group {
      justify-content: center;
      gap: 5px;
    }
    .main-tools {
      grid-template-columns: repeat(11, minmax(24px, 1fr));
      gap: 3px;
      width: auto;
    }
    .toolbar-section {
      justify-content: center;
    }
    .colors {
      justify-content: center;
    }
    .opacity-slider {
      justify-content: center;
      width: auto;
      gap: 5px;
    }
    .opacity-slider input[type="range"] {
      width: min(72px, 22vw);
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
    .sketch-properties-panel {
      top: 104px;
      right: 10px;
      left: auto;
      bottom: auto;
      width: min(240px, calc(100% - 20px));
      max-height: calc(100% - 124px);
    }
    .properties-toggle {
      top: 108px;
      right: 12px;
      left: auto;
      bottom: auto;
    }
  }

  @container sketch-container (max-width: 560px) {
    .sketch-toolbar {
      width: min(100%, calc(100% - 16px));
      max-width: calc(100% - 16px);
      padding: 5px 6px;
      gap: 4px;
      border-radius: 8px;
    }
    .tool-btn, .action-btn, .exit-btn {
      width: 26px;
      height: 26px;
    }
    .main-tools {
      grid-template-columns: repeat(6, minmax(24px, 1fr));
      gap: 3px;
      width: auto;
    }
    .size-btn {
      width: 22px;
      height: 22px;
    }
    .color-dot {
      width: 14px;
      height: 14px;
    }
    .opacity-slider {
      display: none;
    }
    .settings-trigger-btn {
      padding-inline: 8px;
      font-size: 10px;
    }
    .zoom-controls {
      gap: 2px;
    }
    .zoom-display-btn {
      min-width: 44px;
      font-size: 10px;
      padding: 3px;
    }
    .actions {
      gap: 3px;
    }
    .settings-dropdown-panel {
      width: min(280px, calc(100vw - 20px));
    }
  }
</style>
