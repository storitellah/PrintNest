import type { Margins, Orientation, Sheet } from './paper.ts';
import { contentBox, resolveSheet } from './paper.ts';
import type { BindingStyle, Project, Rect } from './types.ts';

/**
 * The imposition engine.
 *
 * Imposition is the step that turns *reading order* (page 1, 2, 3 …) into
 * *print sheet order* — the arrangement that, once printed, folded and
 * stacked, reads correctly. It is the single most error-prone part of home
 * booklet printing, so it lives here as pure, fully tested functions with no
 * DOM or project-store dependencies.
 *
 * ## The duplex mirroring convention
 *
 * Back sides are generated in the coordinate space of the *printed sheet*.
 * Which physical page ends up behind which depends on how the printer flips
 * the paper, so every duplexed layout takes a `mirrorBack` flag:
 *
 * - `mirrorBack: true`  — the sheet is turned over left-to-right (the back
 *   side's x axis is mirrored). This is the classic booklet convention.
 * - `mirrorBack: false` — the sheet is turned over top-to-bottom, so x is
 *   preserved and the back side reads in the same direction as the front.
 *
 * The manual duplex assistant lets the user discover which one their printer
 * does with a single test sheet, and stores the answer on the printer profile.
 */

export type SlotRotation = 0 | 90 | 180 | 270;

export interface SlotPlacement {
  /** Index into `project.pages`, or `null` for a blank slot. */
  pageIndex: number | null;
  /** Destination rectangle on the physical sheet, in mm. */
  rect: Rect;
  rotation: SlotRotation;
  /** Position within the sheet grid, for labelling ("Tile 2 of 4"). */
  label?: string;
}

export type GuideKind = 'fold' | 'cut' | 'slit' | 'alignment';

export interface GuideLine {
  kind: GuideKind;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

export type SheetSide = 'front' | 'back' | 'single';

export interface PrintSheet {
  /** 1-based physical sheet of paper. Front and back share a number. */
  sheetNumber: number;
  side: SheetSide;
  label: string;
  slots: SlotPlacement[];
  guides: GuideLine[];
}

export interface ImpositionResult {
  sheets: PrintSheet[];
  /** Physical paper, with orientation already applied. */
  sheetSize: Sheet;
  /** Finished page size. */
  pageSize: Sheet;
  /** Page count after padding to whatever the binding requires. */
  paddedPageCount: number;
  addedBlanks: number;
  /** Human-readable finishing steps, shown after printing. */
  instructions: string[];
  requiresTrimming: boolean;
  requiresManualReload: boolean;
  /** How many pages share one physical side. */
  pagesPerSide: number;
}

export interface ImposeOptions {
  pageCount: number;
  sheetSize: Sheet;
  pageSize: Sheet;
  margins: Margins;
  binding: BindingStyle;
  signatureSize: number;
  duplex: 'single-sided' | 'auto-duplex' | 'manual-duplex';
  mirrorBack: boolean;
  gutterMm: number;
  creepMm: number;
  foldMarks: boolean;
  columns: number;
  rows: number;
  gapMm: number;
  cutMarks: boolean;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/**
 * Place a page of `pageSize` inside `cell`, centred, preserving aspect ratio.
 * A page that already fits keeps its exact physical dimensions — scaling only
 * kicks in when the page is larger than the cell it has been assigned.
 */
export function fitPageInCell(pageSize: Sheet, cell: Rect): Rect {
  const scale = Math.min(
    1,
    cell.widthMm / pageSize.widthMm,
    cell.heightMm / pageSize.heightMm,
  );
  const widthMm = pageSize.widthMm * scale;
  const heightMm = pageSize.heightMm * scale;
  return {
    xMm: cell.xMm + (cell.widthMm - widthMm) / 2,
    yMm: cell.yMm + (cell.heightMm - heightMm) / 2,
    widthMm,
    heightMm,
  };
}

/** Split the printable area into a `columns × rows` grid of cells. */
export function gridCells(
  sheetSize: Sheet,
  margins: Margins,
  columns: number,
  rows: number,
  gapMm: number,
): Rect[] {
  const box = contentBox(sheetSize, margins);
  const cols = Math.max(1, Math.floor(columns));
  const rowCount = Math.max(1, Math.floor(rows));
  const cellWidth = (box.widthMm - gapMm * (cols - 1)) / cols;
  const cellHeight = (box.heightMm - gapMm * (rowCount - 1)) / rowCount;
  const cells: Rect[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        xMm: box.xMm + col * (cellWidth + gapMm),
        yMm: box.yMm + row * (cellHeight + gapMm),
        widthMm: Math.max(0, cellWidth),
        heightMm: Math.max(0, cellHeight),
      });
    }
  }
  return cells;
}

