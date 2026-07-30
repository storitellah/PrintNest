/**
 * Unit conversion.
 *
 * PrintNest keeps **every** geometric value in millimetres internally. Paper,
 * margins, element positions, bleed, crop marks — all mm, always. Units only
 * exist at the edges: what the user types in, and what a renderer needs
 * (CSS px, PDF points, canvas pixels).
 *
 * Doing it this way removes a whole class of bugs where a value silently
 * changes meaning as it crosses a module boundary.
 */

export type LengthUnit = 'mm' | 'cm' | 'in' | 'pt' | 'px';

/** CSS reference pixel: 96 per inch, by definition. */
export const CSS_PX_PER_INCH = 96;
/** PostScript/PDF point: 72 per inch, by definition. */
export const PT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;

const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  in: MM_PER_INCH,
  pt: MM_PER_INCH / PT_PER_INCH,
  px: MM_PER_INCH / CSS_PX_PER_INCH,
};

/** Convert a value expressed in `unit` into millimetres. */
export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit];
}

/** Convert millimetres into `unit`. */
export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit];
}

export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

export function mmToCssPx(mm: number): number {
  return (mm / MM_PER_INCH) * CSS_PX_PER_INCH;
}

export function cssPxToMm(px: number): number {
  return (px / CSS_PX_PER_INCH) * MM_PER_INCH;
}

export function mmToInch(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch: number): number {
  return inch * MM_PER_INCH;
}

/**
 * Pixels needed to render `mm` at a given output resolution. Used by the
 * raster exporters and by the resolution checker.
 */
export function mmToPixelsAtDpi(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

/**
 * Effective output resolution when `pixels` of source image are stretched
 * across `mm` of paper. This is the number the quality warnings key off.
 */
export function effectiveDpi(pixels: number, mm: number): number {
  if (mm <= 0) return 0;
  return pixels / (mm / MM_PER_INCH);
}

/** Round to a sane number of decimals for display and for stable equality. */
export function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Clamp helper used all over the layout editor. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

const UNIT_DECIMALS: Record<LengthUnit, number> = {
  mm: 1,
  cm: 2,
  in: 2,
  pt: 1,
  px: 0,
};

/** Format a millimetre value for display in the user's chosen unit. */
export function formatLength(mm: number, unit: LengthUnit): string {
  return `${roundTo(fromMm(mm, unit), UNIT_DECIMALS[unit])} ${unit}`;
}

/**
 * Parse a user-typed length. Accepts a bare number (interpreted in
 * `defaultUnit`) or a number with a unit suffix such as `12mm`, `1.5 in`,
 * `210 MM`. Returns millimetres, or `null` when the input is not a length.
 */
export function parseLength(input: string, defaultUnit: LengthUnit): number | null {
  const text = input.trim().toLowerCase().replace(',', '.');
  const match = /^([+-]?\d*\.?\d+)\s*(mm|cm|in|inch|inches|"|pt|px)?$/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1]!);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2];
  let unit: LengthUnit = defaultUnit;
  if (suffix === 'inch' || suffix === 'inches' || suffix === '"') unit = 'in';
  else if (suffix) unit = suffix as LengthUnit;
  return toMm(value, unit);
}
