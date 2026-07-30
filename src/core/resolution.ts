import { effectiveDpi } from './units.ts';
import type { AssetMeta, ImageElement } from './types.ts';

/**
 * Resolution assessment.
 *
 * The question "will this print well?" reduces to: how many source pixels land
 * on each inch of paper? Everything below is a readable wrapper around that
 * one number, with thresholds chosen for real home printers rather than
 * commercial offset work.
 */

export type QualityLevel = 'excellent' | 'good' | 'acceptable' | 'low';

export interface QualityAssessment {
  level: QualityLevel;
  dpi: number;
  label: string;
  advice: string;
}

/**
 * Thresholds in effective DPI.
 *
 * 300 is the usual "photographic" benchmark. 200 still looks clean from
 * reading distance on a home inkjet. 150 is fine for a zine or a casual print.
 * Below that, pixels start to show.
 */
export const QUALITY_THRESHOLDS = {
  excellent: 300,
  good: 200,
  acceptable: 150,
} as const;

const LABELS: Record<QualityLevel, string> = {
  excellent: 'Excellent print quality',
  good: 'Good print quality',
  acceptable: 'Acceptable for casual printing',
  low: 'Low-resolution warning',
};

export function assessQuality(pixels: number, printedMm: number): QualityAssessment {
  const dpi = Math.round(effectiveDpi(pixels, printedMm));
  let level: QualityLevel;
  let advice: string;

  if (dpi >= QUALITY_THRESHOLDS.excellent) {
    level = 'excellent';
    advice = 'Plenty of detail for a photographic print at this size.';
  } else if (dpi >= QUALITY_THRESHOLDS.good) {
    level = 'good';
    advice = 'Sharp on a home printer. Fine for photographs, artwork and covers.';
  } else if (dpi >= QUALITY_THRESHOLDS.acceptable) {
    level = 'acceptable';
    advice = 'Good enough for zines and everyday prints. Soft under close inspection.';
  } else {
    level = 'low';
    advice = `Pixels will be visible. Print it smaller, or use a file of at least ${Math.ceil(
      (printedMm / 25.4) * QUALITY_THRESHOLDS.acceptable,
    )} pixels on this edge.`;
  }

  return { level, dpi, label: LABELS[level], advice };
}

/**
 * Assess a placed image, taking the crop into account: cropping throws pixels
 * away, so a heavily cropped photograph is lower resolution than its file size
 * suggests.
 */
export function assessImageElement(
  element: ImageElement,
  asset: AssetMeta | undefined,
): QualityAssessment | null {
  if (!asset || !asset.widthPx || !asset.heightPx) return null;

  const cropWidth = element.crop ? element.crop.width : 1;
  const cropHeight = element.crop ? element.crop.height : 1;
  const usableWidthPx = asset.widthPx * cropWidth;
  const usableHeightPx = asset.heightPx * cropHeight;

  // `fill` covers the frame, so the constraining edge is the one that is not
  // cropped away by the cover behaviour. Assess the tighter of the two.
  const widthAssessment = assessQuality(usableWidthPx, element.widthMm);
  const heightAssessment = assessQuality(usableHeightPx, element.heightMm);
  return widthAssessment.dpi <= heightAssessment.dpi ? widthAssessment : heightAssessment;
}

/** Largest print size, in mm, that still reaches a target DPI. */
export function maxPrintSizeMm(pixels: number, targetDpi: number): number {
  if (targetDpi <= 0) return 0;
  return (pixels / targetDpi) * 25.4;
}

/** Pixel dimensions needed to print a given size at a given DPI. */
export function requiredPixels(mm: number, dpi: number): number {
  return Math.ceil((mm / 25.4) * dpi);
}

export function qualityColorToken(level: QualityLevel): string {
  switch (level) {
    case 'excellent':
    case 'good':
      return 'var(--pn-success)';
    case 'acceptable':
      return 'var(--pn-orange)';
    case 'low':
      return 'var(--pn-warning)';
  }
}

/**
 * A short, non-numeric summary for people who do not think in DPI. Paired with
 * the level text everywhere, so status is never conveyed by colour alone.
 */
export function qualityShorthand(level: QualityLevel): string {
  switch (level) {
    case 'excellent':
      return 'Excellent';
    case 'good':
      return 'Good';
    case 'acceptable':
      return 'Acceptable';
    case 'low':
      return 'Too low';
  }
}
