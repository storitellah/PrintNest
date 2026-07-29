import { inchToMm, roundTo } from './units.ts';

/**
 * Paper catalogue.
 *
 * Sizes are stored portrait-first (width <= height) and rotated on demand, so
 * "A4 landscape" is never a separate entry that can drift out of sync.
 */

export type PaperGroup = 'iso-a' | 'iso-b' | 'north-america' | 'photo' | 'creative' | 'custom';

export interface PaperSize {
  id: string;
  name: string;
  group: PaperGroup;
  /** Portrait width in mm. */
  widthMm: number;
  /** Portrait height in mm. */
  heightMm: number;
  /** Shown next to the name, e.g. `4 × 6 in`. */
  note?: string;
}

export type Orientation = 'portrait' | 'landscape';

function inSize(
  id: string,
  name: string,
  group: PaperGroup,
  wIn: number,
  hIn: number,
): PaperSize {
  return {
    id,
    name,
    group,
    widthMm: roundTo(inchToMm(wIn), 2),
    heightMm: roundTo(inchToMm(hIn), 2),
    note: `${wIn} × ${hIn} in`,
  };
}

export const PAPER_SIZES: PaperSize[] = [
  // ISO A series.
  { id: 'a0', name: 'A0', group: 'iso-a', widthMm: 841, heightMm: 1189 },
  { id: 'a1', name: 'A1', group: 'iso-a', widthMm: 594, heightMm: 841 },
  { id: 'a2', name: 'A2', group: 'iso-a', widthMm: 420, heightMm: 594 },
  { id: 'a3', name: 'A3', group: 'iso-a', widthMm: 297, heightMm: 420 },
  { id: 'a4', name: 'A4', group: 'iso-a', widthMm: 210, heightMm: 297 },
  { id: 'a5', name: 'A5', group: 'iso-a', widthMm: 148, heightMm: 210 },
  { id: 'a6', name: 'A6', group: 'iso-a', widthMm: 105, heightMm: 148 },
  { id: 'a7', name: 'A7', group: 'iso-a', widthMm: 74, heightMm: 105 },

  // ISO B series.
  { id: 'b4', name: 'B4', group: 'iso-b', widthMm: 250, heightMm: 353 },
  { id: 'b5', name: 'B5', group: 'iso-b', widthMm: 176, heightMm: 250 },
  { id: 'b6', name: 'B6', group: 'iso-b', widthMm: 125, heightMm: 176 },

  // North America.
  inSize('letter', 'Letter', 'north-america', 8.5, 11),
  inSize('legal', 'Legal', 'north-america', 8.5, 14),
  inSize('tabloid', 'Tabloid', 'north-america', 11, 17),
  inSize('ledger', 'Ledger', 'north-america', 11, 17),
  inSize('half-letter', 'Half Letter', 'north-america', 5.5, 8.5),
  inSize('executive', 'Executive', 'north-america', 7.25, 10.5),

  // Photographic.
  inSize('photo-4x6', '4 × 6 in', 'photo', 4, 6),
  inSize('photo-5x7', '5 × 7 in', 'photo', 5, 7),
  inSize('photo-6x8', '6 × 8 in', 'photo', 6, 8),
  inSize('photo-8x10', '8 × 10 in', 'photo', 8, 10),
  inSize('photo-8x12', '8 × 12 in', 'photo', 8, 12),

  // Creative / stationery.
  { id: 'square-150', name: 'Square 150 mm', group: 'creative', widthMm: 150, heightMm: 150 },
  { id: 'square-200', name: 'Square 200 mm', group: 'creative', widthMm: 200, heightMm: 200 },
  { id: 'postcard', name: 'Postcard', group: 'creative', widthMm: 100, heightMm: 148, note: 'A6 postcard' },
  { id: 'business-card', name: 'Business card', group: 'creative', widthMm: 55, heightMm: 85 },
];

export const PAPER_GROUP_LABELS: Record<PaperGroup, string> = {
  'iso-a': 'ISO A series',
  'iso-b': 'ISO B series',
  'north-america': 'North America',
  photo: 'Photo sizes',
  creative: 'Creative sizes',
  custom: 'Custom sizes',
};

const PAPER_BY_ID = new Map(PAPER_SIZES.map((p) => [p.id, p]));

export function getPaperSize(id: string): PaperSize | undefined {
  return PAPER_BY_ID.get(id);
}

/** A concrete sheet: a paper size resolved through an orientation. */
export interface Sheet {
  widthMm: number;
  heightMm: number;
}

export function resolveSheet(paper: Sheet, orientation: Orientation): Sheet {
  if (orientation === 'landscape') {
    return { widthMm: paper.heightMm, heightMm: paper.widthMm };
  }
  return { widthMm: paper.widthMm, heightMm: paper.heightMm };
}

/** The orientation a sheet's own proportions imply. */
export function naturalOrientation(sheet: Sheet): Orientation {
  return sheet.widthMm > sheet.heightMm ? 'landscape' : 'portrait';
}

export interface Margins {
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
}

export function uniformMargins(mm: number): Margins {
  return { topMm: mm, rightMm: mm, bottomMm: mm, leftMm: mm };
}

/** The area left once margins are removed. Never returns negative extents. */
export function contentBox(sheet: Sheet, margins: Margins) {
  const width = Math.max(0, sheet.widthMm - margins.leftMm - margins.rightMm);
  const height = Math.max(0, sheet.heightMm - margins.topMm - margins.bottomMm);
  return { xMm: margins.leftMm, yMm: margins.topMm, widthMm: width, heightMm: height };
}

/**
 * Half of an A-series sheet, folded across the long edge — the geometry behind
 * every A4 → A5 booklet. Kept as a helper so the zine presets stay readable.
 */
export function halfSheet(sheet: Sheet): Sheet {
  return sheet.widthMm > sheet.heightMm
    ? { widthMm: sheet.widthMm / 2, heightMm: sheet.heightMm }
    : { widthMm: sheet.widthMm, heightMm: sheet.heightMm / 2 };
}

/** Quarter of a sheet (two folds) — the eight-page mini-zine cell. */
export function quarterSheet(sheet: Sheet): Sheet {
  return { widthMm: sheet.widthMm / 4, heightMm: sheet.heightMm / 2 };
}

export function describeSheet(sheet: Sheet): string {
  return `${roundTo(sheet.widthMm, 1)} × ${roundTo(sheet.heightMm, 1)} mm`;
}

/**
 * Find the catalogue entry matching a width/height in mm (either orientation),
 * within a 0.5 mm tolerance. Used when importing projects and PDFs so a page
 * that happens to be A4 is labelled "A4" rather than "Custom".
 */
export function matchPaperSize(widthMm: number, heightMm: number): PaperSize | undefined {
  const tolerance = 0.5;
  return PAPER_SIZES.find((p) => {
    const portrait =
      Math.abs(p.widthMm - widthMm) < tolerance && Math.abs(p.heightMm - heightMm) < tolerance;
    const landscape =
      Math.abs(p.heightMm - widthMm) < tolerance && Math.abs(p.widthMm - heightMm) < tolerance;
    return portrait || landscape;
  });
}
