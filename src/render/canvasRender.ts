import { canvasToBlob, createCanvas, getAssetBlob } from '../core/assets.ts';
import { inkFilter } from '../core/ink.ts';
import type { ImpositionResult, PrintSheet } from '../core/imposition.ts';
import { safeColor } from '../core/sanitize.ts';
import type {
  AssetMeta,
  ImageElement,
  Page,
  PageNumberElement,
  Project,
  ShapeElement,
  TextElement,
} from '../core/types.ts';
import { mmToPixelsAtDpi, mmToPt } from '../core/units.ts';
import { computeImageLayout } from './imageLayout.ts';
import { alignOffset, wrapText } from './textLayout.ts';

/**
 * Canvas rendering.
 *
 * Produces raster output for PNG/JPEG export and for the image portions of the
 * PDF export. It mirrors `pageRender.ts` element by element, working in
 * millimetres and scaling to the requested DPI at the top, so the same
 * geometry code (`computeImageLayout`) drives both paths.
 */

export const DEFAULT_EXPORT_DPI = 300;
export const PREVIEW_EXPORT_DPI = 96;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DecodedImage {
  source: CanvasImageSource;
  widthPx: number;
  heightPx: number;
  release: () => void;
}

/** Decode every image asset a project uses, once, for a whole export run. */
export async function decodeProjectImages(project: Project): Promise<Map<string, DecodedImage>> {
  const map = new Map<string, DecodedImage>();
  const needed = new Set<string>();
  for (const page of project.pages) {
    for (const element of page.elements) {
      if (element.type === 'image') needed.add(element.assetId);
    }
  }
  if (project.settings.poster.assetId) needed.add(project.settings.poster.assetId);

  for (const assetId of needed) {
    const decoded = await decodeAssetImage(assetId);
    if (decoded) map.set(assetId, decoded);
  }
  return map;
}