/** Mirror a rectangle across the sheet's vertical centre line. */
function mirrorRect(rect: Rect, sheetWidthMm: number): Rect {
  return { ...rect, xMm: sheetWidthMm - rect.xMm - rect.widthMm };
}

/** Round a page count up to the next multiple of `multiple`. */
export function padToMultiple(pageCount: number, multiple: number): number {
  if (multiple <= 1) return pageCount;
  return Math.ceil(pageCount / multiple) * multiple;
}

/** `pageNumber` is 1-based; returns a 0-based index or `null` when blank. */
function pageIndex(pageNumber: number, actualPageCount: number): number | null {
  const index = pageNumber - 1;
  return index >= 0 && index < actualPageCount ? index : null;
}

/* ------------------------------------------------------------------ *
 * Booklet page order
 * ------------------------------------------------------------------ */

/** One physical sheet of a saddle-stitched signature, in 1-based page numbers. */
export interface BookletSheetOrder {
  frontLeft: number;
  frontRight: number;
  backLeft: number;
  backRight: number;
}

/**
 * Saddle-stitch page order for one signature of `pagesPerSignature` pages
 * (must be a multiple of 4). Sheets are returned outermost first.
 *
 * For an 8-page signature this yields:
 *   sheet 0 → front 8 | 1, back 2 | 7
 *   sheet 1 → front 6 | 3, back 4 | 5
 *
 * Nest the sheets in order, fold the stack in half, and it reads 1…8.
 */
export function saddleStitchOrder(
  pagesPerSignature: number,
  firstPageNumber = 1,
): BookletSheetOrder[] {
  if (pagesPerSignature % 4 !== 0 || pagesPerSignature <= 0) {
    throw new Error(`Signature size must be a positive multiple of 4, got ${pagesPerSignature}`);
  }
  const sheets: BookletSheetOrder[] = [];
  const last = pagesPerSignature;
  const offset = firstPageNumber - 1;
  for (let i = 0; i < pagesPerSignature / 4; i += 1) {
    sheets.push({
      frontLeft: offset + last - 2 * i,
      frontRight: offset + 1 + 2 * i,
      backLeft: offset + 2 + 2 * i,
      backRight: offset + last - 1 - 2 * i,
    });
  }
  return sheets;
}

/**
 * Split a book into signatures and return the sheet order for the whole book.
 * `signatureSize` of 0 (or >= pageCount) means a single signature.
 */
export function bookletOrder(pageCount: number, signatureSize: number): BookletSheetOrder[] {
  const total = padToMultiple(Math.max(4, pageCount), 4);
  const perSignature =
    signatureSize && signatureSize >= 4 ? padToMultiple(signatureSize, 4) : total;
  const sheets: BookletSheetOrder[] = [];
  for (let start = 0; start < total; start += perSignature) {
    const size = Math.min(perSignature, total - start);
    sheets.push(...saddleStitchOrder(padToMultiple(size, 4), start + 1));
  }
  return sheets;
}

/**
 * The classic single-sheet, eight-page mini zine.
 *
 * One side of one sheet, folded in half three times with a slit through the
 * middle two panels. The top row prints upside down:
 *
 *   ┌────┬────┬────┬────┐
 *   │ 5↕ │ 4↕ │ 3↕ │ 2↕ │
 *   ├────┼────┼────┼────┤
 *   │ 6  │ 7  │ 8  │ 1  │
 *   └────┴────┴────┴────┘
 *
 * Returned in grid reading order (top row left→right, then bottom row), which
 * is the order `gridCells` produces.
 */
export function miniZine8Order(): { page: number; rotation: SlotRotation }[] {
  return [
    { page: 5, rotation: 180 },
    { page: 4, rotation: 180 },
    { page: 3, rotation: 180 },
    { page: 2, rotation: 180 },
    { page: 6, rotation: 0 },
    { page: 7, rotation: 0 },
    { page: 8, rotation: 0 },
    { page: 1, rotation: 0 },
  ];
}

