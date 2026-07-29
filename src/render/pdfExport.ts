import {
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { imposeProject } from '../core/imposition.ts';
import type { ImpositionResult, PrintSheet } from '../core/imposition.ts';
import { planPoster } from '../core/poster.ts';
import { projectSheet } from '../core/project.ts';
import type {
  ImageElement,
  Page,
  PageNumberElement,
  Project,
  ShapeElement,
  TextElement,
} from '../core/types.ts';
import { PT_PER_INCH, mmToPt } from '../core/units.ts';
import type { DecodedImage } from './canvasRender.ts';
import { decodeProjectImages, rasterizeImageElement, releaseImages } from './canvasRender.ts';
import { alignOffset, wrapText } from './textLayout.ts';

/**
 * PDF export.
 *
 * Text and shapes are written as **vectors**, so the result stays sharp at any
 * zoom, prints crisply and stays small. Images are rasterised at the requested
 * DPI, because that is the only honest way to reproduce cropping, fitting and
 * the ink-saving transforms exactly as the screen shows them.
 *
 * Page geometry is preserved precisely: a PDF page is created at the project's
 * paper size in points, so opening the file anywhere and printing at 100 %
 * gives the same physical result.
 *
 * ## Coordinate systems
 *
 * PDF is y-up with the origin bottom-left; the document model is y-down with
 * the origin top-left, in millimetres. Rather than convert every value by
 * hand, each slot pushes a transformation matrix that makes the local space
 * "millimetres, y-up, origin at the page's bottom-left corner" — so a single
 * `pageHeightMm - y - height` flip is the only conversion in the element code.
 */

/** Points per millimetre. */
const K = PT_PER_INCH / 25.4;

export type PdfLayout = 'pages' | 'sheets';

export interface PdfExportOptions {
  project: Project;
  /** `pages` writes the reading order; `sheets` writes the imposed sheets. */
  layout: PdfLayout;
  /** Raster resolution for images. */
  dpi?: number;
  /** Include fold and cut guides on imposed sheets. */
  includeGuides?: boolean;
  /** Progress callback, 0–1. */
  onProgress?: (fraction: number, label: string) => void;
}

export interface PdfFonts {
  sans: PDFFont;
  sansBold: PDFFont;
  sansItalic: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
  serifItalic: PDFFont;
  mono: PDFFont;
}

export async function exportPdf(options: PdfExportOptions): Promise<Blob> {
  const { project } = options;
  const dpi = options.dpi ?? 300;
  const doc = await PDFDocument.create();

  doc.setTitle(project.name || 'PrintNest project');
  doc.setProducer('PrintNest by Storitellah');
  doc.setCreator('PrintNest');
  doc.setCreationDate(new Date());
  if (project.description) doc.setSubject(project.description);

  const fonts = await embedFonts(doc);
  const images = await decodeProjectImages(project);
  const imageCache = new Map<string, { ref: Awaited<ReturnType<PDFDocument['embedPng']>> }>();

  try {
    if (project.kind === 'poster') {
      await writePosterPages(doc, project, images, dpi, options.onProgress);
    } else if (options.layout === 'sheets') {
      const result = imposeProject(project);
      await writeSheetPages(doc, project, result, fonts, images, imageCache, dpi, options);
    } else {
      await writeReadingOrderPages(doc, project, fonts, images, imageCache, dpi, options);
    }

    const bytes = await doc.save({ useObjectStreams: true });
    // `bytes` is a Uint8Array over an exactly-sized buffer.
    return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  } finally {
    releaseImages(images);
  }
}

async function embedFonts(doc: PDFDocument): Promise<PdfFonts> {
  // The 14 standard PDF fonts need no embedding, keep the file small, and are
  // present in every PDF reader — which matters for an offline-first tool.
  const [sans, sansBold, sansItalic, serif, serifBold, serifItalic, mono] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.TimesRomanBold),
    doc.embedFont(StandardFonts.TimesRomanItalic),
    doc.embedFont(StandardFonts.Courier),
  ]);
  return { sans, sansBold, sansItalic, serif, serifBold, serifItalic, mono };
}

/* ------------------------------------------------------------------ *
 * Page writers
 * ------------------------------------------------------------------ */

type ImageCache = Map<string, { ref: Awaited<ReturnType<PDFDocument['embedPng']>> }>;

