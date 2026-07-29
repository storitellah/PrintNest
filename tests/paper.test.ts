import { describe, expect, it } from 'vitest';
import {
  PAPER_SIZES,
  contentBox,
  getPaperSize,
  halfSheet,
  matchPaperSize,
  naturalOrientation,
  quarterSheet,
  resolveSheet,
  subdivideSheet,
  uniformMargins,
} from '../src/core/paper.ts';
import {
  cssPxToMm,
  effectiveDpi,
  formatLength,
  fromMm,
  inchToMm,
  mmToCssPx,
  mmToPixelsAtDpi,
  mmToPt,
  parseLength,
  ptToMm,
  roundTo,
  toMm,
} from '../src/core/units.ts';

describe('unit conversion', () => {
  it('round-trips every unit through millimetres', () => {
    for (const unit of ['mm', 'cm', 'in', 'pt', 'px'] as const) {
      expect(fromMm(toMm(12.5, unit), unit)).toBeCloseTo(12.5, 9);
    }
  });

  it('uses the defined constants exactly', () => {
    expect(inchToMm(1)).toBe(25.4);
    expect(mmToPt(25.4)).toBeCloseTo(72, 9);
    expect(ptToMm(72)).toBeCloseTo(25.4, 9);
    expect(mmToCssPx(25.4)).toBeCloseTo(96, 9);
    expect(cssPxToMm(96)).toBeCloseTo(25.4, 9);
  });

  it('converts millimetres to pixels at a resolution', () => {
    // A4 width at 300 dpi is the familiar 2480 pixels.
    expect(Math.round(mmToPixelsAtDpi(210, 300))).toBe(2480);
    expect(Math.round(mmToPixelsAtDpi(297, 300))).toBe(3508);
  });

  it('computes effective resolution', () => {
    expect(Math.round(effectiveDpi(2480, 210))).toBe(300);
    expect(effectiveDpi(1000, 0)).toBe(0);
  });

  it('parses typed lengths with and without a unit', () => {
    expect(parseLength('10', 'mm')).toBe(10);
    expect(parseLength('1in', 'mm')).toBeCloseTo(25.4, 9);
    expect(parseLength('1.5 IN', 'mm')).toBeCloseTo(38.1, 9);
    expect(parseLength('2"', 'mm')).toBeCloseTo(50.8, 9);
    expect(parseLength('3,5', 'cm')).toBeCloseTo(35, 9);
    expect(parseLength('12 pt', 'mm')).toBeCloseTo(ptToMm(12), 9);
  });

  it('rejects anything that is not a length', () => {
    expect(parseLength('', 'mm')).toBeNull();
    expect(parseLength('abc', 'mm')).toBeNull();
    expect(parseLength('10 furlongs', 'mm')).toBeNull();
    expect(parseLength('1e5', 'mm')).toBeNull();
  });

  it('formats for display in the chosen unit', () => {
    expect(formatLength(25.4, 'in')).toBe('1 in');
    expect(formatLength(210, 'mm')).toBe('210 mm');
    expect(formatLength(210, 'cm')).toBe('21 cm');
  });

  it('rounds to the requested number of decimals', () => {
    expect(roundTo(1.2345, 2)).toBe(1.23);
    expect(roundTo(1.2355, 2)).toBe(1.24);
    expect(roundTo(2.4999, 0)).toBe(2);
    expect(roundTo(2.5001, 0)).toBe(3);
  });

  it('inherits binary floating point behaviour at exact halves', () => {
    // 1.005 is really 1.00499999… so it rounds down. Worth pinning: print
    // dimensions are compared for equality all over the codebase, and a
    // "clever" rounding fix here would change results elsewhere.
    expect(roundTo(1.005, 2)).toBe(1);
  });
});

