import type { Sheet } from './paper.ts';
import { roundTo } from './units.ts';

/**
 * The printer calibration page.
 *
 * Built as an SVG at true physical size rather than as a project, because it
 * needs hairlines, exact rulers and colour patches that no layout editor
 * should have to model.
 *
 * The two measurement lines are the important part: a printer that scales the
 * page — which many drivers do by default, under names like "fit to page" or
 * "shrink oversized pages" — will produce a 100 mm line that is not 100 mm.
 * Measuring it and typing the result back gives PrintNest a correction factor.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TestPageOptions {
  sheet: Sheet;
  /** Printer name to print on the sheet, so stacks of tests stay identifiable. */
  printerLabel: string;
  includeColorBlocks: boolean;
  includeGreyscale: boolean;
  includePhotoSample: boolean;
  includeBorderlessTest: boolean;
  includeDuplexTest: boolean;
  /** Minimum printable margin claimed by the printer profile, in mm. */
  claimedMarginMm: number;
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function text(
  content: string,
  x: number,
  y: number,
  size: number,
  options: { anchor?: string; fill?: string; weight?: string } = {},
): SVGTextElement {
  const node = el('text', {
    x,
    y,
    'font-size': size,
    'font-family': 'sans-serif',
    fill: options.fill ?? '#171717',
    'text-anchor': options.anchor ?? 'start',
  });
  if (options.weight) node.setAttribute('font-weight', options.weight);
  node.textContent = content;
  return node;
}

/**
 * Build the calibration page. Returns an element sized in real millimetres,
 * ready to hand to the print root.
 */
