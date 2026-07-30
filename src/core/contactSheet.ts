import { contentBox } from './paper.ts';
import { createImageElement, createPage, createTextElement } from './project.ts';
import { mmToPt } from './units.ts';
import type { AssetMeta, ContactSheetSettings, Page, Project } from './types.ts';

/**
 * Contact sheet and photo grid generation.
 *
 * Produces real pages of real elements rather than a special render path, so a
 * generated contact sheet can be edited afterwards like anything else.
 */

export interface ContactSheetPreset {
  id: string;
  name: string;
  description: string;
  settings: Partial<ContactSheetSettings>;
}

export const CONTACT_SHEET_PRESETS: ContactSheetPreset[] = [
  {
    id: 'photo-selection',
    name: 'Photo selection',
    description: 'Big thumbnails with numbers, for picking favourites.',
    settings: { columns: 3, rows: 4, showNumbers: true, showFileNames: false, gapMm: 5, fit: 'fit' },
  },
  {
    id: 'client-proof',
    name: 'Client proof sheet',
    description: 'File names under every frame so choices can be sent back by name.',
    settings: {
      columns: 4,
      rows: 5,
      showFileNames: true,
      showNumbers: true,
      showPageNumbers: true,
      captionSizePt: 6,
      fit: 'fit',
    },
  },
  {
    id: 'student-review',
    name: 'Student photography review',
    description: 'Room for written notes beside each frame.',
    settings: { columns: 3, rows: 3, gapMm: 8, showNumbers: true, showCaptions: true, fit: 'fit' },
  },
  {
    id: 'archive',
    name: 'Archive sheet',
    description: 'Dense grid with file names and dates for boxed prints.',
    settings: {
      columns: 5,
      rows: 6,
      gapMm: 2,
      showFileNames: true,
      showDates: true,
      showNumbers: true,
      captionSizePt: 5,
      fit: 'fit',
    },
  },
  {
    id: 'portfolio-review',
    name: 'Portfolio review',
    description: 'Few large images, generous white space.',
    settings: { columns: 2, rows: 2, gapMm: 10, showNumbers: false, showFileNames: false, fit: 'fit' },
  },
  {
    id: 'film-strip',
    name: 'Film-style contact sheet',
    description: 'Black background, tight frames, numbers in the gutter.',
    settings: {
      columns: 6,
      rows: 5,
      gapMm: 1.5,
      backgroundColor: '#171717',
      showNumbers: true,
      showFileNames: false,
      captionSizePt: 5,
      fit: 'fill',
    },
  },
];

export interface ContactSheetOptions {
  settings: ContactSheetSettings;
  pageWidthMm: number;
  pageHeightMm: number;
  margins: Project['margins'];
}