describe('paper catalogue', () => {
  it('stores every size portrait-first', () => {
    for (const paper of PAPER_SIZES) {
      expect(paper.widthMm).toBeLessThanOrEqual(paper.heightMm);
    }
  });

  it('has no duplicate ids', () => {
    const ids = PAPER_SIZES.map((paper) => paper.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gets the ISO A series right', () => {
    expect(getPaperSize('a4')).toMatchObject({ widthMm: 210, heightMm: 297 });
    expect(getPaperSize('a3')).toMatchObject({ widthMm: 297, heightMm: 420 });
    expect(getPaperSize('a5')).toMatchObject({ widthMm: 148, heightMm: 210 });
  });

  it('halves each A size into the next one down, within a millimetre', () => {
    // The A series is defined so that A(n+1) is A(n) folded in half.
    const pairs: [string, string][] = [
      ['a3', 'a4'],
      ['a4', 'a5'],
      ['a5', 'a6'],
    ];
    for (const [bigger, smaller] of pairs) {
      const big = getPaperSize(bigger)!;
      const small = getPaperSize(smaller)!;
      expect(Math.abs(big.heightMm / 2 - small.widthMm)).toBeLessThanOrEqual(1);
      expect(Math.abs(big.widthMm - small.heightMm)).toBeLessThanOrEqual(1);
    }
  });

  it('converts North American sizes from inches', () => {
    expect(getPaperSize('letter')).toMatchObject({ widthMm: 215.9, heightMm: 279.4 });
    expect(getPaperSize('legal')).toMatchObject({ widthMm: 215.9, heightMm: 355.6 });
    expect(getPaperSize('photo-4x6')).toMatchObject({ widthMm: 101.6, heightMm: 152.4 });
  });

  it('resolves orientation without mutating the catalogue', () => {
    const a4 = getPaperSize('a4')!;
    const landscape = resolveSheet(a4, 'landscape');
    expect(landscape).toEqual({ widthMm: 297, heightMm: 210 });
    expect(a4.widthMm).toBe(210);
    expect(naturalOrientation(landscape)).toBe('landscape');
    expect(naturalOrientation(resolveSheet(a4, 'portrait'))).toBe('portrait');
  });

  it('identifies a size from its dimensions in either orientation', () => {
    expect(matchPaperSize(210, 297)?.id).toBe('a4');
    expect(matchPaperSize(297, 210)?.id).toBe('a4');
    expect(matchPaperSize(210.3, 296.8)?.id).toBe('a4'); // within tolerance
    expect(matchPaperSize(100, 100)).toBeUndefined();
  });
});

describe('sheet geometry', () => {
  const a4Landscape = { widthMm: 297, heightMm: 210 };
  const a4Portrait = { widthMm: 210, heightMm: 297 };

  it('halves along whichever edge is longer', () => {
    expect(halfSheet(a4Landscape)).toEqual({ widthMm: 148.5, heightMm: 210 });
    expect(halfSheet(a4Portrait)).toEqual({ widthMm: 210, heightMm: 148.5 });
  });

  it('quarters into the mini-zine cell', () => {
    expect(quarterSheet(a4Landscape)).toEqual({ widthMm: 74.25, heightMm: 105 });
  });

  it('subdivides by a divisor', () => {
    expect(subdivideSheet(a4Landscape, 1)).toEqual(a4Landscape);
    expect(subdivideSheet(a4Landscape, 2)).toEqual(halfSheet(a4Landscape));
    expect(subdivideSheet(a4Landscape, 4)).toEqual(quarterSheet(a4Landscape));
  });

  it('computes the printable box from margins', () => {
    const box = contentBox(a4Portrait, uniformMargins(10));
    expect(box).toEqual({ xMm: 10, yMm: 10, widthMm: 190, heightMm: 277 });
  });

  it('never returns a negative printable area', () => {
    const box = contentBox({ widthMm: 20, heightMm: 20 }, uniformMargins(30));
    expect(box.widthMm).toBe(0);
    expect(box.heightMm).toBe(0);
  });

  it('handles asymmetric margins', () => {
    const box = contentBox(a4Portrait, {
      topMm: 5,
      rightMm: 10,
      bottomMm: 15,
      leftMm: 20,
    });
    expect(box).toEqual({ xMm: 20, yMm: 5, widthMm: 180, heightMm: 277 });
  });
});
