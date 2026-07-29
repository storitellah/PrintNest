import { clamp } from '../core/units.ts';
import { store } from '../core/store.ts';
import type { PageElement, Project, Rect } from '../core/types.ts';
import { el } from './dom.ts';

/**
 * Direct manipulation on the canvas: drag to move, handles to resize, a
 * separate handle to rotate.
 *
 * Pointer Events are used throughout, so a mouse, a trackpad, a finger and a
 * stylus all take the same code path. `setPointerCapture` keeps a drag alive
 * even when the pointer leaves the element.
 *
 * All arithmetic happens in millimetres. The only place pixels appear is the
 * conversion at the start of a gesture, using the live scale of the stage.
 */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

const HANDLES: { id: HandleId; xFraction: number; yFraction: number }[] = [
  { id: 'nw', xFraction: 0, yFraction: 0 },
  { id: 'n', xFraction: 0.5, yFraction: 0 },
  { id: 'ne', xFraction: 1, yFraction: 0 },
  { id: 'e', xFraction: 1, yFraction: 0.5 },
  { id: 'se', xFraction: 1, yFraction: 1 },
  { id: 's', xFraction: 0.5, yFraction: 1 },
  { id: 'sw', xFraction: 0, yFraction: 1 },
  { id: 'w', xFraction: 0, yFraction: 0.5 },
];

/** How close, in millimetres, before an edge snaps. */
const SNAP_TOLERANCE_MM = 1.5;
/** Smallest element the editor will let you make. */
const MIN_SIZE_MM = 3;

export interface InteractionContext {
  /** The stage element, whose CSS scale maps millimetres to screen pixels. */
  stage: HTMLElement;
  pageIndex: number;
  scale: number;
  onChange: () => void;
}

export interface SnapLine {
  orientation: 'v' | 'h';
  positionMm: number;
}

/**
 * Candidate snap positions on a page: the page edges, its centre lines, the
 * margin box, and the edges and centres of every other element.
 */
export function snapTargets(
  project: Project,
  pageIndex: number,
  excludeIds: Set<string>,
): { vertical: number[]; horizontal: number[] } {
  const page = project.pages[pageIndex];
  const vertical = [
    0,
    project.pageWidthMm / 2,
    project.pageWidthMm,
    project.margins.leftMm,
    project.pageWidthMm - project.margins.rightMm,
  ];
  const horizontal = [
    0,
    project.pageHeightMm / 2,
    project.pageHeightMm,
    project.margins.topMm,
    project.pageHeightMm - project.margins.bottomMm,
  ];

  for (const element of page?.elements ?? []) {
    if (excludeIds.has(element.id) || element.hidden) continue;
    vertical.push(element.xMm, element.xMm + element.widthMm / 2, element.xMm + element.widthMm);
    horizontal.push(element.yMm, element.yMm + element.heightMm / 2, element.yMm + element.heightMm);
  }

  return { vertical, horizontal };
}

/**
 * Snap a moving rectangle to nearby targets.
 * Returns the adjusted offset and the guides that should be drawn.
 */
export function computeSnap(
  rect: Rect,
  targets: { vertical: number[]; horizontal: number[] },
  toleranceMm = SNAP_TOLERANCE_MM,
): { dxMm: number; dyMm: number; lines: SnapLine[] } {
  const lines: SnapLine[] = [];
  let dxMm = 0;
  let dyMm = 0;

  const edgesX = [rect.xMm, rect.xMm + rect.widthMm / 2, rect.xMm + rect.widthMm];
  const edgesY = [rect.yMm, rect.yMm + rect.heightMm / 2, rect.yMm + rect.heightMm];

  let bestX = toleranceMm;
  for (const edge of edgesX) {
    for (const target of targets.vertical) {
      const distance = Math.abs(edge - target);
      if (distance < bestX) {
        bestX = distance;
        dxMm = target - edge;
        lines.length = 0;
        lines.push({ orientation: 'v', positionMm: target });
      }
    }
  }

  let bestY = toleranceMm;
  const horizontalLines: SnapLine[] = [];
  for (const edge of edgesY) {
    for (const target of targets.horizontal) {
      const distance = Math.abs(edge - target);
      if (distance < bestY) {
        bestY = distance;
        dyMm = target - edge;
        horizontalLines.length = 0;
        horizontalLines.push({ orientation: 'h', positionMm: target });
      }
    }
  }

  return { dxMm, dyMm, lines: [...lines, ...horizontalLines] };
}