export function buildTestPage(options: TestPageOptions): HTMLElement {
  const { sheet } = options;
  const wrapper = document.createElement('div');
  wrapper.className = 'pn-sheet pn-sheet--test';
  wrapper.style.width = `${sheet.widthMm}mm`;
  wrapper.style.height = `${sheet.heightMm}mm`;

  const svg = el('svg', {
    viewBox: `0 0 ${sheet.widthMm} ${sheet.heightMm}`,
    width: `${sheet.widthMm}mm`,
    height: `${sheet.heightMm}mm`,
  });
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    'Printer calibration page with margin rulers, alignment markers, colour and greyscale blocks, fine lines and measurement lines.',
  );

  const hairline = 0.15;
  let cursorY = 12;

  // ---- Title -------------------------------------------------------------
  svg.append(text('PrintNest calibration page', 10, cursorY, 5, { weight: '600' }));
  cursorY += 5;
  svg.append(
    text(
      `${options.printerLabel} · ${roundTo(sheet.widthMm, 0)} × ${roundTo(sheet.heightMm, 0)} mm · ${new Date().toLocaleDateString()}`,
      10,
      cursorY,
      2.8,
      { fill: '#6B6B6B' },
    ),
  );
  cursorY += 3;
  svg.append(
    text(
      'Print at 100 %. Turn off “fit to page” and “scale to fit” in the print dialog.',
      10,
      cursorY,
      2.8,
      { fill: '#C94A4A' },
    ),
  );
  cursorY += 8;

  // ---- Margin rulers ------------------------------------------------------
  // A ruler along each edge, ticked every 1 mm with labels every 5 mm, showing
  // exactly how much of the paper the printer refuses to touch.
  addEdgeRuler(svg, sheet, 'top');
  addEdgeRuler(svg, sheet, 'left');

  // The claimed unprintable margin, drawn so it can be checked by eye.
  if (options.claimedMarginMm > 0) {
    svg.append(
      el('rect', {
        x: options.claimedMarginMm,
        y: options.claimedMarginMm,
        width: sheet.widthMm - options.claimedMarginMm * 2,
        height: sheet.heightMm - options.claimedMarginMm * 2,
        fill: 'none',
        stroke: '#3D66F5',
        'stroke-width': hairline,
        'stroke-dasharray': '2 1.5',
      }),
    );
    svg.append(
      text(
        `Claimed printable area (${roundTo(options.claimedMarginMm, 1)} mm margin)`,
        options.claimedMarginMm + 1,
        options.claimedMarginMm + 3,
        2.4,
        { fill: '#3D66F5' },
      ),
    );
  }

  // ---- Alignment markers at the corners -----------------------------------
  for (const [x, y] of [
    [5, 5],
    [sheet.widthMm - 5, 5],
    [5, sheet.heightMm - 5],
    [sheet.widthMm - 5, sheet.heightMm - 5],
  ] as const) {
    svg.append(el('circle', { cx: x, cy: y, r: 2, fill: 'none', stroke: '#171717', 'stroke-width': hairline }));
    svg.append(el('line', { x1: x - 3.5, y1: y, x2: x + 3.5, y2: y, stroke: '#171717', 'stroke-width': hairline }));
    svg.append(el('line', { x1: x, y1: y - 3.5, x2: x, y2: y + 3.5, stroke: '#171717', 'stroke-width': hairline }));
  }

  cursorY = Math.max(cursorY, 34);

  // ---- Measurement lines --------------------------------------------------
  svg.append(text('1 · Measure these two lines with a ruler', 10, cursorY, 3.4, { weight: '600' }));
  cursorY += 4;

  svg.append(measurementLine(10, cursorY, 100, '100 mm'));
  cursorY += 9;
  svg.append(measurementLine(10, cursorY, 101.6, '4 inches (101.6 mm)'));
  cursorY += 10;
  svg.append(
    text(
      'If either line measures differently, type what you measured into PrintNest to set a scale correction.',
      10,
      cursorY,
      2.6,
      { fill: '#6B6B6B' },
    ),
  );
  cursorY += 8;

  // ---- Scale verification square -----------------------------------------
  svg.append(text('2 · This square should be exactly 50 × 50 mm', 10, cursorY, 3.4, { weight: '600' }));
  cursorY += 4;
  svg.append(
    el('rect', { x: 10, y: cursorY, width: 50, height: 50, fill: 'none', stroke: '#171717', 'stroke-width': 0.3 }),
  );
  svg.append(el('line', { x1: 10, y1: cursorY, x2: 60, y2: cursorY + 50, stroke: '#D9D5CE', 'stroke-width': hairline }));
  svg.append(el('line', { x1: 60, y1: cursorY, x2: 10, y2: cursorY + 50, stroke: '#D9D5CE', 'stroke-width': hairline }));
  svg.append(text('50 mm', 35, cursorY + 54, 2.6, { anchor: 'middle', fill: '#6B6B6B' }));

  // ---- Fine lines ---------------------------------------------------------
  let lineX = 70;
  svg.append(text('3 · Fine lines', lineX, cursorY - 1, 3.4, { weight: '600' }));
  const weights = [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1];
  for (const weight of weights) {
    svg.append(
      el('line', {
        x1: lineX,
        y1: cursorY + 4,
        x2: lineX,
        y2: cursorY + 34,
        stroke: '#171717',
        'stroke-width': weight,
      }),
    );
    svg.append(text(String(weight), lineX, cursorY + 38, 2, { anchor: 'middle', fill: '#6B6B6B' }));
    lineX += 8;
  }
  svg.append(
    text('The thinnest visible line is your printer’s limit.', 70, cursorY + 44, 2.4, {
      fill: '#6B6B6B',
    }),
  );

  cursorY += 60;

  // ---- Colour blocks ------------------------------------------------------
  if (options.includeColorBlocks) {
    svg.append(text('4 · Colour blocks', 10, cursorY, 3.4, { weight: '600' }));
    cursorY += 4;
    const colours = [
      ['#00A3E0', 'Cyan'],
      ['#E5007E', 'Magenta'],
      ['#FFED00', 'Yellow'],
      ['#171717', 'Black'],
      ['#C94A4A', 'Red'],
      ['#3D8C63', 'Green'],
      ['#3D66F5', 'Blue'],
      ['#F4A340', 'Orange'],
    ] as const;
    let x = 10;
    for (const [colour, label] of colours) {
      svg.append(el('rect', { x, y: cursorY, width: 20, height: 14, fill: colour }));
      svg.append(text(label, x + 10, cursorY + 17.5, 2.2, { anchor: 'middle', fill: '#6B6B6B' }));
      x += 23;
    }
    cursorY += 24;
  }

  // ---- Greyscale ramp -----------------------------------------------------
  if (options.includeGreyscale) {
    svg.append(text('5 · Greyscale steps', 10, cursorY, 3.4, { weight: '600' }));
    cursorY += 4;
    const steps = 11;
    const stepWidth = (sheet.widthMm - 20) / steps;
    for (let i = 0; i < steps; i += 1) {
      const value = Math.round(255 * (1 - i / (steps - 1)));
      const hex = value.toString(16).padStart(2, '0');
      svg.append(
        el('rect', {
          x: 10 + i * stepWidth,
          y: cursorY,
          width: stepWidth,
          height: 10,
          fill: `#${hex}${hex}${hex}`,
        }),
      );
      svg.append(
        text(`${Math.round((i / (steps - 1)) * 100)}`, 10 + i * stepWidth + stepWidth / 2, cursorY + 13.5, 2, {
          anchor: 'middle',
          fill: '#6B6B6B',
        }),
      );
    }
    svg.append(
      text(
        'Every step should be distinguishable. If the darkest steps merge, reduce ink density or use better paper.',
        10,
        cursorY + 18,
        2.4,
        { fill: '#6B6B6B' },
      ),
    );
    cursorY += 24;
  }

  // ---- Text samples -------------------------------------------------------
  svg.append(text('6 · Text samples', 10, cursorY, 3.4, { weight: '600' }));
  cursorY += 4.5;
  for (const size of [6, 7, 8, 9, 10, 12]) {
    const sample = el('text', {
      x: 10,
      y: cursorY,
      'font-size': size * 0.3528,
      'font-family': 'serif',
      fill: '#171717',
    });
    sample.textContent = `${size} pt — Handgloves, the quick brown fox jumps over the lazy dog 0123456789`;
    svg.append(sample);
    cursorY += size * 0.3528 + 1.6;
  }
  cursorY += 3;

  // ---- Photo sample -------------------------------------------------------
  if (options.includePhotoSample) {
    svg.append(text('7 · Tone and gradient sample', 10, cursorY, 3.4, { weight: '600' }));
    cursorY += 4;
    const gradientId = 'pn-test-gradient';
    const defs = el('defs', {});
    const gradient = el('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '1', y2: '1' });
    for (const [offset, colour] of [
      ['0%', '#171717'],
      ['25%', '#C94A4A'],
      ['50%', '#F4A340'],
      ['75%', '#3D8C63'],
      ['100%', '#F5F0E7'],
    ] as const) {
      gradient.append(el('stop', { offset, 'stop-color': colour }));
    }
    defs.append(gradient);
    svg.append(defs);
    svg.append(
      el('rect', { x: 10, y: cursorY, width: sheet.widthMm - 20, height: 18, fill: `url(#${gradientId})` }),
    );
    svg.append(
      text('Look for banding, colour casts and blocked-up shadows.', 10, cursorY + 22, 2.4, {
        fill: '#6B6B6B',
      }),
    );
    cursorY += 27;
  }

  // ---- Borderless test ----------------------------------------------------
  if (options.includeBorderlessTest) {
    // A band that runs all the way to the paper edge. Whatever is missing when
    // it comes out is the printer's true unprintable margin.
    svg.append(el('rect', { x: 0, y: sheet.heightMm - 6, width: sheet.widthMm, height: 6, fill: '#3D66F5' }));
    svg.append(
      text(
        'Borderless test: this blue band runs to all four edges of the page.',
        10,
        sheet.heightMm - 8,
        2.6,
        { fill: '#6B6B6B' },
      ),
    );
    svg.append(el('rect', { x: 0, y: 0, width: 3, height: sheet.heightMm, fill: '#3D66F5' }));
    svg.append(el('rect', { x: sheet.widthMm - 3, y: 0, width: 3, height: sheet.heightMm, fill: '#3D66F5' }));
    svg.append(el('rect', { x: 0, y: 0, width: sheet.widthMm, height: 3, fill: '#3D66F5' }));
  }

  // ---- Duplex orientation test -------------------------------------------
  if (options.includeDuplexTest) {
    svg.append(
      text('TOP OF SHEET · FRONT', sheet.widthMm / 2, 6, 3.2, {
        anchor: 'middle',
        fill: '#F4A340',
        weight: '600',
      }),
    );
    svg.append(
      text('BOTTOM OF SHEET · FRONT', sheet.widthMm / 2, sheet.heightMm - 12, 3.2, {
        anchor: 'middle',
        fill: '#F4A340',
        weight: '600',
      }),
    );
    // A big arrow so the feed direction is unambiguous once printed.
    const arrow = el('path', {
      d: `M ${sheet.widthMm - 18} 20 L ${sheet.widthMm - 12} 12 L ${sheet.widthMm - 6} 20 L ${sheet.widthMm - 10} 20 L ${sheet.widthMm - 10} 32 L ${sheet.widthMm - 14} 32 L ${sheet.widthMm - 14} 20 Z`,
      fill: '#F4A340',
    });
    svg.append(arrow);
    svg.append(
      text('UP', sheet.widthMm - 12, 36, 2.6, { anchor: 'middle', fill: '#F4A340', weight: '600' }),
    );
  }

  wrapper.append(svg);
  return wrapper;
}

