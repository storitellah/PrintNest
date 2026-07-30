import { cachedObjectUrl } from '../core/assets.ts';
import { inkFilter } from '../core/ink.ts';
import { safeColor } from '../core/sanitize.ts';
import type {
  ImageElement,
  Page,
  PageElement,
  PageNumberElement,
  Project,
  ShapeElement,
  TextElement,
} from '../core/types.ts';
import { computeImageLayout } from './imageLayout.ts';

/**
 * Page rendering.
 *
 * A page becomes a DOM subtree sized in real millimetres. The exact same
 * function feeds the on-screen preview and the print document — the only
 * difference is that the preview wraps it in a `scale()` transform and adds an
 * overlay layer that print CSS hides.
 *
 * Using millimetres rather than pixels is what makes "what you see is the size
 * it prints" hold: `@page { size: 210mm 297mm; margin: 0 }` plus a 210 × 297 mm
 * element is a 1:1 print with no scaling arithmetic anywhere.
 */

export interface RenderPageOptions {
  project: Project;
  page: Page;
  /** 0-based index, used for page numbering. */
  pageIndex: number;
  /** Render at draft quality: preview images instead of originals. */
  draft?: boolean;
  /** Show the page's own overlays (margins, safe area). Preview only. */
  overlays?: PageOverlayOptions;
  /** Skip page-number elements — the imposition preview handles those itself. */
  interactive?: boolean;
}

export interface PageOverlayOptions {
  margins: boolean;
  safeArea: boolean;
  bleed: boolean;
  grid: boolean;
  gridSizeMm: number;
}

const FONT_STACKS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'var(--pn-font-sans)',
  serif: 'var(--pn-font-serif)',
  mono: 'var(--pn-font-mono)',
};

function mm(value: number): string {
  // Six decimals is well below printer resolution and keeps the DOM readable.
  return `${Math.round(value * 1e4) / 1e4}mm`;
}

/** Build the DOM for one page at its true physical size. */
export function renderPage(options: RenderPageOptions): HTMLElement {
  const { project, page, pageIndex } = options;
  const root = document.createElement('div');
  root.className = 'pn-page';
  root.dataset.pageIndex = String(pageIndex);
  root.style.width = mm(project.pageWidthMm);
  root.style.height = mm(project.pageHeightMm);

  const ink = project.settings.ink;
  root.style.backgroundColor =
    ink.enabled && ink.removeBackgrounds
      ? '#FFFFFF'
      : safeColor(page.backgroundColor, '#FFFFFF');

  const filter = inkFilter(ink);
  if (filter) root.style.filter = filter;

  const content = document.createElement('div');
  content.className = 'pn-page__content';
  root.append(content);

  const ordered = [...page.elements];
  for (const element of ordered) {
    if (element.hidden) continue;
    const node = renderElement(element, options);
    if (node) content.append(node);
  }

  if (options.overlays) {
    root.append(renderOverlays(project, options.overlays));
  }

  if (project.settings.madeAtHomeStamp && isLastPage(project, pageIndex)) {
    root.append(renderMadeAtHomeStamp(project));
  }

  return root;
}

function isLastPage(project: Project, pageIndex: number): boolean {
  return pageIndex === project.pages.length - 1;
}

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

function renderElement(element: PageElement, options: RenderPageOptions): HTMLElement | null {
  const node = document.createElement('div');
  node.className = `pn-el pn-el--${element.type}`;
  node.dataset.elementId = element.id;
  node.style.left = mm(element.xMm);
  node.style.top = mm(element.yMm);
  node.style.width = mm(element.widthMm);
  node.style.height = mm(element.heightMm);
  if (element.rotation) node.style.transform = `rotate(${element.rotation}deg)`;
  if (element.opacity < 1) node.style.opacity = String(element.opacity);

  switch (element.type) {
    case 'image':
      renderImage(node, element, options);
      break;
    case 'text':
      renderText(node, element, options.project);
      break;
    case 'shape':
      renderShape(node, element);
      break;
    case 'page-number':
      renderPageNumber(node, element, options);
      break;
  }

  return node;
}