/**
 * Resize a rectangle by dragging `handle`, honouring aspect lock and the
 * minimum size. Returns a new rectangle; the original is untouched.
 */
export function resizeRect(
  rect: Rect,
  handle: HandleId,
  dxMm: number,
  dyMm: number,
  options: { keepAspect?: boolean; fromCentre?: boolean } = {},
): Rect {
  if (handle === 'rotate') return rect;

  let { xMm, yMm, widthMm, heightMm } = rect;
  const right = xMm + widthMm;
  const bottom = yMm + heightMm;

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (options.fromCentre) {
    // Alt-drag grows the element symmetrically about its centre.
    if (movesLeft || movesRight) {
      const delta = movesLeft ? -dxMm : dxMm;
      widthMm = Math.max(MIN_SIZE_MM, widthMm + delta * 2);
      xMm = rect.xMm + (rect.widthMm - widthMm) / 2;
    }
    if (movesTop || movesBottom) {
      const delta = movesTop ? -dyMm : dyMm;
      heightMm = Math.max(MIN_SIZE_MM, heightMm + delta * 2);
      yMm = rect.yMm + (rect.heightMm - heightMm) / 2;
    }
  } else {
    if (movesLeft) {
      xMm = Math.min(right - MIN_SIZE_MM, xMm + dxMm);
      widthMm = right - xMm;
    } else if (movesRight) {
      widthMm = Math.max(MIN_SIZE_MM, widthMm + dxMm);
    }
    if (movesTop) {
      yMm = Math.min(bottom - MIN_SIZE_MM, yMm + dyMm);
      heightMm = bottom - yMm;
    } else if (movesBottom) {
      heightMm = Math.max(MIN_SIZE_MM, heightMm + dyMm);
    }
  }

  if (options.keepAspect && rect.widthMm > 0 && rect.heightMm > 0) {
    const aspect = rect.widthMm / rect.heightMm;
    // Let the larger change drive, so the gesture feels predictable.
    if (Math.abs(widthMm - rect.widthMm) >= Math.abs(heightMm - rect.heightMm)) {
      heightMm = widthMm / aspect;
    } else {
      widthMm = heightMm * aspect;
    }
    if (movesTop) yMm = bottom - heightMm;
    if (movesLeft) xMm = right - widthMm;
  }

  return {
    xMm,
    yMm,
    widthMm: Math.max(MIN_SIZE_MM, widthMm),
    heightMm: Math.max(MIN_SIZE_MM, heightMm),
  };
}