/** Build the pages for a contact sheet over `assets`. */
export function buildContactSheetPages(
  assets: AssetMeta[],
  options: ContactSheetOptions,
): Page[] {
  const { settings } = options;
  const box = contentBox(
    { widthMm: options.pageWidthMm, heightMm: options.pageHeightMm },
    options.margins,
  );

  const columns = Math.max(1, Math.round(settings.columns));
  const rows = Math.max(1, Math.round(settings.rows));
  const perPage = columns * rows;

  const headerHeightMm = settings.headerText ? 10 : 0;
  const footerHeightMm = settings.showPageNumbers ? 6 : 0;
  const gridTopMm = box.yMm + headerHeightMm;
  const gridHeightMm = Math.max(1, box.heightMm - headerHeightMm - footerHeightMm);

  // Caption height is derived from the text size so small captions do not
  // steal space from the images.
  const captionLines =
    (settings.showFileNames ? 1 : 0) +
    (settings.showDates ? 1 : 0) +
    (settings.showCaptions ? 2 : 0);
  const captionHeightMm = captionLines > 0 ? captionLines * (settings.captionSizePt * 0.42) + 1 : 0;

  const cellWidthMm = (box.widthMm - settings.gapMm * (columns - 1)) / columns;
  const cellHeightMm = (gridHeightMm - settings.gapMm * (rows - 1)) / rows;
  const frameHeightMm = Math.max(1, cellHeightMm - captionHeightMm);

  const pages: Page[] = [];
  const pageCount = Math.max(1, Math.ceil(assets.length / perPage));

  for (let pageNumber = 0; pageNumber < pageCount; pageNumber += 1) {
    const page = createPage({ backgroundColor: settings.backgroundColor });
    const onDark = isDark(settings.backgroundColor);
    const inkColor = onDark ? '#F5F0E7' : '#171717';

    if (settings.headerText) {
      page.elements.push(
        createTextElement(
          settings.headerText,
          { xMm: box.xMm, yMm: box.yMm, widthMm: box.widthMm, heightMm: 8 },
          { font: 'serif', sizePt: 12, align: 'left', color: inkColor },
        ),
      );
    }

    const slice = assets.slice(pageNumber * perPage, (pageNumber + 1) * perPage);
    slice.forEach((asset, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = box.xMm + column * (cellWidthMm + settings.gapMm);
      const cellY = gridTopMm + row * (cellHeightMm + settings.gapMm);

      const frame = fitFrame(asset, cellWidthMm, frameHeightMm, settings.fit);
      page.elements.push(
        createImageElement(
          asset.id,
          {
            xMm: cellX + (cellWidthMm - frame.widthMm) / 2,
            yMm: cellY,
            widthMm: frame.widthMm,
            heightMm: frame.heightMm,
          },
          {
            fit: settings.fit,
            borderMm: settings.borderMm,
            borderColor: settings.borderColor,
          },
        ),
      );

      const captionParts: string[] = [];
      const number = pageNumber * perPage + index + 1;
      if (settings.showNumbers) captionParts.push(String(number));
      if (settings.showFileNames) captionParts.push(asset.name);
      if (settings.showDates) captionParts.push(formatDate(asset.addedAt));

      if (captionParts.length > 0) {
        page.elements.push(
          createTextElement(
            captionParts.join('  ·  '),
            {
              xMm: cellX,
              yMm: cellY + frameHeightMm + 0.5,
              widthMm: cellWidthMm,
              heightMm: Math.max(2, captionHeightMm),
            },
            {
              font: 'sans',
              sizePt: settings.captionSizePt,
              align: 'center',
              color: onDark ? '#D9D5CE' : '#6B6B6B',
              lineHeight: 1.2,
            },
          ),
        );
      }
    });

    if (settings.showPageNumbers) {
      page.elements.push(
        createTextElement(
          `${pageNumber + 1} / ${pageCount}`,
          {
            xMm: box.xMm,
            yMm: box.yMm + box.heightMm - 4,
            widthMm: box.widthMm,
            heightMm: 4,
          },
          { font: 'sans', sizePt: 7, align: 'right', color: onDark ? '#D9D5CE' : '#6B6B6B' },
        ),
      );
    }

    pages.push(page);
  }

  return pages;
}

function fitFrame(
  asset: AssetMeta,
  maxWidthMm: number,
  maxHeightMm: number,
  fit: 'fit' | 'fill',
): { widthMm: number; heightMm: number } {
  if (fit === 'fill' || !asset.widthPx || !asset.heightPx) {
    return { widthMm: maxWidthMm, heightMm: maxHeightMm };
  }
  const ratio = asset.widthPx / asset.heightPx;
  const scale = Math.min(maxWidthMm / ratio, maxHeightMm);
  return { widthMm: ratio * scale, heightMm: scale };
}

function isDark(color: string): boolean {
  const hex = color.replace('#', '');
  if (hex.length < 6) return false;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return false;
  // Rec. 709 luma.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Caption font size in points, exposed for the settings panel readouts. */
export function captionPointSize(settings: ContactSheetSettings): number {
  return Math.round(mmToPt(settings.captionSizePt * 0.3528) * 10) / 10;
}