function renderImage(node: HTMLElement, element: ImageElement, options: RenderPageOptions): void {
  const asset = options.project.assets.find((entry) => entry.id === element.assetId);

  if (element.matteColor) {
    node.style.backgroundColor = safeColor(element.matteColor, '#FFFFFF');
  }
  if (element.borderMm > 0) {
    node.style.border = `${mm(element.borderMm)} solid ${safeColor(element.borderColor, '#171717')}`;
    // Keep the frame's outer size stable when a border is added.
    node.style.boxSizing = 'border-box';
  }
  if (element.cornerRadiusMm > 0) {
    node.style.borderRadius = mm(element.cornerRadiusMm);
  }
  node.style.overflow = 'hidden';

  if (!element.assetId) {
    // An unfilled template slot. Drawn as a dashed frame on screen and left
    // empty in print, so an unused slot never prints a box.
    node.classList.add('pn-el--placeholder');
    const notice = document.createElement('span');
    notice.className = 'pn-el__placeholder-label';
    notice.textContent = 'Drop a picture here';
    node.append(notice);
    return;
  }

  if (!asset) {
    node.classList.add('pn-el--missing');
    const notice = document.createElement('span');
    notice.className = 'pn-el__missing-label';
    notice.textContent = 'Missing image';
    node.append(notice);
    return;
  }

  const url = cachedObjectUrl(asset.id);
  if (!url) {
    node.classList.add('pn-el--loading');
    return;
  }

  const layout = computeImageLayout({
    element,
    naturalWidthPx: asset.widthPx,
    naturalHeightPx: asset.heightPx,
  });

  const rotator = document.createElement('div');
  rotator.className = 'pn-el__rotator';
  rotator.style.width = mm(layout.preWidthMm);
  rotator.style.height = mm(layout.preHeightMm);
  // Centre the rotator on the footprint centre so rotation lands correctly.
  rotator.style.left = mm(layout.footprintXMm + (layout.footprintWidthMm - layout.preWidthMm) / 2);
  rotator.style.top = mm(layout.footprintYMm + (layout.footprintHeightMm - layout.preHeightMm) / 2);
  const transforms: string[] = [];
  if (layout.rotationDeg) transforms.push(`rotate(${layout.rotationDeg}deg)`);
  if (layout.scaleX !== 1 || layout.scaleY !== 1) {
    transforms.push(`scale(${layout.scaleX}, ${layout.scaleY})`);
  }
  if (transforms.length > 0) rotator.style.transform = transforms.join(' ');

  const image = document.createElement('img');
  image.className = 'pn-el__image';
  image.src = url;
  // Decorative in the print output; the caption carries the meaning.
  image.alt = element.caption || asset.name;
  image.draggable = false;
  image.decoding = 'async';
  image.style.width = mm(layout.imageWidthMm);
  image.style.height = mm(layout.imageHeightMm);
  image.style.left = mm(layout.imageLeftMm);
  image.style.top = mm(layout.imageTopMm);

  const ink = options.project.settings.ink;
  if (ink.enabled && ink.imageDensity < 1) {
    image.style.opacity = String(Math.max(0.35, ink.imageDensity));
  }

  rotator.append(image);
  node.append(rotator);
}

function renderText(node: HTMLElement, element: TextElement, project: Project): void {
  const ink = project.settings.ink;
  if (element.backgroundColor && !(ink.enabled && ink.removeBackgrounds)) {
    node.style.backgroundColor = safeColor(element.backgroundColor, 'transparent');
  }
  if (element.paddingMm > 0) {
    node.style.padding = mm(element.paddingMm);
    node.style.boxSizing = 'border-box';
  }

  const block = document.createElement('div');
  block.className = 'pn-el__text';
  block.style.fontFamily = FONT_STACKS[element.font];
  block.style.fontSize = `${element.sizePt}pt`;
  block.style.lineHeight = String(element.lineHeight);
  block.style.letterSpacing = `${element.letterSpacing}em`;
  block.style.textAlign = element.align;
  block.style.color = safeColor(element.color, '#171717');
  if (element.bold) block.style.fontWeight = '600';
  if (element.italic) block.style.fontStyle = 'italic';
  if (element.uppercase) block.style.textTransform = 'uppercase';
  if (element.columns > 1) {
    block.style.columnCount = String(element.columns);
    block.style.columnGap = mm(element.columnGapMm);
  }
  // textContent, never innerHTML: user text is never parsed as markup.
  block.textContent = element.text;

  node.append(block);
}

function renderShape(node: HTMLElement, element: ShapeElement): void {
  const fill = element.fill ? safeColor(element.fill, 'transparent') : 'transparent';
  const stroke = element.stroke ? safeColor(element.stroke, 'transparent') : null;

  if (element.shape === 'line') {
    const line = document.createElement('div');
    line.className = 'pn-el__line';
    line.style.height = mm(Math.max(0.05, element.strokeMm));
    line.style.backgroundColor = stroke ?? '#171717';
    node.style.display = 'flex';
    node.style.alignItems = 'center';
    node.append(line);
    return;
  }

  node.style.backgroundColor = fill;
  if (stroke && element.strokeMm > 0) {
    node.style.border = `${mm(element.strokeMm)} solid ${stroke}`;
    node.style.boxSizing = 'border-box';
  }
  if (element.shape === 'ellipse') {
    node.style.borderRadius = '50%';
  } else if (element.cornerRadiusMm > 0) {
    node.style.borderRadius = mm(element.cornerRadiusMm);
  }
}