async function writeReadingOrderPages(
  doc: PDFDocument,
  project: Project,
  fonts: PdfFonts,
  images: Map<string, DecodedImage>,
  cache: ImageCache,
  dpi: number,
  options: PdfExportOptions,
): Promise<void> {
  const widthPt = mmToPt(project.pageWidthMm);
  const heightPt = mmToPt(project.pageHeightMm);

  for (let index = 0; index < project.pages.length; index += 1) {
    const pdfPage = doc.addPage([widthPt, heightPt]);
    // Local space = millimetres, y-up, origin at the page's bottom-left.
    pdfPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(K, 0, 0, K, 0, 0));
    await drawPageContent(doc, pdfPage, project, project.pages[index]!, index, fonts, images, cache, dpi);
    pdfPage.pushOperators(popGraphicsState());
    options.onProgress?.((index + 1) / project.pages.length, `Page ${index + 1}`);
  }
}

async function writeSheetPages(
  doc: PDFDocument,
  project: Project,
  result: ImpositionResult,
  fonts: PdfFonts,
  images: Map<string, DecodedImage>,
  cache: ImageCache,
  dpi: number,
  options: PdfExportOptions,
): Promise<void> {
  const widthPt = mmToPt(result.sheetSize.widthMm);
  const heightPt = mmToPt(result.sheetSize.heightMm);

  for (let index = 0; index < result.sheets.length; index += 1) {
    const sheet = result.sheets[index]!;
    const pdfPage = doc.addPage([widthPt, heightPt]);

    for (const slot of sheet.slots) {
      if (slot.pageIndex === null) continue;
      const page = project.pages[slot.pageIndex];
      if (!page) continue;

      const scale = slot.rect.widthMm / project.pageWidthMm;
      pushSlotTransform(pdfPage, slot.rect, slot.rotation, scale, result.sheetSize.heightMm, project);
      await drawPageContent(doc, pdfPage, project, page, slot.pageIndex, fonts, images, cache, dpi);
      pdfPage.pushOperators(popGraphicsState());
    }

    if (options.includeGuides ?? project.settings.imposition.foldMarks) {
      drawGuides(pdfPage, sheet, result.sheetSize.heightMm);
    }

    options.onProgress?.((index + 1) / result.sheets.length, sheet.label);
  }
}

/**
 * Push a matrix mapping page-local millimetres (y-up, origin bottom-left of
 * the page) into the sheet's PDF space, honouring the slot's position,
 * rotation and scale.
 */
function pushSlotTransform(
  pdfPage: PDFPage,
  rect: { xMm: number; yMm: number; widthMm: number; heightMm: number },
  rotation: number,
  scale: number,
  sheetHeightMm: number,
  project: Project,
): void {
  const centreXPt = mmToPt(rect.xMm + rect.widthMm / 2);
  const centreYPt = mmToPt(sheetHeightMm - (rect.yMm + rect.heightMm / 2));
  // Screen rotation is clockwise; PDF rotation is counter-clockwise.
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const s = scale * K;

  pdfPage.pushOperators(
    pushGraphicsState(),
    // 1. Move to the slot centre.
    concatTransformationMatrix(1, 0, 0, 1, centreXPt, centreYPt),
    // 2. Rotate about it.
    concatTransformationMatrix(cos, sin, -sin, cos, 0, 0),
    // 3. Scale millimetres to points, including the imposition scale.
    concatTransformationMatrix(s, 0, 0, s, 0, 0),
    // 4. Shift so the page's bottom-left corner is the local origin.
    concatTransformationMatrix(1, 0, 0, 1, -project.pageWidthMm / 2, -project.pageHeightMm / 2),
  );
}

/* ------------------------------------------------------------------ *
 * Element drawing
 * ------------------------------------------------------------------ */

async function drawPageContent(
  doc: PDFDocument,
  pdfPage: PDFPage,
  project: Project,
  page: Page,
  pageIndex: number,
  fonts: PdfFonts,
  images: Map<string, DecodedImage>,
  cache: ImageCache,
  dpi: number,
): Promise<void> {
  const height = project.pageHeightMm;
  const ink = project.settings.ink;

  const background =
    ink.enabled && ink.removeBackgrounds ? '#FFFFFF' : page.backgroundColor;
  if (background && background.toUpperCase() !== '#FFFFFF') {
    pdfPage.drawRectangle({
      x: 0,
      y: 0,
      width: project.pageWidthMm,
      height,
      color: hexToRgb(background),
    });
  }

  for (const element of page.elements) {
    if (element.hidden) continue;

    // y-down to y-up, per element.
    const y = height - element.yMm - element.heightMm;
    const rotate = element.rotation ? degrees(-element.rotation) : undefined;

    switch (element.type) {
      case 'image':
        await drawPdfImage(doc, pdfPage, element, project, images, cache, dpi, y, rotate);
        break;
      case 'text':
        drawPdfText(pdfPage, element, fonts, height);
        break;
      case 'shape':
        drawPdfShape(pdfPage, element, y, rotate);
        break;
      case 'page-number':
        drawPdfPageNumber(pdfPage, element, project, pageIndex, fonts, height);
        break;
    }
  }
}