/**
 * Cut-and-stack order for perfect binding, 2-up.
 *
 * The left column carries the first half of the book and the right column the
 * second half, so that after printing you cut the stack down the middle and
 * drop the right pile under the left pile — no collating, no re-sorting.
 */
export function cutStackOrder(pageCount: number): BookletSheetOrder[] {
  const total = padToMultiple(Math.max(4, pageCount), 4);
  const half = total / 2;
  const sheets: BookletSheetOrder[] = [];
  for (let i = 0; i < half / 2; i += 1) {
    sheets.push({
      frontLeft: 2 * i + 1,
      frontRight: half + 2 * i + 1,
      backLeft: 2 * i + 2,
      backRight: half + 2 * i + 2,
    });
  }
  return sheets;
}

/* ------------------------------------------------------------------ *
 * Layout builders
 * ------------------------------------------------------------------ */

interface BuildContext extends ImposeOptions {
  /** Real page count, before padding — used to decide what is blank. */
  actualPageCount: number;
}

/** One page per side of paper. The default for documents and photo prints. */
function imposeSingle(ctx: BuildContext): ImpositionResult {
  const box = contentBox(ctx.sheetSize, ctx.margins);
  const duplexed = ctx.duplex !== 'single-sided';
  const total = duplexed ? padToMultiple(ctx.pageCount, 2) : ctx.pageCount;
  const sheets: PrintSheet[] = [];

  for (let i = 0; i < total; i += 1) {
    const isBack = duplexed && i % 2 === 1;
    // Binding margin alternates so the gutter always lands at the spine.
    const gutter = ctx.gutterMm;
    const cell: Rect = gutter
      ? {
          ...box,
          xMm: box.xMm + (isBack ? 0 : gutter),
          widthMm: box.widthMm - gutter,
        }
      : box;
    sheets.push({
      sheetNumber: duplexed ? Math.floor(i / 2) + 1 : i + 1,
      side: duplexed ? (isBack ? 'back' : 'front') : 'single',
      label: duplexed
        ? `Sheet ${Math.floor(i / 2) + 1} — ${isBack ? 'back' : 'front'}`
        : `Sheet ${i + 1}`,
      slots: [
        {
          pageIndex: pageIndex(i + 1, ctx.actualPageCount),
          rect: fitPageInCell(ctx.pageSize, cell),
          rotation: 0,
        },
      ],
      guides: [],
    });
  }

  return {
    sheets,
    sheetSize: ctx.sheetSize,
    pageSize: ctx.pageSize,
    paddedPageCount: total,
    addedBlanks: Math.max(0, total - ctx.actualPageCount),
    instructions:
      ctx.duplex === 'manual-duplex'
        ? ['Print the front sides, reload the stack, then print the back sides.']
        : [],
    requiresTrimming: false,
    requiresManualReload: ctx.duplex === 'manual-duplex',
    pagesPerSide: 1,
  };
}

/** Several sequential pages per sheet — handouts, labels, card sheets. */
function imposeNUp(ctx: BuildContext): ImpositionResult {
  const perSide = Math.max(1, ctx.columns * ctx.rows);
  const cells = gridCells(ctx.sheetSize, ctx.margins, ctx.columns, ctx.rows, ctx.gapMm);
  const duplexed = ctx.duplex !== 'single-sided';
  const total = padToMultiple(ctx.pageCount, duplexed ? perSide * 2 : perSide);
  const sideCount = total / perSide;
  const sheets: PrintSheet[] = [];

  for (let side = 0; side < sideCount; side += 1) {
    const isBack = duplexed && side % 2 === 1;
    const slots: SlotPlacement[] = cells.map((cell, cellIndex) => {
      const rect = fitPageInCell(ctx.pageSize, cell);
      return {
        pageIndex: pageIndex(side * perSide + cellIndex + 1, ctx.actualPageCount),
        rect: isBack && ctx.mirrorBack ? mirrorRect(rect, ctx.sheetSize.widthMm) : rect,
        rotation: 0,
      };
    });
    sheets.push({
      sheetNumber: duplexed ? Math.floor(side / 2) + 1 : side + 1,
      side: duplexed ? (isBack ? 'back' : 'front') : 'single',
      label: duplexed
        ? `Sheet ${Math.floor(side / 2) + 1} — ${isBack ? 'back' : 'front'}`
        : `Sheet ${side + 1}`,
      slots,
      guides: ctx.cutMarks ? cutGuidesForCells(cells, ctx.sheetSize) : [],
    });
  }

  return {
    sheets,
    sheetSize: ctx.sheetSize,
    pageSize: ctx.pageSize,
    paddedPageCount: total,
    addedBlanks: Math.max(0, total - ctx.actualPageCount),
    instructions: ctx.cutMarks ? ['Cut along the guide lines to separate the pieces.'] : [],
    requiresTrimming: perSide > 1,
    requiresManualReload: ctx.duplex === 'manual-duplex',
    pagesPerSide: perSide,
  };
}