function measurementLine(x: number, y: number, lengthMm: number, label: string): SVGGElement {
  const group = el('g', {});
  group.append(el('line', { x1: x, y1: y, x2: x + lengthMm, y2: y, stroke: '#171717', 'stroke-width': 0.3 }));
  group.append(el('line', { x1: x, y1: y - 2, x2: x, y2: y + 2, stroke: '#171717', 'stroke-width': 0.3 }));
  group.append(
    el('line', { x1: x + lengthMm, y1: y - 2, x2: x + lengthMm, y2: y + 2, stroke: '#171717', 'stroke-width': 0.3 }),
  );
  // Tick every 10 mm so a mis-scaled print is obvious at a glance.
  for (let tick = 10; tick < lengthMm; tick += 10) {
    group.append(
      el('line', { x1: x + tick, y1: y - 1, x2: x + tick, y2: y + 1, stroke: '#8C877D', 'stroke-width': 0.15 }),
    );
  }
  group.append(text(label, x + lengthMm + 3, y + 1, 2.8, { fill: '#6B6B6B' }));
  return group;
}

function addEdgeRuler(svg: SVGSVGElement, sheet: Sheet, edge: 'top' | 'left'): void {
  const length = edge === 'top' ? sheet.widthMm : sheet.heightMm;
  for (let mm = 0; mm <= length; mm += 1) {
    const major = mm % 10 === 0;
    const medium = mm % 5 === 0;
    const size = major ? 4 : medium ? 2.5 : 1.4;
    if (edge === 'top') {
      svg.append(el('line', { x1: mm, y1: 0, x2: mm, y2: size, stroke: '#8C877D', 'stroke-width': 0.1 }));
      if (major && mm > 0 && mm < length - 6) {
        svg.append(text(String(mm), mm, size + 2.2, 1.8, { anchor: 'middle', fill: '#8C877D' }));
      }
    } else {
      svg.append(el('line', { x1: 0, y1: mm, x2: size, y2: mm, stroke: '#8C877D', 'stroke-width': 0.1 }));
      if (major && mm > 0 && mm < length - 6) {
        svg.append(text(String(mm), size + 0.6, mm + 0.7, 1.8, { fill: '#8C877D' }));
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Correction factor
 * ------------------------------------------------------------------ */

export interface CalibrationResult {
  factor: number;
  percentage: number;
  verdict: 'accurate' | 'minor' | 'significant';
  message: string;
}

/**
 * Work out the scale correction from a measured reference line.
 *
 * If the printer produced a 98 mm line where 100 mm was asked for, everything
 * comes out 2 % small, so the correction multiplies future output by 100/98.
 */
export function calculateCorrection(expectedMm: number, measuredMm: number): CalibrationResult {
  if (!Number.isFinite(measuredMm) || measuredMm <= 0 || expectedMm <= 0) {
    return {
      factor: 1,
      percentage: 0,
      verdict: 'accurate',
      message: 'Enter the length you measured to work out a correction.',
    };
  }

  const factor = expectedMm / measuredMm;
  const percentage = (factor - 1) * 100;
  const magnitude = Math.abs(percentage);

  if (magnitude < 0.3) {
    return {
      factor: 1,
      percentage,
      verdict: 'accurate',
      message: 'Your printer is printing at true size. No correction needed.',
    };
  }
  if (magnitude < 3) {
    return {
      factor,
      percentage,
      verdict: 'minor',
      message: `Prints come out ${roundTo(Math.abs(percentage), 2)} % ${
        percentage > 0 ? 'small' : 'large'
      }. PrintNest will compensate.`,
    };
  }
  return {
    factor,
    percentage,
    verdict: 'significant',
    message: `Prints are ${roundTo(Math.abs(percentage), 1)} % ${
      percentage > 0 ? 'small' : 'large'
    } — that usually means “fit to page” is still switched on in the print dialog. Turn it off and print the test again before applying a correction this large.`,
  };
}

/** Sensible clamp so a mistyped measurement cannot wreck every future print. */
export function clampCorrection(factor: number): number {
  return Math.max(0.8, Math.min(1.2, factor));
}