async function drawPdfImage(
  doc: PDFDocument,
  pdfPage: PDFPage,
  element: ImageElement,
  project: Project,
  images: Map<string, DecodedImage>,
  cache: ImageCache,
  dpi: number,
  y: number,
  rotate: ReturnType<typeof degrees> | undefined,
): Promise<void> {
  // Unfilled template slots contribute nothing to the printed output.
  if (!element.assetId) return;
  const asset = project.assets.find((entry) => entry.id === element.assetId);
  const decoded = images.get(element.assetId);
  if (!asset || !decoded) return;

  if (element.matteColor) {
    pdfPage.drawRectangle({
      x: element.xMm,
      y,
      width: element.widthMm,
      height: element.heightMm,
      color: hexToRgb(element.matteColor),
      ...(rotate ? { rotate } : {}),
    });
  }

  // Cache on the element's visual identity so repeated placements of the same
  // photograph at the same size embed once.
  const cacheKey = [
    element.assetId,
    element.widthMm.toFixed(3),
    element.heightMm.toFixed(3),
    element.fit,
    element.scale.toFixed(3),
    element.offsetXMm.toFixed(3),
    element.offsetYMm.toFixed(3),
    element.imageRotation,
    element.flipH,
    element.flipV,
    element.crop ? `${element.crop.x},${element.crop.y},${element.crop.width},${element.crop.height}` : 'none',
    element.borderMm.toFixed(3),
    element.cornerRadiusMm.toFixed(3),
    dpi,
  ].join('|');

  let entry = cache.get(cacheKey);
  if (!entry) {
    const raster = await rasterizeImageElement(element, asset, decoded, project, dpi);
    if (!raster) return;
    const bytes = new Uint8Array(await raster.blob.arrayBuffer());
    const ref =
      raster.blob.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    entry = { ref };
    cache.set(cacheKey, entry);
  }

  pdfPage.drawImage(entry.ref, {
    x: element.xMm,
    y,
    width: element.widthMm,
    height: element.heightMm,
    opacity: element.opacity < 1 ? element.opacity : undefined,
    ...(rotate ? { rotate } : {}),
  });

  if (element.borderMm > 0) {
    pdfPage.drawRectangle({
      x: element.xMm + element.borderMm / 2,
      y: y + element.borderMm / 2,
      width: element.widthMm - element.borderMm,
      height: element.heightMm - element.borderMm,
      borderColor: hexToRgb(element.borderColor),
      borderWidth: element.borderMm,
      ...(rotate ? { rotate } : {}),
    });
  }
}

function pickFont(element: TextElement | PageNumberElement, fonts: PdfFonts): PDFFont {
  const bold = 'bold' in element ? element.bold : false;
  const italic = 'italic' in element ? element.italic : false;
  switch (element.font) {
    case 'serif':
      return bold ? fonts.serifBold : italic ? fonts.serifItalic : fonts.serif;
    case 'mono':
      return fonts.mono;
    default:
      return bold ? fonts.sansBold : italic ? fonts.sansItalic : fonts.sans;
  }
}

function drawPdfText(
  pdfPage: PDFPage,
  element: TextElement,
  fonts: PdfFonts,
  pageHeightMm: number,
): void {
  const font = pickFont(element, fonts);
  // The local space is millimetres, so a font size in points must be divided
  // by the points-per-millimetre factor to render at the right physical size.
  const sizeMm = element.sizePt / K;
  const lineHeightMm = sizeMm * element.lineHeight;

  const padding = element.paddingMm;
  const boxX = element.xMm + padding;
  const boxWidth = Math.max(1, element.widthMm - padding * 2);

  if (element.backgroundColor) {
    pdfPage.drawRectangle({
      x: element.xMm,
      y: pageHeightMm - element.yMm - element.heightMm,
      width: element.widthMm,
      height: element.heightMm,
      color: hexToRgb(element.backgroundColor),
    });
  }

  const text = element.uppercase ? element.text.toUpperCase() : element.text;
  const measure = (value: string): number => {
    const base = font.widthOfTextAtSize(sanitizeForStandardFont(value), sizeMm);
    return base + value.length * element.letterSpacing * sizeMm;
  };
  const { lines } = wrapText(text, boxWidth, measure);

  const colour = hexToRgb(element.color);
  let baselineY = pageHeightMm - element.yMm - padding - sizeMm * 0.82;

  for (const line of lines) {
    if (baselineY < pageHeightMm - element.yMm - element.heightMm - lineHeightMm) break;
    const safeLine = sanitizeForStandardFont(line);
    const width = measure(line);
    pdfPage.drawText(safeLine, {
      x: boxX + alignOffset(element.align, width, boxWidth),
      y: baselineY,
      size: sizeMm,
      font,
      color: colour,
      opacity: element.opacity < 1 ? element.opacity : undefined,
      ...(element.letterSpacing ? { wordBreaks: [] } : {}),
    });
    baselineY -= lineHeightMm;
  }
}