export async function decodeAssetImage(assetId: string): Promise<DecodedImage | null> {
  const blob = await getAssetBlob(assetId);
  if (!blob) return null;

  if (typeof createImageBitmap === 'function' && blob.type !== 'image/svg+xml') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        widthPx: bitmap.width,
        heightPx: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* fall through to the element path */
    }
  }

  if (typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({
        source: image,
        widthPx: image.naturalWidth,
        heightPx: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

export function releaseImages(images: Map<string, DecodedImage>): void {
  for (const image of images.values()) image.release();
  images.clear();
}

/* ------------------------------------------------------------------ *
 * Page rendering
 * ------------------------------------------------------------------ */

export interface DrawPageOptions {
  project: Project;
  page: Page;
  pageIndex: number;
  images: Map<string, DecodedImage>;
  /** Pixels per millimetre. */
  pxPerMm: number;
  /** Paint the page background; off when compositing onto a sheet. */
  paintBackground?: boolean;
}

/**
 * Draw a page into the current context at `pxPerMm`. The context origin must
 * already be at the page's top-left corner.
 */
export function drawPage(ctx: AnyContext, options: DrawPageOptions): void {
  const { project, page, pxPerMm } = options;

  ctx.save();
  ctx.scale(pxPerMm, pxPerMm);

  const ink = project.settings.ink;
  if (options.paintBackground !== false) {
    ctx.fillStyle =
      ink.enabled && ink.removeBackgrounds ? '#FFFFFF' : safeColor(page.backgroundColor, '#FFFFFF');
    ctx.fillRect(0, 0, project.pageWidthMm, project.pageHeightMm);
  }

  const filter = inkFilter(ink);
  if (filter && 'filter' in ctx) {
    (ctx as CanvasRenderingContext2D).filter = filter;
  }

  // Clip to the page so nothing bleeds onto a neighbouring slot.
  ctx.beginPath();
  ctx.rect(0, 0, project.pageWidthMm, project.pageHeightMm);
  ctx.clip();

  for (const element of page.elements) {
    if (element.hidden) continue;
    ctx.save();
    ctx.globalAlpha = element.opacity;
    if (element.rotation) {
      const cx = element.xMm + element.widthMm / 2;
      const cy = element.yMm + element.heightMm / 2;
      ctx.translate(cx, cy);
      ctx.rotate((element.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    switch (element.type) {
      case 'image':
        drawImageElement(ctx, element, options);
        break;
      case 'text':
        drawTextElement(ctx, element, project);
        break;
      case 'shape':
        drawShapeElement(ctx, element);
        break;
      case 'page-number':
        drawPageNumberElement(ctx, element, options);
        break;
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawImageElement(ctx: AnyContext, element: ImageElement, options: DrawPageOptions): void {
  const asset = options.project.assets.find((entry) => entry.id === element.assetId);
  const decoded = options.images.get(element.assetId);

  if (element.matteColor) {
    ctx.fillStyle = safeColor(element.matteColor, '#FFFFFF');
    ctx.fillRect(element.xMm, element.yMm, element.widthMm, element.heightMm);
  }

  // An unfilled template slot prints as nothing at all — never as a box.
  if (!element.assetId) return;

  if (!decoded || !asset) {
    // A frame whose file has gone missing: mark it so the loss is visible.
    ctx.strokeStyle = '#C94A4A';
    ctx.lineWidth = 0.3;
    ctx.strokeRect(element.xMm, element.yMm, element.widthMm, element.heightMm);
    return;
  }

  const border = element.borderMm;
  const innerX = element.xMm + border;
  const innerY = element.yMm + border;
  const innerWidth = Math.max(0.1, element.widthMm - border * 2);
  const innerHeight = Math.max(0.1, element.heightMm - border * 2);

  const layout = computeImageLayout({
    element: { ...element, widthMm: innerWidth, heightMm: innerHeight },
    naturalWidthPx: decoded.widthPx,
    naturalHeightPx: decoded.heightPx,
  });

  ctx.save();
  ctx.beginPath();
  if (element.cornerRadiusMm > 0) {
    roundedRectPath(ctx, innerX, innerY, innerWidth, innerHeight, element.cornerRadiusMm);
  } else {
    ctx.rect(innerX, innerY, innerWidth, innerHeight);
  }
  ctx.clip();

  const ink = options.project.settings.ink;
  if (ink.enabled && ink.imageDensity < 1) {
    ctx.globalAlpha *= Math.max(0.35, ink.imageDensity);
  }

  // Move to the centre of the placed footprint, apply the image's own rotation
  // and flips, then draw the (possibly cropped) source.
  const centreX = innerX + layout.footprintXMm + layout.footprintWidthMm / 2;
  const centreY = innerY + layout.footprintYMm + layout.footprintHeightMm / 2;
  ctx.translate(centreX, centreY);
  if (layout.rotationDeg) ctx.rotate((layout.rotationDeg * Math.PI) / 180);
  if (layout.scaleX !== 1 || layout.scaleY !== 1) ctx.scale(layout.scaleX, layout.scaleY);

  const crop = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sourceX = crop.x * decoded.widthPx;
  const sourceY = crop.y * decoded.heightPx;
  const sourceWidth = crop.width * decoded.widthPx;
  const sourceHeight = crop.height * decoded.heightPx;

  ctx.drawImage(
    decoded.source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    -layout.preWidthMm / 2,
    -layout.preHeightMm / 2,
    layout.preWidthMm,
    layout.preHeightMm,
  );
  ctx.restore();

  if (border > 0) {
    ctx.strokeStyle = safeColor(element.borderColor, '#171717');
    ctx.lineWidth = border;
    ctx.strokeRect(
      element.xMm + border / 2,
      element.yMm + border / 2,
      element.widthMm - border,
      element.heightMm - border,
    );
  }
}

function drawTextElement(ctx: AnyContext, element: TextElement, project: Project): void {
  const ink = project.settings.ink;
  if (element.backgroundColor && !(ink.enabled && ink.removeBackgrounds)) {
    ctx.fillStyle = safeColor(element.backgroundColor, 'transparent');
    ctx.fillRect(element.xMm, element.yMm, element.widthMm, element.heightMm);
  }

  const padding = element.paddingMm;
  const boxX = element.xMm + padding;
  const boxY = element.yMm + padding;
  const boxWidth = Math.max(1, element.widthMm - padding * 2);

  // Points to millimetres: the context is scaled so 1 unit = 1 mm.
  const sizeMm = (element.sizePt / 72) * 25.4;
  const lineHeightMm = sizeMm * element.lineHeight;

  ctx.font = canvasFont(element, sizeMm);
  ctx.fillStyle = safeColor(element.color, '#171717');
  ctx.textBaseline = 'alphabetic';

  const text = element.uppercase ? element.text.toUpperCase() : element.text;
  const { lines } = wrapText(text, boxWidth, (value) => ctx.measureText(value).width);

  // Ascender offset: place the first baseline inside the box rather than on it.
  let y = boxY + sizeMm * 0.82;
  for (const line of lines) {
    const width = ctx.measureText(line).width;
    ctx.fillText(line, boxX + alignOffset(element.align, width, boxWidth), y);
    y += lineHeightMm;
    if (y > element.yMm + element.heightMm + lineHeightMm) break;
  }
}

function drawPageNumberElement(
  ctx: AnyContext,
  element: PageNumberElement,
  options: DrawPageOptions,
): void {
  const { project, pageIndex } = options;
  if (element.skipPages.includes(pageIndex)) return;
  const page = project.pages[pageIndex];
  if (page && (page.role === 'cover' || page.role === 'back-cover')) return;

  const text = element.format
    .replace('{n}', String(element.startAt + pageIndex))
    .replace('{total}', String(project.pages.length));

  const sizeMm = (element.sizePt / 72) * 25.4;
  ctx.font = `${sizeMm}px ${fontStack(element.font)}`;
  ctx.fillStyle = safeColor(element.color, '#6B6B6B');
  ctx.textBaseline = 'alphabetic';
  const width = ctx.measureText(text).width;
  ctx.fillText(
    text,
    element.xMm + alignOffset(element.align, width, element.widthMm),
    element.yMm + sizeMm * 0.82,
  );
}

function drawShapeElement(ctx: AnyContext, element: ShapeElement): void {
  if (element.shape === 'line') {
    ctx.strokeStyle = safeColor(element.stroke ?? '#171717', '#171717');
    ctx.lineWidth = Math.max(0.05, element.strokeMm);
    ctx.beginPath();
    const y = element.yMm + element.heightMm / 2;
    ctx.moveTo(element.xMm, y);
    ctx.lineTo(element.xMm + element.widthMm, y);
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  if (element.shape === 'ellipse') {
    ctx.ellipse(
      element.xMm + element.widthMm / 2,
      element.yMm + element.heightMm / 2,
      element.widthMm / 2,
      element.heightMm / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else if (element.cornerRadiusMm > 0) {
    roundedRectPath(ctx, element.xMm, element.yMm, element.widthMm, element.heightMm, element.cornerRadiusMm);
  } else {
    ctx.rect(element.xMm, element.yMm, element.widthMm, element.heightMm);
  }

  if (element.fill) {
    ctx.fillStyle = safeColor(element.fill, 'transparent');
    ctx.fill();
  }
  if (element.stroke && element.strokeMm > 0) {
    ctx.strokeStyle = safeColor(element.stroke, '#171717');
    ctx.lineWidth = element.strokeMm;
    ctx.stroke();
  }
}

function roundedRectPath(
  ctx: AnyContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

export function fontStack(font: 'sans' | 'serif' | 'mono'): string {
  switch (font) {
    case 'serif':
      return '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
    case 'mono':
      return 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
    default:
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  }
}

function canvasFont(element: TextElement, sizeMm: number): string {
  const style = element.italic ? 'italic ' : '';
  const weight = element.bold ? '600 ' : '';
  return `${style}${weight}${sizeMm}px ${fontStack(element.font)}`;
}

/* ------------------------------------------------------------------ *
 * Whole-page and whole-sheet rasterisation
 * ------------------------------------------------------------------ */

export interface RasterOptions {
  project: Project;
  images: Map<string, DecodedImage>;
  dpi: number;
}

/** Rasterise one document page at `dpi`. */
export function rasterizePage(
  page: Page,
  pageIndex: number,
  options: RasterOptions,
): AnyCanvas | null {
  const { project, dpi } = options;
  const widthPx = Math.max(1, Math.round(mmToPixelsAtDpi(project.pageWidthMm, dpi)));
  const heightPx = Math.max(1, Math.round(mmToPixelsAtDpi(project.pageHeightMm, dpi)));
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d') as AnyContext | null;
  if (!ctx) return null;

  ctx.imageSmoothingQuality = 'high';
  drawPage(ctx, {
    project,
    page,
    pageIndex,
    images: options.images,
    pxPerMm: dpi / 25.4,
  });
  return canvas;
}

/** Rasterise one imposed print sheet at `dpi`. */
export function rasterizeSheet(
  sheet: PrintSheet,
  result: ImpositionResult,
  options: RasterOptions,
): AnyCanvas | null {
  const { project, dpi } = options;
  const pxPerMm = dpi / 25.4;
  const widthPx = Math.max(1, Math.round(result.sheetSize.widthMm * pxPerMm));
  const heightPx = Math.max(1, Math.round(result.sheetSize.heightMm * pxPerMm));
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d') as AnyContext | null;
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.imageSmoothingQuality = 'high';

  for (const slot of sheet.slots) {
    if (slot.pageIndex === null) continue;
    const page = project.pages[slot.pageIndex];
    if (!page) continue;

    const scale = slot.rect.widthMm / project.pageWidthMm;
    ctx.save();
    // Rotate about the slot centre, then move to the page's top-left corner.
    const centreXmm = slot.rect.xMm + slot.rect.widthMm / 2;
    const centreYmm = slot.rect.yMm + slot.rect.heightMm / 2;
    ctx.translate(centreXmm * pxPerMm, centreYmm * pxPerMm);
    if (slot.rotation) ctx.rotate((slot.rotation * Math.PI) / 180);
    ctx.translate(
      (-project.pageWidthMm * scale * pxPerMm) / 2,
      (-project.pageHeightMm * scale * pxPerMm) / 2,
    );

    drawPage(ctx, {
      project,
      page,
      pageIndex: slot.pageIndex,
      images: options.images,
      pxPerMm: pxPerMm * scale,
    });
    ctx.restore();
  }

  drawSheetGuides(ctx, sheet, pxPerMm);
  return canvas;
}

function drawSheetGuides(ctx: AnyContext, sheet: PrintSheet, pxPerMm: number): void {
  for (const guide of sheet.guides) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(guide.x1Mm * pxPerMm, guide.y1Mm * pxPerMm);
    ctx.lineTo(guide.x2Mm * pxPerMm, guide.y2Mm * pxPerMm);
    ctx.lineWidth = Math.max(1, 0.25 * pxPerMm);
    switch (guide.kind) {
      case 'fold':
        ctx.strokeStyle = '#B4AFA5';
        ctx.setLineDash([3 * pxPerMm, 2 * pxPerMm]);
        break;
      case 'slit':
        ctx.strokeStyle = '#C94A4A';
        break;
      case 'cut':
        ctx.strokeStyle = '#8C877D';
        ctx.setLineDash([1 * pxPerMm, 1.5 * pxPerMm]);
        break;
      default:
        ctx.strokeStyle = '#3D66F5';
        break;
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Encode a canvas, choosing a sensible default quality per format. */
export async function encodeCanvas(
  canvas: AnyCanvas,
  format: 'png' | 'jpeg',
  quality = 0.92,
): Promise<Blob | null> {
  return canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', quality);
}

/**
 * Rasterise a single image element to a blob at print resolution — used by the
 * PDF exporter, which draws text as vectors but images as pixels.
 */
export async function rasterizeImageElement(
  element: ImageElement,
  asset: AssetMeta,
  decoded: DecodedImage,
  project: Project,
  dpi: number,
): Promise<{ blob: Blob; widthPx: number; heightPx: number } | null> {
  const pxPerMm = dpi / 25.4;
  const widthPx = Math.max(1, Math.round(element.widthMm * pxPerMm));
  const heightPx = Math.max(1, Math.round(element.heightMm * pxPerMm));
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d') as AnyContext | null;
  if (!ctx) return null;

  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.scale(pxPerMm, pxPerMm);
  // Draw at the origin: the element is positioned by the PDF layer.
  drawImageElement(
    ctx,
    { ...element, xMm: 0, yMm: 0, rotation: 0 },
    {
      project,
      page: { id: '', name: '', backgroundColor: '#FFFFFF', elements: [], intentionallyBlank: false, role: 'content' },
      pageIndex: 0,
      images: new Map([[element.assetId, decoded]]),
      pxPerMm,
    },
  );
  ctx.restore();

  // JPEG for opaque photographs, PNG when transparency or vector edges matter.
  const wantsAlpha =
    asset.type === 'image/png' || asset.type === 'image/svg+xml' || asset.type === 'image/webp';
  const blob = await canvasToBlob(
    canvas,
    wantsAlpha ? 'image/png' : 'image/jpeg',
    0.92,
  );
  return blob ? { blob, widthPx, heightPx } : null;
}

/** Point size of a text element, exposed for the PDF exporter. */
export function textSizePt(element: TextElement): number {
  return element.sizePt;
}

/** Millimetres to points, re-exported so exporters share one conversion. */
export { mmToPt };