/** Angle in degrees from an element's centre to a point, snapped near 15°. */
export function rotationFor(
  centreXMm: number,
  centreYMm: number,
  pointXMm: number,
  pointYMm: number,
  snap: boolean,
): number {
  const radians = Math.atan2(pointYMm - centreYMm, pointXMm - centreXMm);
  // Zero degrees points up, which is what the handle sits above.
  let degrees = (radians * 180) / Math.PI + 90;
  degrees = ((degrees % 360) + 360) % 360;
  if (snap) {
    const step = 15;
    const nearest = Math.round(degrees / step) * step;
    if (Math.abs(nearest - degrees) < 4) degrees = nearest % 360;
  }
  return Math.round(degrees * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Attaching interactions to the DOM
 * ------------------------------------------------------------------ */

export interface SelectionOverlay {
  root: HTMLElement;
  update: () => void;
  destroy: () => void;
}

/**
 * Draw the selection box and handles over the current selection, and wire up
 * the pointer gestures that move, resize and rotate it.
 */
export function attachSelectionOverlay(context: InteractionContext): SelectionOverlay {
  const root = el('div', { class: 'pn-selection-layer', 'aria-hidden': 'true' });
  const box = el('div', { class: 'pn-selection-box' });
  const snapLayer = el('div', { class: 'pn-snap-layer' });
  const handles = new Map<HandleId, HTMLElement>();

  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.pointerEvents = 'none';
  snapLayer.style.position = 'absolute';
  snapLayer.style.inset = '0';

  for (const handle of HANDLES) {
    const node = el('div', {
      class: `pn-handle pn-handle--${handle.id}`,
      'data-handle': handle.id,
    });
    handles.set(handle.id, node);
    root.append(node);
  }
  const rotateHandle = el('div', { class: 'pn-handle pn-handle--rotate', 'data-handle': 'rotate' });
  handles.set('rotate', rotateHandle);
  root.append(box, rotateHandle, snapLayer);

  const mmToPx = (mm: number): number => (mm / 25.4) * 96 * context.scale;

  function currentBounds(): Rect | null {
    const project = store.project;
    if (!project) return null;
    const page = project.pages[context.pageIndex];
    if (!page) return null;
    const selected = page.elements.filter((element) =>
      store.ui.selection.elementIds.includes(element.id),
    );
    if (selected.length === 0) return null;

    const left = Math.min(...selected.map((element) => element.xMm));
    const top = Math.min(...selected.map((element) => element.yMm));
    const right = Math.max(...selected.map((element) => element.xMm + element.widthMm));
    const bottom = Math.max(...selected.map((element) => element.yMm + element.heightMm));
    return { xMm: left, yMm: top, widthMm: right - left, heightMm: bottom - top };
  }

  function update(): void {
    const bounds = currentBounds();
    const visible = bounds !== null && store.ui.selection.pageIndex === context.pageIndex;
    root.style.display = visible ? 'block' : 'none';
    if (!bounds) return;

    box.style.left = `${mmToPx(bounds.xMm)}px`;
    box.style.top = `${mmToPx(bounds.yMm)}px`;
    box.style.width = `${mmToPx(bounds.widthMm)}px`;
    box.style.height = `${mmToPx(bounds.heightMm)}px`;

    for (const handle of HANDLES) {
      const node = handles.get(handle.id)!;
      node.style.left = `${mmToPx(bounds.xMm + bounds.widthMm * handle.xFraction)}px`;
      node.style.top = `${mmToPx(bounds.yMm + bounds.heightMm * handle.yFraction)}px`;
    }
    rotateHandle.style.left = `${mmToPx(bounds.xMm + bounds.widthMm / 2)}px`;
    rotateHandle.style.top = `${mmToPx(bounds.yMm) - 26}px`;

    // A single locked element cannot be resized, so hide the handles.
    const project = store.project;
    const locked =
      project?.pages[context.pageIndex]?.elements.some(
        (element) => store.ui.selection.elementIds.includes(element.id) && element.locked,
      ) ?? false;
    for (const node of handles.values()) node.style.display = locked ? 'none' : 'block';
  }

  const cleanup = attachPointerGestures(context, root, snapLayer, update);
  update();

  return {
    root,
    update,
    destroy: () => {
      cleanup();
      root.remove();
    },
  };
}

function attachPointerGestures(
  context: InteractionContext,
  overlay: HTMLElement,
  snapLayer: HTMLElement,
  update: () => void,
): () => void {
  const stage = context.stage;

  interface DragState {
    pointerId: number;
    mode: 'move' | 'resize' | 'rotate';
    handle: HandleId | null;
    startXMm: number;
    startYMm: number;
    originals: Map<string, Rect & { rotation: number }>;
    moved: boolean;
  }

  let drag: DragState | null = null;

  const pxToMm = (px: number): number => (px / (96 * context.scale)) * 25.4;

  function pointInPageMm(event: PointerEvent): { xMm: number; yMm: number } {
    const rect = stage.getBoundingClientRect();
    return {
      xMm: pxToMm(event.clientX - rect.left),
      yMm: pxToMm(event.clientY - rect.top),
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const project = store.project;
    if (!project) return;

    const target = event.target as HTMLElement;
    const handleId = target.dataset.handle as HandleId | undefined;
    const elementNode = target.closest<HTMLElement>('[data-element-id]');

    if (!handleId && !elementNode) {
      // Clicking bare page clears the selection.
      store.selectElements([], context.pageIndex);
      return;
    }

    if (!handleId && elementNode) {
      const elementId = elementNode.dataset.elementId!;
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (additive) {
        store.toggleElement(elementId);
      } else if (!store.ui.selection.elementIds.includes(elementId)) {
        store.selectElements([elementId], context.pageIndex);
      }
    }

    const page = project.pages[context.pageIndex];
    if (!page) return;
    const selected = page.elements.filter((element) =>
      store.ui.selection.elementIds.includes(element.id),
    );
    if (selected.length === 0) return;
    if (selected.some((element) => element.locked)) return;

    const start = pointInPageMm(event);
    drag = {
      pointerId: event.pointerId,
      mode: handleId === 'rotate' ? 'rotate' : handleId ? 'resize' : 'move',
      handle: handleId ?? null,
      startXMm: start.xMm,
      startYMm: start.yMm,
      originals: new Map(
        selected.map((element) => [
          element.id,
          {
            xMm: element.xMm,
            yMm: element.yMm,
            widthMm: element.widthMm,
            heightMm: element.heightMm,
            rotation: element.rotation,
          },
        ]),
      ),
      moved: false,
    };

    (event.target as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const project = store.project;
    if (!project) return;

    const point = pointInPageMm(event);
    let dxMm = point.xMm - drag.startXMm;
    let dyMm = point.yMm - drag.startYMm;

    if (!drag.moved && Math.hypot(dxMm, dyMm) < 0.4) return;
    drag.moved = true;

    // Shift constrains a move to one axis, the classic behaviour.
    if (drag.mode === 'move' && event.shiftKey) {
      if (Math.abs(dxMm) > Math.abs(dyMm)) dyMm = 0;
      else dxMm = 0;
    }

    const snapLines: SnapLine[] = [];

    store.update(
      (draft) => {
        const page = draft.pages[context.pageIndex];
        if (!page) return false;

        if (drag!.mode === 'rotate') {
          for (const [id, original] of drag!.originals) {
            const element = page.elements.find((entry) => entry.id === id);
            if (!element) continue;
            element.rotation = rotationFor(
              original.xMm + original.widthMm / 2,
              original.yMm + original.heightMm / 2,
              point.xMm,
              point.yMm,
              !event.altKey,
            );
          }
          return;
        }

        if (drag!.mode === 'resize') {
          for (const [id, original] of drag!.originals) {
            const element = page.elements.find((entry) => entry.id === id);
            if (!element) continue;
            const next = resizeRect(original, drag!.handle!, dxMm, dyMm, {
              // Images keep their proportions unless Shift overrides.
              keepAspect: element.type === 'image' ? !event.shiftKey : event.shiftKey,
              fromCentre: event.altKey,
            });
            Object.assign(element, next);
          }
          return;
        }

        // Move, with snapping against the page and the other elements.
        let appliedDx = dxMm;
        let appliedDy = dyMm;

        if (store.ui.snapEnabled && !event.altKey && drag!.originals.size > 0) {
          const ids = new Set(drag!.originals.keys());
          const originals = [...drag!.originals.values()];
          const left = Math.min(...originals.map((entry) => entry.xMm)) + dxMm;
          const top = Math.min(...originals.map((entry) => entry.yMm)) + dyMm;
          const right = Math.max(...originals.map((entry) => entry.xMm + entry.widthMm)) + dxMm;
          const bottom = Math.max(...originals.map((entry) => entry.yMm + entry.heightMm)) + dyMm;

          const snap = computeSnap(
            { xMm: left, yMm: top, widthMm: right - left, heightMm: bottom - top },
            snapTargets(draft, context.pageIndex, ids),
          );
          appliedDx += snap.dxMm;
          appliedDy += snap.dyMm;
          snapLines.push(...snap.lines);
        }

        for (const [id, original] of drag!.originals) {
          const element = page.elements.find((entry) => entry.id === id);
          if (!element) continue;
          element.xMm = original.xMm + appliedDx;
          element.yMm = original.yMm + appliedDy;
        }
      },
      { label: `drag-${drag.mode}`, coalesce: true },
    );

    drawSnapLines(snapLayer, snapLines, context.scale);
    update();
    context.onChange();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    snapLayer.replaceChildren();
    update();
    context.onChange();
  }

  stage.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  return () => {
    stage.removeEventListener('pointerdown', onPointerDown);
    overlay.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };
}

function drawSnapLines(layer: HTMLElement, lines: SnapLine[], scale: number): void {
  layer.replaceChildren();
  const mmToPx = (mm: number): number => (mm / 25.4) * 96 * scale;
  for (const line of lines) {
    const node = el('div', { class: `pn-snapline pn-snapline--${line.orientation}` });
    if (line.orientation === 'v') node.style.left = `${mmToPx(line.positionMm)}px`;
    else node.style.top = `${mmToPx(line.positionMm)}px`;
    layer.append(node);
  }
}

/* ------------------------------------------------------------------ *
 * Keyboard nudging and alignment
 * ------------------------------------------------------------------ */

/** Move the selection with the arrow keys. Shift moves ten times as far. */
export function nudgeSelection(dxMm: number, dyMm: number): void {
  const project = store.project;
  if (!project) return;
  const ids = new Set(store.ui.selection.elementIds);
  if (ids.size === 0) return;

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      let changed = false;
      for (const element of page.elements) {
        if (!ids.has(element.id) || element.locked) continue;
        element.xMm += dxMm;
        element.yMm += dyMm;
        changed = true;
      }
      return changed ? undefined : false;
    },
    { label: 'nudge', coalesce: true },
  );
}

export type AlignMode =
  | 'left' | 'centre-x' | 'right'
  | 'top' | 'centre-y' | 'bottom'
  | 'distribute-x' | 'distribute-y';

/**
 * Align or distribute the selection.
 *
 * With one element selected, alignment is relative to the page's margin box —
 * which is what someone centring a single photograph expects. With several,
 * it is relative to their combined bounds.
 */
export function alignSelection(mode: AlignMode): void {
  const project = store.project;
  if (!project) return;
  const ids = new Set(store.ui.selection.elementIds);
  if (ids.size === 0) return;

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      const selected = page.elements.filter((element) => ids.has(element.id) && !element.locked);
      if (selected.length === 0) return false;

      const single = selected.length === 1;
      const left = single ? draft.margins.leftMm : Math.min(...selected.map((e) => e.xMm));
      const top = single ? draft.margins.topMm : Math.min(...selected.map((e) => e.yMm));
      const right = single
        ? draft.pageWidthMm - draft.margins.rightMm
        : Math.max(...selected.map((e) => e.xMm + e.widthMm));
      const bottom = single
        ? draft.pageHeightMm - draft.margins.bottomMm
        : Math.max(...selected.map((e) => e.yMm + e.heightMm));

      switch (mode) {
        case 'left':
          for (const element of selected) element.xMm = left;
          break;
        case 'right':
          for (const element of selected) element.xMm = right - element.widthMm;
          break;
        case 'centre-x':
          for (const element of selected) element.xMm = (left + right) / 2 - element.widthMm / 2;
          break;
        case 'top':
          for (const element of selected) element.yMm = top;
          break;
        case 'bottom':
          for (const element of selected) element.yMm = bottom - element.heightMm;
          break;
        case 'centre-y':
          for (const element of selected) element.yMm = (top + bottom) / 2 - element.heightMm / 2;
          break;
        case 'distribute-x': {
          if (selected.length < 3) return false;
          const sorted = [...selected].sort((a, b) => a.xMm - b.xMm);
          const totalWidth = sorted.reduce((sum, element) => sum + element.widthMm, 0);
          const gap = (right - left - totalWidth) / (sorted.length - 1);
          let cursor = left;
          for (const element of sorted) {
            element.xMm = cursor;
            cursor += element.widthMm + gap;
          }
          break;
        }
        case 'distribute-y': {
          if (selected.length < 3) return false;
          const sorted = [...selected].sort((a, b) => a.yMm - b.yMm);
          const totalHeight = sorted.reduce((sum, element) => sum + element.heightMm, 0);
          const gap = (bottom - top - totalHeight) / (sorted.length - 1);
          let cursor = top;
          for (const element of sorted) {
            element.yMm = cursor;
            cursor += element.heightMm + gap;
          }
          break;
        }
      }
      return undefined;
    },
    { label: `align-${mode}` },
  );
}

