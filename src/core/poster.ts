import { contentBox } from './paper.ts';
import type { Margins, Sheet } from './paper.ts';
import { roundTo } from './units.ts';

/**
 * Poster tiling.
 *
 * Splits one large image across a grid of home-printer sheets. Adjacent tiles
 * share an `overlap` band so the sheets can be glued or taped with a little
 * tolerance rather than needing a perfect butt joint.
 *
 * All maths is in millimetres of *finished poster*; the renderer maps a tile's
 * source rectangle onto its sheet.
 */

export interface PosterTile {
  /** 0-based grid position. */
  column: number;
  row: number;
  /** Sheet number in print order, 1-based, reading left-to-right, top-to-bottom. */
  number: number;
  /** `A1`, `B2` … used on the printed page labels and the assembly map. */
  code: string;
  /**
   * The slice of the poster this sheet carries, in poster millimetres,
   * including the overlap band.
   */
  sourceXMm: number;
  sourceYMm: number;
  sourceWidthMm: number;
  sourceHeightMm: number;
  /** Where that slice is drawn on the sheet, in sheet millimetres. */
  destXMm: number;
  destYMm: number;
  destWidthMm: number;
  destHeightMm: number;
  /** Edges that carry an overlap band, for the "glue this side" guides. */
  overlapEdges: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

export interface PosterPlan {
  columns: number;
  rows: number;
  tiles: PosterTile[];
  /** Actual finished size once the overlaps are accounted for. */
  posterWidthMm: number;
  posterHeightMm: number;
  overlapMm: number;
  sheetCount: number;
  /** Printable area per sheet, i.e. the usable tile size. */
  usableWidthMm: number;
  usableHeightMm: number;
  instructions: string[];
}

export interface PosterOptions {
  posterWidthMm: number;
  posterHeightMm: number;
  sheet: Sheet;
  margins: Margins;
  overlapMm: number;
  /** When set, use exactly this grid instead of deriving one. */
  columns?: number;
  rows?: number;
}

const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** How many sheets, at minimum, cover `posterMm` given the usable tile size. */
export function tilesNeeded(posterMm: number, usableMm: number, overlapMm: number): number {
  const effective = usableMm - overlapMm;
  if (effective <= 0) return 1;
  // The first tile contributes its full width; each subsequent one adds
  // `usable - overlap`.
  return Math.max(1, Math.ceil((posterMm - overlapMm) / effective));
}

/**
 * Build the tiling plan.
 *
 * When `columns`/`rows` are supplied the poster is *scaled to fit* that grid,
 * which is what the "print across 4 sheets" presets do. Otherwise the grid is
 * derived from the requested finished size.
 */
export function planPoster(options: PosterOptions): PosterPlan {
  const box = contentBox(options.sheet, options.margins);
  const usableWidthMm = Math.max(1, box.widthMm);
  const usableHeightMm = Math.max(1, box.heightMm);
  const overlapMm = Math.max(0, Math.min(options.overlapMm, Math.min(usableWidthMm, usableHeightMm) / 3));

  let columns: number;
  let rows: number;
  let posterWidthMm = options.posterWidthMm;
  let posterHeightMm = options.posterHeightMm;

  if (options.columns && options.rows) {
    columns = Math.max(1, Math.round(options.columns));
    rows = Math.max(1, Math.round(options.rows));
    // Fit the requested poster proportions into the fixed grid.
    const gridWidthMm = columns * usableWidthMm - (columns - 1) * overlapMm;
    const gridHeightMm = rows * usableHeightMm - (rows - 1) * overlapMm;
    const scale = Math.min(gridWidthMm / posterWidthMm, gridHeightMm / posterHeightMm);
    posterWidthMm *= scale;
    posterHeightMm *= scale;
  } else {
    columns = tilesNeeded(posterWidthMm, usableWidthMm, overlapMm);
    rows = tilesNeeded(posterHeightMm, usableHeightMm, overlapMm);
  }

  // Distribute the poster evenly: each tile carries an equal share plus the
  // overlap band on the sides that have a neighbour.
  const stepXMm = columns > 1 ? (posterWidthMm - overlapMm) / columns : posterWidthMm;
  const stepYMm = rows > 1 ? (posterHeightMm - overlapMm) / rows : posterHeightMm;

  const tiles: PosterTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const hasLeft = column > 0;
      const hasTop = row > 0;
      const hasRight = column < columns - 1;
      const hasBottom = row < rows - 1;

      const sourceXMm = column * stepXMm;
      const sourceYMm = row * stepYMm;
      const sourceWidthMm = Math.min(stepXMm + overlapMm, posterWidthMm - sourceXMm);
      const sourceHeightMm = Math.min(stepYMm + overlapMm, posterHeightMm - sourceYMm);

      // The slice is drawn at 1:1 inside the printable box, top-left aligned so
      // the overlap band always lands on the same physical edge.
      tiles.push({
        column,
        row,
        number: row * columns + column + 1,
        code: `${COLUMN_LETTERS[column % 26] ?? '?'}${row + 1}`,
        sourceXMm,
        sourceYMm,
        sourceWidthMm,
        sourceHeightMm,
        destXMm: box.xMm,
        destYMm: box.yMm,
        destWidthMm: Math.min(sourceWidthMm, usableWidthMm),
        destHeightMm: Math.min(sourceHeightMm, usableHeightMm),
        overlapEdges: { top: hasTop, right: hasRight, bottom: hasBottom, left: hasLeft },
      });
    }
  }

  return {
    columns,
    rows,
    tiles,
    posterWidthMm,
    posterHeightMm,
    overlapMm,
    sheetCount: columns * rows,
    usableWidthMm,
    usableHeightMm,
    instructions: [
      `Print all ${columns * rows} sheets. Each carries its grid code in the corner.`,
      overlapMm > 0
        ? `Neighbouring sheets share a ${roundTo(overlapMm, 1)} mm overlap band, marked with a dashed line.`
        : 'Sheets butt together with no overlap — cut exactly on the guide lines.',
      'Lay the sheets out following the assembly map before sticking anything down.',
      overlapMm > 0
        ? 'Trim the top and left edge of each sheet to its guide line, then lay it over its neighbour’s overlap band.'
        : 'Trim every sheet to its guide lines.',
      'Work row by row, left to right, and tape from the back.',
    ],
  };
}

/** Standard sheet-count presets offered in the interface. */
export const POSTER_PRESETS: { label: string; columns: number; rows: number }[] = [
  { label: '2 sheets — side by side', columns: 2, rows: 1 },
  { label: '2 sheets — stacked', columns: 1, rows: 2 },
  { label: '4 sheets — 2 × 2', columns: 2, rows: 2 },
  { label: '6 sheets — 3 × 2', columns: 3, rows: 2 },
  { label: '6 sheets — 2 × 3', columns: 2, rows: 3 },
  { label: '9 sheets — 3 × 3', columns: 3, rows: 3 },
  { label: '12 sheets — 4 × 3', columns: 4, rows: 3 },
  { label: '12 sheets — 3 × 4', columns: 3, rows: 4 },
];

/**
 * Finished poster size for a grid of sheets, given the printable area.
 * Used to show "this will make a 396 × 550 mm poster" next to each preset.
 */
export function posterSizeForGrid(
  columns: number,
  rows: number,
  sheet: Sheet,
  margins: Margins,
  overlapMm: number,
): { widthMm: number; heightMm: number } {
  const box = contentBox(sheet, margins);
  return {
    widthMm: columns * box.widthMm - Math.max(0, columns - 1) * overlapMm,
    heightMm: rows * box.heightMm - Math.max(0, rows - 1) * overlapMm,
  };
}