/** Saddle-stitched or cut-and-stack booklet: two pages per side of paper. */
function imposeTwoUpBooklet(ctx: BuildContext, mode: 'saddle' | 'cut-stack'): ImpositionResult {
  const order = mode === 'saddle' ? bookletOrder(ctx.pageCount, ctx.signatureSize) : cutStackOrder(ctx.pageCount);
  const total = padToMultiple(Math.max(4, ctx.pageCount), 4);
  const cells = gridCells(ctx.sheetSize, ctx.margins, 2, 1, 0);
  const leftCell = cells[0]!;
  const rightCell = cells[1]!;
  const spineXMm = ctx.sheetSize.widthMm / 2;
  const sheetsInSignature =
    ctx.signatureSize >= 4 ? padToMultiple(ctx.signatureSize, 4) / 4 : order.length;

  const sheets: PrintSheet[] = [];

  order.forEach((sheetOrder, index) => {
    // Creep: sheets nested further inside are shifted towards the spine so the
    // folded edge trims flush.
    const positionInSignature = index % Math.max(1, sheetsInSignature);
    const creepShift = mode === 'saddle' ? positionInSignature * ctx.creepMm : 0;
    const half = ctx.gutterMm / 2;

    const placeLeft = (pageNumber: number): SlotPlacement => ({
      pageIndex: pageIndex(pageNumber, ctx.actualPageCount),
      rect: shift(fitPageInCell(ctx.pageSize, leftCell), -half + creepShift, 0),
      rotation: 0,
    });
    const placeRight = (pageNumber: number): SlotPlacement => ({
      pageIndex: pageIndex(pageNumber, ctx.actualPageCount),
      rect: shift(fitPageInCell(ctx.pageSize, rightCell), half - creepShift, 0),
      rotation: 0,
    });

    const front: SlotPlacement[] = [
      placeLeft(sheetOrder.frontLeft),
      placeRight(sheetOrder.frontRight),
    ];
    const backRaw: SlotPlacement[] = [
      placeLeft(sheetOrder.backLeft),
      placeRight(sheetOrder.backRight),
    ];
    const back = ctx.mirrorBack
      ? backRaw.map((slot) => ({ ...slot, rect: mirrorRect(slot.rect, ctx.sheetSize.widthMm) }))
      : backRaw;

    const guides: GuideLine[] =
      mode === 'saddle'
        ? ctx.foldMarks
          ? [{ kind: 'fold', x1Mm: spineXMm, y1Mm: 0, x2Mm: spineXMm, y2Mm: ctx.sheetSize.heightMm }]
          : []
        : [{ kind: 'cut', x1Mm: spineXMm, y1Mm: 0, x2Mm: spineXMm, y2Mm: ctx.sheetSize.heightMm }];

    sheets.push({
      sheetNumber: index + 1,
      side: 'front',
      label: `Sheet ${index + 1} — front`,
      slots: front,
      guides,
    });
    sheets.push({
      sheetNumber: index + 1,
      side: 'back',
      label: `Sheet ${index + 1} — back`,
      slots: back,
      guides,
    });
  });

  const instructions =
    mode === 'saddle'
      ? [
          'Print every sheet double-sided.',
          sheetsInSignature > 1 && ctx.signatureSize >= 4
            ? `Keep each group of ${sheetsInSignature} sheets together — that is one signature.`
            : 'Keep the sheets in the order they came out of the printer.',
          'Stack the sheets in printed order, then fold the whole stack in half at once.',
          'Staple twice along the fold, roughly a third in from each end.',
          'Trim the outer edge if the inner pages stick out.',
        ]
      : [
          'Print every sheet double-sided.',
          'Cut the whole stack down the centre line in one go.',
          'Place the right-hand pile underneath the left-hand pile.',
          'Square the stack, then glue or clamp the spine edge.',
        ];

  return {
    sheets,
    sheetSize: ctx.sheetSize,
    pageSize: ctx.pageSize,
    paddedPageCount: total,
    addedBlanks: Math.max(0, total - ctx.actualPageCount),
    instructions,
    requiresTrimming: true,
    requiresManualReload: ctx.duplex === 'manual-duplex',
    pagesPerSide: 2,
  };
}