/** Move selected elements up or down the stacking order. */
export function changeLayerOrder(direction: 'front' | 'back' | 'forward' | 'backward'): void {
  const ids = new Set(store.ui.selection.elementIds);
  if (ids.size === 0) return;

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      const selected: PageElement[] = [];
      const rest: PageElement[] = [];
      for (const element of page.elements) {
        (ids.has(element.id) ? selected : rest).push(element);
      }
      if (selected.length === 0) return false;

      switch (direction) {
        case 'front':
          page.elements = [...rest, ...selected];
          break;
        case 'back':
          page.elements = [...selected, ...rest];
          break;
        case 'forward': {
          const next = [...page.elements];
          for (let i = next.length - 2; i >= 0; i -= 1) {
            if (ids.has(next[i]!.id) && !ids.has(next[i + 1]!.id)) {
              [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
            }
          }
          page.elements = next;
          break;
        }
        case 'backward': {
          const next = [...page.elements];
          for (let i = 1; i < next.length; i += 1) {
            if (ids.has(next[i]!.id) && !ids.has(next[i - 1]!.id)) {
              [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
            }
          }
          page.elements = next;
          break;
        }
      }
      return undefined;
    },
    { label: `layer-${direction}` },
  );
}

/** Clamp an element so at least part of it stays on the page. */
export function keepOnPage(element: PageElement, project: Project): void {
  element.xMm = clamp(element.xMm, -element.widthMm + 5, project.pageWidthMm - 5);
  element.yMm = clamp(element.yMm, -element.heightMm + 5, project.pageHeightMm - 5);
}
