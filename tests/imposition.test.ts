import { describe, expect, it } from 'vitest';
import {
  backTransformFor,
  bookletOrder,
  cutStackOrder,
  fitPageInCell,
  foldedOrder,
  gridCells,
  imposeWithOptions,
  manualDuplexPasses,
  miniZine8Order,
  padToMultiple,
  saddleStitchOrder,
} from '../src/core/imposition.ts';
import type { ImposeOptions } from '../src/core/imposition.ts';
import { flipEdgeLabel } from '../src/core/duplex.ts';
import { halfSheet, quarterSheet, resolveSheet, uniformMargins } from '../src/core/paper.ts';

const A4_LANDSCAPE = resolveSheet({ widthMm: 210, heightMm: 297 }, 'landscape');

function options(overrides: Partial<ImposeOptions> = {}): ImposeOptions {
  return {
    pageCount: 8,
    sheetSize: A4_LANDSCAPE,
    pageSize: halfSheet(A4_LANDSCAPE),
    margins: uniformMargins(0),
    binding: 'saddle-stitch',
    signatureSize: 0,
    duplex: 'manual-duplex',
    backTransform: 'none',
    gutterMm: 0,
    creepMm: 0,
    foldMarks: true,
    columns: 1,
    rows: 1,
    gapMm: 0,
    cutMarks: false,
    ...overrides,
  };
}

describe('padToMultiple', () => {
  it('rounds up to the next multiple', () => {
    expect(padToMultiple(1, 4)).toBe(4);
    expect(padToMultiple(4, 4)).toBe(4);
    expect(padToMultiple(5, 4)).toBe(8);
    expect(padToMultiple(13, 4)).toBe(16);
  });

  it('is the identity for a multiple of one', () => {
    expect(padToMultiple(7, 1)).toBe(7);
  });
});

describe('saddleStitchOrder', () => {
  it('produces the classic 8-page booklet order', () => {
    expect(saddleStitchOrder(8)).toEqual([
      { frontLeft: 8, frontRight: 1, backLeft: 2, backRight: 7 },
      { frontLeft: 6, frontRight: 3, backLeft: 4, backRight: 5 },
    ]);
  });

  it('produces a single sheet for a 4-page booklet', () => {
    expect(saddleStitchOrder(4)).toEqual([
      { frontLeft: 4, frontRight: 1, backLeft: 2, backRight: 3 },
    ]);
  });

  it('uses every page exactly once', () => {
    for (const size of [4, 8, 12, 16, 20, 32]) {
      const used = saddleStitchOrder(size).flatMap((sheet) => [
        sheet.frontLeft,
        sheet.frontRight,
        sheet.backLeft,
        sheet.backRight,
      ]);
      expect(used).toHaveLength(size);
      expect([...used].sort((a, b) => a - b)).toEqual(
        Array.from({ length: size }, (_, i) => i + 1),
      );
    }
  });

  it('keeps facing pages together on the folded stack', () => {
    // Reading through a folded booklet, page 2 and 3 face each other. They must
    // therefore be on different sheets or different sides.
    const sheets = saddleStitchOrder(8);
    const sideOf = new Map<number, string>();
    sheets.forEach((sheet, index) => {
      sideOf.set(sheet.frontLeft, `${index}-front`);
      sideOf.set(sheet.frontRight, `${index}-front`);
      sideOf.set(sheet.backLeft, `${index}-back`);
      sideOf.set(sheet.backRight, `${index}-back`);
    });
    // Page 1 (cover) and page 8 (back cover) share the outermost front side.
    expect(sideOf.get(1)).toBe(sideOf.get(8));
    // Pages 4 and 5 are the centre spread — same side of the innermost sheet.
    expect(sideOf.get(4)).toBe(sideOf.get(5));
  });

  it('offsets page numbers for later signatures', () => {
    expect(saddleStitchOrder(4, 5)).toEqual([
      { frontLeft: 8, frontRight: 5, backLeft: 6, backRight: 7 },
    ]);
  });

  it('rejects signature sizes that are not multiples of four', () => {
    expect(() => saddleStitchOrder(6)).toThrow(/multiple of 4/);
    expect(() => saddleStitchOrder(0)).toThrow();
  });
});