/** Eight pages on one side of one sheet. */
function imposeMiniZine(ctx: BuildContext): ImpositionResult {
  const cells = gridCells(ctx.sheetSize, ctx.margins, 4, 2, 0);
  const order = miniZine8Order();
  const sheetCount = Math.max(1, Math.ceil(ctx.pageCount / 8));
  const sheets: PrintSheet[] = [];

  for (let s = 0; s < sheetCount; s += 1) {
    const slots: SlotPlacement[] = order.map((entry, cellIndex) => ({
      pageIndex: pageIndex(s * 8 + entry.page, ctx.actualPageCount),
      rect: fitPageInCell(ctx.pageSize, cells[cellIndex]!),
      rotation: entry.rotation,
    }));
    sheets.push({
      sheetNumber: s + 1,
      side: 'single',
      label: sheetCount > 1 ? `Mini zine sheet ${s + 1}` : 'Mini zine sheet',
      slots,
      guides: miniZineGuides(ctx.sheetSize),
    });
  }

  return {
    sheets,
    sheetSize: ctx.sheetSize,
    pageSize: ctx.pageSize,
    paddedPageCount: sheetCount * 8,
    addedBlanks: Math.max(0, sheetCount * 8 - ctx.actualPageCount),
    instructions: [
      'Print on one side of the sheet only.',
      'Fold the sheet in half the short way, crease, and open it back out.',
      'Fold in half the long way, crease, open out, then fold the long way once more.',
      'Open the sheet flat. Cut the short slit along the centre — only between the two middle folds.',
      'Fold the sheet the long way again and push the ends towards each other so the slit opens into a diamond.',
      'Flatten the pages around so the cover ends up on the outside.',
    ],
    requiresTrimming: true,
    requiresManualReload: false,
    pagesPerSide: 8,
  };
}

/** A strip of panels folded concertina-style. */
function imposeAccordion(ctx: BuildContext): ImpositionResult {
  const panels = Math.max(2, ctx.columns);
  const cells = gridCells(ctx.sheetSize, ctx.margins, panels, 1, 0);
  const duplexed = ctx.duplex !== 'single-sided';
  const perSheet = duplexed ? panels * 2 : panels;
  const sheetCount = Math.max(1, Math.ceil(ctx.pageCount / perSheet));
  const sheets: PrintSheet[] = [];

  for (let s = 0; s < sheetCount; s += 1) {
    const front: SlotPlacement[] = cells.map((cell, i) => ({
      pageIndex: pageIndex(s * perSheet + i + 1, ctx.actualPageCount),
      rect: fitPageInCell(ctx.pageSize, cell),
      rotation: 0,
    }));
    sheets.push({
      sheetNumber: s + 1,
      side: duplexed ? 'front' : 'single',
      label: `Strip ${s + 1}${duplexed ? ' — front' : ''}`,
      slots: front,
      guides: accordionGuides(ctx.sheetSize, ctx.margins, panels),
    });
    if (duplexed) {
      // The back of an accordion runs in the opposite direction so that panel
      // n's reverse sits behind panel n.
      const back: SlotPlacement[] = cells.map((cell, i) => {
        const rect = fitPageInCell(ctx.pageSize, cell);
        return {
          pageIndex: pageIndex(s * perSheet + panels + (panels - i), ctx.actualPageCount),
          rect: ctx.mirrorBack ? mirrorRect(rect, ctx.sheetSize.widthMm) : rect,
          rotation: 0,
        };
      });
      sheets.push({
        sheetNumber: s + 1,
        side: 'back',
        label: `Strip ${s + 1} — back`,
        slots: back,
        guides: accordionGuides(ctx.sheetSize, ctx.margins, panels),
      });
    }
  }

  return {
    sheets,
    sheetSize: ctx.sheetSize,
    pageSize: ctx.pageSize,
    paddedPageCount: sheetCount * perSheet,
    addedBlanks: Math.max(0, sheetCount * perSheet - ctx.actualPageCount),
    instructions: [
      'Trim the margins away so the panels reach the paper edge.',
      'Fold along each guide line, alternating the direction every time.',
      'Glue the last panel of one strip to the first panel of the next to extend the concertina.',
    ],
    requiresTrimming: true,
    requiresManualReload: ctx.duplex === 'manual-duplex',
    pagesPerSide: panels,
  };
}