function drawPdfPageNumber(
  pdfPage: PDFPage,
  element: PageNumberElement,
  project: Project,
  pageIndex: number,
  fonts: PdfFonts,
  pageHeightMm: number,
): void {
  if (element.skipPages.includes(pageIndex)) return;
  const page = project.pages[pageIndex];
  if (page && (page.role === 'cover' || page.role === 'back-cover')) return;

  const font = pickFont(element, fonts);
  const sizeMm = element.sizePt / K;
  const text = sanitizeForStandardFont(
    element.format
      .replace('{n}', String(element.startAt + pageIndex))
      .replace('{total}', String(project.pages.length)),
  );
  const width = font.widthOfTextAtSize(text, sizeMm);

  pdfPage.drawText(text, {
    x: element.xMm + alignOffset(element.align, width, element.widthMm),
    y: pageHeightMm - element.yMm - sizeMm * 0.82,
    size: sizeMm,
    font,
    color: hexToRgb(element.color),
  });
}

function drawPdfShape(
  pdfPage: PDFPage,
  element: ShapeElement,
  y: number,
  rotate: ReturnType<typeof degrees> | undefined,
): void {
  const common = {
    opacity: element.opacity < 1 ? element.opacity : undefined,
    ...(rotate ? { rotate } : {}),
  };

  if (element.shape === 'line') {
    pdfPage.drawLine({
      start: { x: element.xMm, y: y + element.heightMm / 2 },
      end: { x: element.xMm + element.widthMm, y: y + element.heightMm / 2 },
      thickness: Math.max(0.05, element.strokeMm),
      color: hexToRgb(element.stroke ?? '#171717'),
      opacity: element.opacity < 1 ? element.opacity : undefined,
    });
    return;
  }

  if (element.shape === 'ellipse') {
    pdfPage.drawEllipse({
      x: element.xMm + element.widthMm / 2,
      y: y + element.heightMm / 2,
      xScale: element.widthMm / 2,
      yScale: element.heightMm / 2,
      ...(element.fill ? { color: hexToRgb(element.fill) } : {}),
      ...(element.stroke && element.strokeMm > 0
        ? { borderColor: hexToRgb(element.stroke), borderWidth: element.strokeMm }
        : {}),
      ...common,
    });
    return;
  }

  pdfPage.drawRectangle({
    x: element.xMm,
    y,
    width: element.widthMm,
    height: element.heightMm,
    ...(element.fill ? { color: hexToRgb(element.fill) } : {}),
    ...(element.stroke && element.strokeMm > 0
      ? { borderColor: hexToRgb(element.stroke), borderWidth: element.strokeMm }
      : {}),
    ...common,
  });
}

function drawGuides(pdfPage: PDFPage, sheet: PrintSheet, sheetHeightMm: number): void {
  pdfPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(K, 0, 0, K, 0, 0));
  for (const guide of sheet.guides) {
    const colour =
      guide.kind === 'slit'
        ? rgb(0.788, 0.29, 0.29)
        : guide.kind === 'cut'
          ? rgb(0.549, 0.529, 0.49)
          : rgb(0.706, 0.686, 0.647);
    pdfPage.drawLine({
      start: { x: guide.x1Mm, y: sheetHeightMm - guide.y1Mm },
      end: { x: guide.x2Mm, y: sheetHeightMm - guide.y2Mm },
      thickness: 0.25,
      color: colour,
      dashArray: guide.kind === 'slit' ? undefined : [2, 1.5],
    });
  }
  pdfPage.pushOperators(popGraphicsState());
}

/* ------------------------------------------------------------------ *
 * Poster
 * ------------------------------------------------------------------ */