describe('bookletOrder', () => {
  it('splits a long book into signatures', () => {
    const sheets = bookletOrder(32, 16);
    // Two signatures of 16 pages = 4 sheets each.
    expect(sheets).toHaveLength(8);
    // The second signature starts at page 17.
    expect(sheets[4]).toEqual({ frontLeft: 32, frontRight: 17, backLeft: 18, backRight: 31 });
  });

  it('pads an odd page count up to a multiple of four', () => {
    const sheets = bookletOrder(5, 0);
    expect(sheets).toHaveLength(2); // 8 pages → 2 sheets
  });

  it('treats signature size 0 as one big signature', () => {
    expect(bookletOrder(16, 0)).toEqual(bookletOrder(16, 16));
  });

  it('never repeats a page across the whole book', () => {
    const used = bookletOrder(24, 8).flatMap((sheet) => [
      sheet.frontLeft,
      sheet.frontRight,
      sheet.backLeft,
      sheet.backRight,
    ]);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('cutStackOrder', () => {
  it('puts the first half in the left column and the second half in the right', () => {
    expect(cutStackOrder(8)).toEqual([
      { frontLeft: 1, frontRight: 5, backLeft: 2, backRight: 6 },
      { frontLeft: 3, frontRight: 7, backLeft: 4, backRight: 8 },
    ]);
  });

  it('reads in sequence once the piles are stacked', () => {
    const sheets = cutStackOrder(12);
    const leftPile = sheets.flatMap((sheet) => [sheet.frontLeft, sheet.backLeft]);
    const rightPile = sheets.flatMap((sheet) => [sheet.frontRight, sheet.backRight]);
    expect([...leftPile, ...rightPile]).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

describe('miniZine8Order', () => {
  it('places all eight pages once', () => {
    const pages = miniZine8Order().map((entry) => entry.page);
    expect([...pages].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('prints the top row upside down and the bottom row upright', () => {
    const order = miniZine8Order();
    expect(order.slice(0, 4).every((entry) => entry.rotation === 180)).toBe(true);
    expect(order.slice(4).every((entry) => entry.rotation === 0)).toBe(true);
  });

  it('puts the cover next to the back cover on the bottom row', () => {
    const bottom = miniZine8Order().slice(4).map((entry) => entry.page);
    expect(bottom).toEqual([6, 7, 8, 1]);
  });
});

describe('gridCells', () => {
  it('divides the printable area evenly', () => {
    const cells = gridCells({ widthMm: 200, heightMm: 100 }, uniformMargins(0), 2, 2, 0);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ xMm: 0, yMm: 0, widthMm: 100, heightMm: 50 });
    expect(cells[3]).toEqual({ xMm: 100, yMm: 50, widthMm: 100, heightMm: 50 });
  });

  it('accounts for gaps and margins', () => {
    const cells = gridCells({ widthMm: 210, heightMm: 297 }, uniformMargins(10), 2, 1, 10);
    expect(cells[0]!.xMm).toBe(10);
    expect(cells[0]!.widthMm).toBeCloseTo(90, 6);
    expect(cells[1]!.xMm).toBeCloseTo(110, 6);
  });

  it('reads left to right, top to bottom', () => {
    const cells = gridCells({ widthMm: 300, heightMm: 200 }, uniformMargins(0), 3, 2, 0);
    expect(cells.map((cell) => [cell.xMm, cell.yMm])).toEqual([
      [0, 0], [100, 0], [200, 0],
      [0, 100], [100, 100], [200, 100],
    ]);
  });
});

describe('fitPageInCell', () => {
  it('centres a page that already fits without scaling it', () => {
    const rect = fitPageInCell(
      { widthMm: 100, heightMm: 50 },
      { xMm: 0, yMm: 0, widthMm: 200, heightMm: 100 },
    );
    expect(rect).toEqual({ xMm: 50, yMm: 25, widthMm: 100, heightMm: 50 });
  });

  it('scales an oversized page down while preserving aspect ratio', () => {
    const rect = fitPageInCell(
      { widthMm: 400, heightMm: 200 },
      { xMm: 0, yMm: 0, widthMm: 200, heightMm: 200 },
    );
    expect(rect.widthMm).toBe(200);
    expect(rect.heightMm).toBe(100);
    expect(rect.widthMm / rect.heightMm).toBeCloseTo(2, 6);
  });
});

describe('imposeWithOptions — saddle stitch', () => {
  it('emits a front and a back for every sheet', () => {
    const result = imposeWithOptions(options({ pageCount: 8 }));
    expect(result.sheets).toHaveLength(4); // 2 sheets × 2 sides
    expect(result.sheets.map((sheet) => sheet.side)).toEqual([
      'front', 'back', 'front', 'back',
    ]);
    expect(result.pagesPerSide).toBe(2);
  });

  it('reports the blank pages it had to add', () => {
    const result = imposeWithOptions(options({ pageCount: 5 }));
    expect(result.paddedPageCount).toBe(8);
    expect(result.addedBlanks).toBe(3);
    // Pages 6, 7 and 8 do not exist, so those slots are blank.
    const blanks = result.sheets.flatMap((sheet) =>
      sheet.slots.filter((slot) => slot.pageIndex === null),
    );
    expect(blanks).toHaveLength(3);
  });

  it('lays the back side out directly when the sheet turns left to right', () => {
    // The canonical booklet table: front 8 | 1, back 2 | 7, read as you look
    // at each side of the sheet.
    const result = imposeWithOptions(options({ backTransform: 'none' }));
    const front = result.sheets[0]!.slots.map((slot) => slot.pageIndex);
    const back = result.sheets[1]!.slots.map((slot) => slot.pageIndex);
    expect(front).toEqual([7, 0]); // pages 8 and 1, zero-based
    expect(back).toEqual([1, 6]); // pages 2 and 7
    expect(result.sheets[1]!.slots.every((slot) => slot.rotation === 0)).toBe(true);
  });

  it('rotates the back side a half turn when the sheet turns top to bottom', () => {
    const plain = imposeWithOptions(options({ backTransform: 'none' }));
    const rotated = imposeWithOptions(options({ backTransform: 'rotate180' }));
    const plainBack = plain.sheets[1]!.slots[0]!;
    const rotatedBack = rotated.sheets[1]!.slots[0]!;

    expect(rotatedBack.pageIndex).toBe(plainBack.pageIndex);
    expect(rotatedBack.rect.xMm).toBeCloseTo(
      A4_LANDSCAPE.widthMm - plainBack.rect.xMm - plainBack.rect.widthMm,
      6,
    );
    expect(rotatedBack.rect.yMm).toBeCloseTo(
      A4_LANDSCAPE.heightMm - plainBack.rect.yMm - plainBack.rect.heightMm,
      6,
    );
    expect(rotatedBack.rotation).toBe(180);
  });

  it('leaves the front side untouched whatever the back transform', () => {
    const plain = imposeWithOptions(options({ backTransform: 'none' }));
    const rotated = imposeWithOptions(options({ backTransform: 'rotate180' }));
    expect(rotated.sheets[0]!.slots).toEqual(plain.sheets[0]!.slots);
  });

  it('adds a fold guide down the centre', () => {
    const result = imposeWithOptions(options());
    const fold = result.sheets[0]!.guides.find((guide) => guide.kind === 'fold');
    expect(fold).toBeDefined();
    expect(fold!.x1Mm).toBeCloseTo(A4_LANDSCAPE.widthMm / 2, 6);
  });

  it('moves pages away from the spine when a gutter is set', () => {
    const none = imposeWithOptions(options({ gutterMm: 0 }));
    const gutter = imposeWithOptions(options({ gutterMm: 10 }));
    const leftNone = none.sheets[0]!.slots[0]!.rect.xMm;
    const leftGutter = gutter.sheets[0]!.slots[0]!.rect.xMm;
    const rightNone = none.sheets[0]!.slots[1]!.rect.xMm;
    const rightGutter = gutter.sheets[0]!.slots[1]!.rect.xMm;
    expect(leftGutter).toBeCloseTo(leftNone - 5, 6);
    expect(rightGutter).toBeCloseTo(rightNone + 5, 6);
  });

  it('says the result needs trimming and reloading', () => {
    const result = imposeWithOptions(options());
    expect(result.requiresTrimming).toBe(true);
    expect(result.requiresManualReload).toBe(true);
    expect(result.instructions.length).toBeGreaterThan(0);
  });
});

describe('imposeWithOptions — mini zine', () => {
  const zine = options({
    binding: 'mini-zine-8',
    pageSize: quarterSheet(A4_LANDSCAPE),
    duplex: 'single-sided',
  });

  it('fits eight pages on one single-sided sheet', () => {
    const result = imposeWithOptions(zine);
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.side).toBe('single');
    expect(result.sheets[0]!.slots).toHaveLength(8);
    expect(result.pagesPerSide).toBe(8);
  });

  it('rotates the top row', () => {
    const slots = imposeWithOptions(zine).sheets[0]!.slots;
    expect(slots.slice(0, 4).map((slot) => slot.rotation)).toEqual([180, 180, 180, 180]);
    expect(slots.slice(4).map((slot) => slot.rotation)).toEqual([0, 0, 0, 0]);
  });

  it('includes the centre slit guide', () => {
    const guides = imposeWithOptions(zine).sheets[0]!.guides;
    const slit = guides.find((guide) => guide.kind === 'slit');
    expect(slit).toBeDefined();
    expect(slit!.x1Mm).toBeCloseTo(A4_LANDSCAPE.widthMm / 4, 6);
    expect(slit!.x2Mm).toBeCloseTo((A4_LANDSCAPE.widthMm * 3) / 4, 6);
    expect(slit!.y1Mm).toBeCloseTo(A4_LANDSCAPE.heightMm / 2, 6);
  });

  it('adds a second sheet for sixteen pages', () => {
    const result = imposeWithOptions({ ...zine, pageCount: 16 });
    expect(result.sheets).toHaveLength(2);
    expect(result.addedBlanks).toBe(0);
  });
});

describe('imposeWithOptions — single and n-up', () => {
  it('prints one page per sheet by default', () => {
    const result = imposeWithOptions(
      options({ binding: 'none', pageCount: 3, duplex: 'single-sided' }),
    );
    expect(result.sheets).toHaveLength(3);
    expect(result.sheets.every((sheet) => sheet.slots.length === 1)).toBe(true);
    expect(result.requiresTrimming).toBe(false);
  });

  it('pairs pages into fronts and backs when duplexing', () => {
    const result = imposeWithOptions(
      options({ binding: 'none', pageCount: 3, duplex: 'auto-duplex' }),
    );
    expect(result.paddedPageCount).toBe(4);
    expect(result.sheets.map((sheet) => sheet.side)).toEqual(['front', 'back', 'front', 'back']);
    // The padded fourth page is blank.
    expect(result.sheets[3]!.slots[0]!.pageIndex).toBeNull();
  });

  it('fills an n-up grid in reading order', () => {
    const result = imposeWithOptions(
      options({ binding: 'none', columns: 2, rows: 2, pageCount: 4, duplex: 'single-sided' }),
    );
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.slots.map((slot) => slot.pageIndex)).toEqual([0, 1, 2, 3]);
    expect(result.requiresTrimming).toBe(true);
  });

  it('alternates the binding margin on duplexed single pages', () => {
    const result = imposeWithOptions(
      options({ binding: 'none', pageCount: 2, duplex: 'auto-duplex', gutterMm: 12 }),
    );
    const front = result.sheets[0]!.slots[0]!.rect;
    const back = result.sheets[1]!.slots[0]!.rect;
    expect(front.xMm).not.toBeCloseTo(back.xMm, 3);
  });
});

describe('imposeWithOptions — accordion and gatefold', () => {
  it('lays an accordion out as a strip of panels', () => {
    const result = imposeWithOptions(
      options({ binding: 'accordion', columns: 4, pageCount: 4, duplex: 'single-sided' }),
    );
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]!.slots.map((slot) => slot.pageIndex)).toEqual([0, 1, 2, 3]);
    expect(result.sheets[0]!.guides.filter((guide) => guide.kind === 'fold')).toHaveLength(3);
  });

  it('runs the accordion back side in the opposite direction', () => {
    const result = imposeWithOptions(
      options({ binding: 'accordion', columns: 4, pageCount: 8, duplex: 'auto-duplex' }),
    );
    const back = result.sheets[1]!.slots.map((slot) => slot.pageIndex);
    expect(back).toEqual([7, 6, 5, 4]);
  });

  it('gives a gatefold two narrow flaps and two wide centre panels', () => {
    const result = imposeWithOptions(
      options({ binding: 'gatefold', pageCount: 4, duplex: 'single-sided' }),
    );
    const widths = result.sheets[0]!.slots.map((slot) => slot.rect.widthMm);
    expect(widths[0]).toBeLessThan(widths[1]!);
    expect(widths[3]).toBeLessThan(widths[2]!);
    expect(widths[0]).toBeCloseTo(widths[3]!, 6);
  });
});

describe('manualDuplexPasses', () => {
  it('separates the run into fronts then backs', () => {
    const result = imposeWithOptions(options({ pageCount: 8 }));
    const { fronts, backs } = manualDuplexPasses(result, false);
    expect(fronts).toHaveLength(2);
    expect(backs).toHaveLength(2);
    expect(fronts.every((sheet) => sheet.side === 'front')).toBe(true);
  });

  it('reverses the back pass for face-up printers', () => {
    const result = imposeWithOptions(options({ pageCount: 16 }));
    const straight = manualDuplexPasses(result, false).backs.map((sheet) => sheet.sheetNumber);
    const reversed = manualDuplexPasses(result, true).backs.map((sheet) => sheet.sheetNumber);
    expect(reversed).toEqual([...straight].reverse());
  });
});

describe('foldedOrder', () => {
  it('matches reading order for ordinary bindings', () => {
    expect(foldedOrder('saddle-stitch', 4)).toEqual([0, 1, 2, 3]);
  });

  it('does not invent pages that do not exist in a mini zine', () => {
    expect(foldedOrder('mini-zine-8', 5)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('backTransformFor', () => {
  it('leaves the back alone for a book-page turn', () => {
    // The layouts are generated for exactly this motion, so nothing changes.
    expect(backTransformFor('left-right')).toBe('none');
  });

  it('rotates the back for a calendar-style turn', () => {
    expect(backTransformFor('top-bottom')).toBe('rotate180');
  });
});

describe('flipEdgeLabel', () => {
  it('names the same motion differently on portrait and landscape paper', () => {
    // A landscape sheet's short edges are its vertical sides, so turning it
    // left to right is a short-edge flip; on portrait paper it is long-edge.
    expect(flipEdgeLabel('left-right', true)).toBe('short');
    expect(flipEdgeLabel('left-right', false)).toBe('long');
    expect(flipEdgeLabel('top-bottom', true)).toBe('long');
    expect(flipEdgeLabel('top-bottom', false)).toBe('short');
  });
});