/** Four panels where the outer two fold inwards to meet at the centre. */
function imposeGatefold(ctx: BuildContext): ImpositionResult {
  const box = contentBox(ctx.sheetSize, ctx.margins);
  // Outer flaps are half the width of the centre panels so they meet cleanly.
  const centre = box.widthMm / 3;
  const flap = centre / 2;
  const widths = [flap, centre, centre, flap];
  const cells: Rect[] = [];
  let x = box.xMm;
  for (const width of widths) {
    cells.push({ xMm: x, yMm: box.yMm, widthMm: width, heightMm: box.heightMm });
    x += width;
  }

  const duplexed = ctx.duplex !== 'single-sided';
  const perSheet = duplexed ? 8 : 4;
  const sheetCount = Math.max(1, Math.ceil(ctx.pageCount / perSheet));
  const sheets: PrintSheet[] = [];

  for (let s = 0; s < sheetCount; s += 1) {
    for (let side = 0; side < (duplexed ? 2 : 1); side += 1) {
      const isBack = side === 1;
      const slots = cells.map((cell, i) => {
        const rect = fitPageInCell(ctx.pageSize, cell);
        return {
          pageIndex: pageIndex(s * perSheet + side * 4 + i + 1, ctx.actualPageCount),
          rect: isBack && ctx.mirrorBack ? mirrorRect(rect, ctx.sheetSize.widthMm) : rect,
          rotation: 0 as SlotRotation,
        };
      });
      sheets.push({
        sheetNumber: s + 1,
        side: duplexed ? (isBack ? 'back' : 'front') : 'single',
        label: `Gatefold ${s + 1}${duplexed ? (isBack ? ' — back' : ' — front') : ''}`,
        slots,
        guides: cells.slice(1).map((cell) => ({
          kind: 'fold' as GuideKind,
          x1Mm: cell.xMm,
          y1Mm: 0,
          x2Mm: cell.xMm,
          y2Mm: ctx.sheetSize.heightMm,
        })),
      });
    }
  }

  return {
    sheets,
    sheetSize: ctx.sheetSize,
    pageSize: ctx.pageSize,
    paddedPageCount: sheetCount * perSheet,
    addedBlanks: Math.max(0, sheetCount * perSheet - ctx.actualPageCount),
    instructions: [
      'Trim to the outer guide lines.',
      'Fold the two narrow outer panels inwards so their edges meet at the centre.',
    ],
    requiresTrimming: true,
    requiresManualReload: ctx.duplex === 'manual-duplex',
    pagesPerSide: 4,
  };
}

/* ------------------------------------------------------------------ *
 * Guides
 * ------------------------------------------------------------------ */

function shift(rect: Rect, dxMm: number, dyMm: number): Rect {
  return { ...rect, xMm: rect.xMm + dxMm, yMm: rect.yMm + dyMm };
}

function cutGuidesForCells(cells: Rect[], sheetSize: Sheet): GuideLine[] {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const cell of cells) {
    xs.add(round(cell.xMm));
    xs.add(round(cell.xMm + cell.widthMm));
    ys.add(round(cell.yMm));
    ys.add(round(cell.yMm + cell.heightMm));
  }
  const guides: GuideLine[] = [];
  for (const x of xs) {
    guides.push({ kind: 'cut', x1Mm: x, y1Mm: 0, x2Mm: x, y2Mm: sheetSize.heightMm });
  }
  for (const y of ys) {
    guides.push({ kind: 'cut', x1Mm: 0, y1Mm: y, x2Mm: sheetSize.widthMm, y2Mm: y });
  }
  return guides;
}