async function writePosterPages(
  doc: PDFDocument,
  project: Project,
  images: Map<string, DecodedImage>,
  dpi: number,
  onProgress?: (fraction: number, label: string) => void,
): Promise<void> {
  const sheet = projectSheet(project);
  const settings = project.settings.poster;
  const plan = planPoster({
    posterWidthMm: settings.targetWidthMm,
    posterHeightMm: settings.targetHeightMm,
    sheet,
    margins: project.margins,
    overlapMm: settings.overlapMm,
    ...(settings.autoGrid ? {} : { columns: settings.columns, rows: settings.rows }),
  });

  const decoded = settings.assetId ? images.get(settings.assetId) : undefined;
  const widthPt = mmToPt(sheet.widthMm);
  const heightPt = mmToPt(sheet.heightMm);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < plan.tiles.length; index += 1) {
    const tile = plan.tiles[index]!;
    const pdfPage = doc.addPage([widthPt, heightPt]);
    pdfPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(K, 0, 0, K, 0, 0));

    if (decoded) {
      // Crop the poster down to this tile's slice at export resolution.
      const raster = await rasterizePosterTile(decoded, plan, tile, dpi);
      if (raster) {
        const bytes = new Uint8Array(await raster.arrayBuffer());
        const ref =
          raster.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        pdfPage.drawImage(ref, {
          x: tile.destXMm,
          y: sheet.heightMm - tile.destYMm - tile.destHeightMm,
          width: tile.destWidthMm,
          height: tile.destHeightMm,
        });
      }
    }

    if (settings.cutMarks) {
      const left = tile.destXMm;
      const right = tile.destXMm + tile.destWidthMm;
      const top = sheet.heightMm - tile.destYMm;
      const bottom = sheet.heightMm - tile.destYMm - tile.destHeightMm;
      const guide = rgb(0.549, 0.529, 0.49);
      for (const [start, end] of [
        [{ x: left, y: 0 }, { x: left, y: sheet.heightMm }],
        [{ x: right, y: 0 }, { x: right, y: sheet.heightMm }],
        [{ x: 0, y: top }, { x: sheet.widthMm, y: top }],
        [{ x: 0, y: bottom }, { x: sheet.widthMm, y: bottom }],
      ] as const) {
        pdfPage.drawLine({ start, end, thickness: 0.25, color: guide, dashArray: [1, 1.5] });
      }
    }

    if (settings.pageLabels) {
      pdfPage.drawText(`${tile.code}  ·  sheet ${tile.number} of ${plan.sheetCount}`, {
        x: tile.destXMm,
        y: sheet.heightMm - tile.destYMm + 2,
        size: 8 / K,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }

    pdfPage.pushOperators(popGraphicsState());
    onProgress?.((index + 1) / plan.tiles.length, `Tile ${tile.code}`);
  }
}

async function rasterizePosterTile(
  decoded: DecodedImage,
  plan: { posterWidthMm: number; posterHeightMm: number },
  tile: { sourceXMm: number; sourceYMm: number; sourceWidthMm: number; sourceHeightMm: number },
  dpi: number,
): Promise<Blob | null> {
  const { createCanvas, canvasToBlob } = await import('../core/assets.ts');
  const pxPerMm = dpi / 25.4;
  const widthPx = Math.max(1, Math.round(tile.sourceWidthMm * pxPerMm));
  const heightPx = Math.max(1, Math.round(tile.sourceHeightMm * pxPerMm));
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return null;

  // Map poster millimetres onto source pixels.
  const scaleX = decoded.widthPx / plan.posterWidthMm;
  const scaleY = decoded.heightPx / plan.posterHeightMm;

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    decoded.source,
    tile.sourceXMm * scaleX,
    tile.sourceYMm * scaleY,
    tile.sourceWidthMm * scaleX,
    tile.sourceHeightMm * scaleY,
    0,
    0,
    widthPx,
    heightPx,
  );
  return canvasToBlob(canvas, 'image/jpeg', 0.9);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function hexToRgb(color: string) {
  const hex = color.trim().replace('#', '');
  const expand = (value: string): number => Number.parseInt(value, 16) / 255;
  if (hex.length === 3) {
    return rgb(expand(hex[0]! + hex[0]!), expand(hex[1]! + hex[1]!), expand(hex[2]! + hex[2]!));
  }
  if (hex.length >= 6) {
    return rgb(expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6)));
  }
  const match = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (match) {
    return rgb(Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255);
  }
  return rgb(0.09, 0.09, 0.09);
}

/**
 * The standard PDF fonts are WinAnsi-encoded, so characters outside that set
 * would throw when drawn. Replace the common typographic offenders and drop
 * anything else rather than failing the whole export.
 */
export function sanitizeForStandardFont(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/ /g, ' ')
    // WinAnsi covers Latin-1 plus a handful of extras; strip the rest.
    .replace(/[^\x20-\x7E\xA0-\xFF€†‡‰]/g, '');
}