function renderPageNumber(
  node: HTMLElement,
  element: PageNumberElement,
  options: RenderPageOptions,
): void {
  const { project, pageIndex } = options;
  if (element.skipPages.includes(pageIndex)) {
    node.style.display = 'none';
    return;
  }
  const page = project.pages[pageIndex];
  if (page && (page.role === 'cover' || page.role === 'back-cover')) {
    node.style.display = 'none';
    return;
  }

  const number = element.startAt + pageIndex;
  const text = element.format
    .replace('{n}', String(number))
    .replace('{total}', String(project.pages.length));

  const block = document.createElement('div');
  block.className = 'pn-el__text';
  block.style.fontFamily = FONT_STACKS[element.font];
  block.style.fontSize = `${element.sizePt}pt`;
  block.style.textAlign = element.align;
  block.style.color = safeColor(element.color, '#6B6B6B');
  block.textContent = text;
  node.append(block);
}

/* ------------------------------------------------------------------ *
 * Overlays — preview only, hidden by the print stylesheet
 * ------------------------------------------------------------------ */

function renderOverlays(project: Project, overlays: PageOverlayOptions): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pn-page__overlay';
  layer.setAttribute('aria-hidden', 'true');

  if (overlays.grid && overlays.gridSizeMm > 0) {
    const grid = document.createElement('div');
    grid.className = 'pn-overlay pn-overlay--grid';
    grid.style.backgroundSize = `${mm(overlays.gridSizeMm)} ${mm(overlays.gridSizeMm)}`;
    layer.append(grid);
  }

  if (overlays.margins) {
    const box = document.createElement('div');
    box.className = 'pn-overlay pn-overlay--margins';
    box.style.left = mm(project.margins.leftMm);
    box.style.top = mm(project.margins.topMm);
    box.style.right = mm(project.margins.rightMm);
    box.style.bottom = mm(project.margins.bottomMm);
    layer.append(box);
  }

  if (overlays.safeArea && project.settings.marks.safeAreaMm > 0) {
    const safe = document.createElement('div');
    safe.className = 'pn-overlay pn-overlay--safe';
    const inset = mm(project.settings.marks.safeAreaMm);
    safe.style.inset = inset;
    layer.append(safe);
  }

  if (overlays.bleed && project.settings.marks.bleedMm > 0) {
    const bleed = document.createElement('div');
    bleed.className = 'pn-overlay pn-overlay--bleed';
    const outset = mm(-project.settings.marks.bleedMm);
    bleed.style.inset = outset;
    layer.append(bleed);
  }

  return layer;
}

function renderMadeAtHomeStamp(project: Project): HTMLElement {
  const stamp = document.createElement('div');
  stamp.className = 'pn-stamp';
  stamp.style.right = mm(Math.max(4, project.margins.rightMm));
  stamp.style.bottom = mm(Math.max(4, project.margins.bottomMm));
  stamp.textContent = 'Made at home';
  return stamp;
}

/* ------------------------------------------------------------------ *
 * Crop and trim marks
 * ------------------------------------------------------------------ */

export interface MarksOptions {
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** Trim rectangles to mark, in sheet coordinates. */
  trimBoxes: { xMm: number; yMm: number; widthMm: number; heightMm: number }[];
  bleedMm: number;
  markLengthMm: number;
  registration: boolean;
}

/**
 * Crop marks sit *outside* each trim box by the bleed distance, which is the
 * printing convention: you cut where the marks point, and the bleed is the
 * material that gets thrown away.
 */
export function renderCropMarks(options: MarksOptions): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pn-marks');
  svg.setAttribute('viewBox', `0 0 ${options.sheetWidthMm} ${options.sheetHeightMm}`);
  svg.setAttribute('width', mm(options.sheetWidthMm));
  svg.setAttribute('height', mm(options.sheetHeightMm));
  svg.setAttribute('aria-hidden', 'true');

  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    element.setAttribute('x1', String(x1));
    element.setAttribute('y1', String(y1));
    element.setAttribute('x2', String(x2));
    element.setAttribute('y2', String(y2));
    element.setAttribute('stroke', '#171717');
    element.setAttribute('stroke-width', '0.2');
    svg.append(element);
  };

  const gap = options.bleedMm;
  const length = options.markLengthMm;

  for (const box of options.trimBoxes) {
    const left = box.xMm;
    const right = box.xMm + box.widthMm;
    const top = box.yMm;
    const bottom = box.yMm + box.heightMm;

    // Horizontal arms at each corner.
    line(left - gap - length, top, left - gap, top);
    line(right + gap, top, right + gap + length, top);
    line(left - gap - length, bottom, left - gap, bottom);
    line(right + gap, bottom, right + gap + length, bottom);
    // Vertical arms.
    line(left, top - gap - length, left, top - gap);
    line(right, top - gap - length, right, top - gap);
    line(left, bottom + gap, left, bottom + gap + length);
    line(right, bottom + gap, right, bottom + gap + length);
  }

  if (options.registration) {
    for (const [cx, cy] of [
      [options.sheetWidthMm / 2, 4],
      [options.sheetWidthMm / 2, options.sheetHeightMm - 4],
    ] as const) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', '1.6');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#171717');
      circle.setAttribute('stroke-width', '0.2');
      svg.append(circle);
      line(cx - 3, cy, cx + 3, cy);
      line(cx, cy - 3, cx, cy + 3);
    }
  }

  return svg;
}