function miniZineGuides(sheetSize: Sheet): GuideLine[] {
  const quarter = sheetSize.widthMm / 4;
  const half = sheetSize.heightMm / 2;
  const guides: GuideLine[] = [
    { kind: 'fold', x1Mm: quarter, y1Mm: 0, x2Mm: quarter, y2Mm: sheetSize.heightMm },
    { kind: 'fold', x1Mm: quarter * 3, y1Mm: 0, x2Mm: quarter * 3, y2Mm: sheetSize.heightMm },
    { kind: 'fold', x1Mm: 0, y1Mm: half, x2Mm: sheetSize.widthMm, y2Mm: half },
    // The centre vertical is a fold above and below the slit but the slit
    // itself is the cut that makes the zine work.
    { kind: 'slit', x1Mm: quarter, y1Mm: half, x2Mm: quarter * 3, y2Mm: half },
  ];
  return guides;
}

function accordionGuides(sheetSize: Sheet, margins: Margins, panels: number): GuideLine[] {
  const box = contentBox(sheetSize, margins);
  const width = box.widthMm / panels;
  const guides: GuideLine[] = [];
  for (let i = 1; i < panels; i += 1) {
    const x = box.xMm + i * width;
    guides.push({ kind: 'fold', x1Mm: x, y1Mm: 0, x2Mm: x, y2Mm: sheetSize.heightMm });
  }
  return guides;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

export function imposeWithOptions(options: ImposeOptions): ImpositionResult {
  const ctx: BuildContext = { ...options, actualPageCount: options.pageCount };
  switch (options.binding) {
    case 'saddle-stitch':
      return imposeTwoUpBooklet(ctx, 'saddle');
    case 'perfect-bound':
      return imposeTwoUpBooklet(ctx, 'cut-stack');
    case 'mini-zine-8':
      return imposeMiniZine(ctx);
    case 'accordion':
      return imposeAccordion(ctx);
    case 'gatefold':
      return imposeGatefold(ctx);
    case 'none':
    default:
      return options.columns * options.rows > 1 ? imposeNUp(ctx) : imposeSingle(ctx);
  }
}

/** Impose a whole project, reading every setting off the document. */
export function imposeProject(project: Project): ImpositionResult {
  const sheetSize = resolveSheet(
    { widthMm: project.paper.widthMm, heightMm: project.paper.heightMm },
    project.paper.orientation,
  );
  const { imposition, nUp } = project.settings;
  return imposeWithOptions({
    pageCount: project.pages.length,
    sheetSize,
    pageSize: { widthMm: project.pageWidthMm, heightMm: project.pageHeightMm },
    margins: project.margins,
    binding: imposition.binding,
    signatureSize: imposition.signatureSize,
    duplex: imposition.duplex,
    mirrorBack: imposition.flipEdge === 'long',
    gutterMm: imposition.gutterMm,
    creepMm: imposition.creepMm,
    foldMarks: imposition.foldMarks,
    columns: nUp.columns,
    rows: nUp.rows,
    gapMm: nUp.gapMm,
    cutMarks: nUp.cutMarks,
  });
}

/**
 * The sheets that make up one pass of a manual duplex run.
 *
 * Fronts print first in natural order. Backs print second — and because most
 * printers spit pages face-up, they are reversed so that reloading the stack
 * without re-sorting lines everything up.
 */
export function manualDuplexPasses(
  result: ImpositionResult,
  reverseBackOrder: boolean,
): { fronts: PrintSheet[]; backs: PrintSheet[] } {
  const fronts = result.sheets.filter((s) => s.side === 'front' || s.side === 'single');
  const backs = result.sheets.filter((s) => s.side === 'back');
  return { fronts, backs: reverseBackOrder ? [...backs].reverse() : backs };
}

/** Reading order is simply the document order — kept explicit for clarity. */
export function readingOrder(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, i) => i);
}

/**
 * The order pages appear as you flip through the folded result, which for a
 * booklet is reading order but for a mini zine follows the fold.
 */
export function foldedOrder(binding: BindingStyle, pageCount: number): number[] {
  if (binding === 'mini-zine-8') {
    const sheets = Math.max(1, Math.ceil(pageCount / 8));
    return Array.from({ length: sheets * 8 }, (_, i) => i).filter((i) => i < pageCount);
  }
  return readingOrder(pageCount);
}

/** Which orientation a binding wants the paper in, for the setup hints. */
export function preferredOrientation(binding: BindingStyle): Orientation | null {
  switch (binding) {
    case 'saddle-stitch':
    case 'perfect-bound':
    case 'mini-zine-8':
    case 'accordion':
    case 'gatefold':
      return 'landscape';
    default:
      return null;
  }
}
