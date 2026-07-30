import { describe, expect, it } from 'vitest';
import { createImageElement } from '../src/core/project.ts';
import type { ImageElement } from '../src/core/types.ts';
import { computeImageLayout, frameForImage, placedDpi } from '../src/render/imageLayout.ts';
import {
  QUALITY_THRESHOLDS,
  assessImageElement,
  assessQuality,
  maxPrintSizeMm,
  requiredPixels,
} from '../src/core/resolution.ts';

function image(overrides: Partial<ImageElement> = {}): ImageElement {
  return createImageElement(
    'asset_1',
    { xMm: 0, yMm: 0, widthMm: 100, heightMm: 50 },
    overrides,
  );
}

/** A 2:1 landscape source, matching the default 100 × 50 mm frame. */
const SQUARE_SOURCE = { naturalWidthPx: 1000, naturalHeightPx: 1000 };
const WIDE_SOURCE = { naturalWidthPx: 2000, naturalHeightPx: 1000 };
const TALL_SOURCE = { naturalWidthPx: 1000, naturalHeightPx: 2000 };

describe('computeImageLayout — fit', () => {
  it('shows the whole picture inside the frame', () => {
    const layout = computeImageLayout({ element: image({ fit: 'fit' }), ...SQUARE_SOURCE });
    // A square in a 100 × 50 frame is limited by height.
    expect(layout.footprintWidthMm).toBeCloseTo(50, 6);
    expect(layout.footprintHeightMm).toBeCloseTo(50, 6);
    expect(layout.clipped).toBe(false);
  });

  it('preserves the aspect ratio exactly', () => {
    const layout = computeImageLayout({ element: image({ fit: 'fit' }), ...TALL_SOURCE });
    expect(layout.footprintWidthMm / layout.footprintHeightMm).toBeCloseTo(0.5, 6);
  });

  it('centres the picture in the frame', () => {
    const layout = computeImageLayout({ element: image({ fit: 'fit' }), ...SQUARE_SOURCE });
    expect(layout.footprintXMm).toBeCloseTo((100 - 50) / 2, 6);
    expect(layout.footprintYMm).toBeCloseTo(0, 6);
  });

  it('fills exactly when the picture matches the frame proportions', () => {
    const layout = computeImageLayout({ element: image({ fit: 'fit' }), ...WIDE_SOURCE });
    expect(layout.footprintWidthMm).toBeCloseTo(100, 6);
    expect(layout.footprintHeightMm).toBeCloseTo(50, 6);
  });
});

describe('computeImageLayout — fill', () => {
  it('covers the frame and overflows', () => {
    const layout = computeImageLayout({ element: image({ fit: 'fill' }), ...SQUARE_SOURCE });
    expect(layout.footprintWidthMm).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(layout.footprintHeightMm).toBeGreaterThanOrEqual(50 - 1e-6);
    expect(layout.clipped).toBe(true);
  });

  it('still preserves the aspect ratio', () => {
    const layout = computeImageLayout({ element: image({ fit: 'fill' }), ...TALL_SOURCE });
    expect(layout.footprintWidthMm / layout.footprintHeightMm).toBeCloseTo(0.5, 6);
  });
});

describe('computeImageLayout — stretch and scale', () => {
  it('stretch distorts to the frame exactly', () => {
    const layout = computeImageLayout({ element: image({ fit: 'stretch' }), ...SQUARE_SOURCE });
    expect(layout.footprintWidthMm).toBeCloseTo(100, 6);
    expect(layout.footprintHeightMm).toBeCloseTo(50, 6);
  });

  it('custom scale multiplies the fitted size', () => {
    const half = computeImageLayout({
      element: image({ fit: 'custom', scale: 0.5 }),
      ...SQUARE_SOURCE,
    });
    const full = computeImageLayout({ element: image({ fit: 'fit' }), ...SQUARE_SOURCE });
    expect(half.footprintWidthMm).toBeCloseTo(full.footprintWidthMm / 2, 6);
  });

  it('actual size uses the source pixels at 300 dpi', () => {
    // 600 px at 300 dpi is exactly 2 inches, i.e. 50.8 mm.
    const layout = computeImageLayout({
      element: image({ fit: 'actual' }),
      naturalWidthPx: 600,
      naturalHeightPx: 600,
    });
    expect(layout.footprintWidthMm).toBeCloseTo(50.8, 4);
  });

  it('honours a custom actual-size resolution', () => {
    const layout = computeImageLayout({
      element: image({ fit: 'actual' }),
      naturalWidthPx: 96,
      naturalHeightPx: 96,
      actualSizeDpi: 96,
    });
    expect(layout.footprintWidthMm).toBeCloseTo(25.4, 4);
  });
});

describe('computeImageLayout — rotation, flipping and cropping', () => {
  it('swaps the axes for a quarter turn', () => {
    const upright = computeImageLayout({ element: image({ fit: 'fit' }), ...TALL_SOURCE });
    const turned = computeImageLayout({
      element: image({ fit: 'fit', imageRotation: 90 }),
      ...TALL_SOURCE,
    });
    // A tall picture turned on its side becomes wide.
    expect(turned.footprintWidthMm / turned.footprintHeightMm).toBeCloseTo(
      upright.footprintHeightMm / upright.footprintWidthMm,
      6,
    );
    // The rotator is the footprint with its axes swapped back.
    expect(turned.preWidthMm).toBeCloseTo(turned.footprintHeightMm, 6);
    expect(turned.preHeightMm).toBeCloseTo(turned.footprintWidthMm, 6);
    expect(turned.rotationDeg).toBe(90);
  });

  it('leaves the footprint alone for a half turn', () => {
    const upright = computeImageLayout({ element: image({ fit: 'fit' }), ...TALL_SOURCE });
    const turned = computeImageLayout({
      element: image({ fit: 'fit', imageRotation: 180 }),
      ...TALL_SOURCE,
    });
    expect(turned.footprintWidthMm).toBeCloseTo(upright.footprintWidthMm, 6);
    expect(turned.footprintHeightMm).toBeCloseTo(upright.footprintHeightMm, 6);
  });

  it('expresses flips as negative scale', () => {
    const layout = computeImageLayout({
      element: image({ flipH: true, flipV: true }),
      ...SQUARE_SOURCE,
    });
    expect(layout.scaleX).toBe(-1);
    expect(layout.scaleY).toBe(-1);
  });

  it('scales the image up so the crop window fills the frame', () => {
    const layout = computeImageLayout({
      element: image({ fit: 'fit', crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }),
      ...SQUARE_SOURCE,
    });
    // Showing half the width means the image must be twice as wide.
    expect(layout.imageWidthMm).toBeCloseTo(layout.preWidthMm * 2, 6);
    expect(layout.imageHeightMm).toBeCloseTo(layout.preHeightMm * 2, 6);
    // And offset so the crop's top-left lands at the window's origin.
    expect(layout.imageLeftMm).toBeCloseTo(-0.25 * layout.imageWidthMm, 6);
    expect(layout.imageTopMm).toBeCloseTo(-0.25 * layout.imageHeightMm, 6);
  });

  it('uses the cropped proportions when fitting', () => {
    // Cropping a square down to a 2:1 strip should fit like a wide picture.
    const layout = computeImageLayout({
      element: image({ fit: 'fit', crop: { x: 0, y: 0.25, width: 1, height: 0.5 } }),
      ...SQUARE_SOURCE,
    });
    expect(layout.footprintWidthMm / layout.footprintHeightMm).toBeCloseTo(2, 6);
  });

  it('applies the pan offset', () => {
    const layout = computeImageLayout({
      element: image({ fit: 'fit', offsetXMm: 10, offsetYMm: -5 }),
      ...SQUARE_SOURCE,
    });
    expect(layout.footprintXMm).toBeCloseTo(25 + 10, 6);
    expect(layout.footprintYMm).toBeCloseTo(0 - 5, 6);
  });

  it('survives a zero-sized source without dividing by zero', () => {
    const layout = computeImageLayout({
      element: image(),
      naturalWidthPx: 0,
      naturalHeightPx: 0,
    });
    expect(Number.isFinite(layout.footprintWidthMm)).toBe(true);
    expect(Number.isFinite(layout.footprintHeightMm)).toBe(true);
  });
});

describe('frameForImage', () => {
  it('sizes a landscape frame by its width', () => {
    expect(frameForImage(2000, 1000, 100)).toEqual({ widthMm: 100, heightMm: 50 });
  });

  it('sizes a portrait frame by its height', () => {
    expect(frameForImage(1000, 2000, 100)).toEqual({ widthMm: 50, heightMm: 100 });
  });

  it('falls back to a square for an unmeasurable source', () => {
    expect(frameForImage(0, 0, 80)).toEqual({ widthMm: 80, heightMm: 80 });
  });
});

describe('placedDpi', () => {
  it('reports the resolution the picture actually prints at', () => {
    // 1181 px across 100 mm is very close to 300 dpi.
    const dpi = placedDpi({
      element: image({ fit: 'stretch', widthMm: 100, heightMm: 50 }),
      naturalWidthPx: 1181,
      naturalHeightPx: 590,
    });
    expect(Math.round(dpi)).toBe(300);
  });

  it('falls when the picture is cropped', () => {
    const full = placedDpi({
      element: image({ fit: 'stretch' }),
      ...WIDE_SOURCE,
    });
    const cropped = placedDpi({
      element: image({ fit: 'stretch', crop: { x: 0, y: 0, width: 0.5, height: 1 } }),
      ...WIDE_SOURCE,
    });
    expect(cropped).toBeLessThan(full);
  });
});

describe('resolution assessment', () => {
  it('bands the levels at the documented thresholds', () => {
    const at = (dpi: number) => assessQuality((dpi / 25.4) * 100, 100).level;
    expect(at(QUALITY_THRESHOLDS.excellent)).toBe('excellent');
    expect(at(QUALITY_THRESHOLDS.good)).toBe('good');
    expect(at(QUALITY_THRESHOLDS.acceptable)).toBe('acceptable');
    expect(at(QUALITY_THRESHOLDS.acceptable - 10)).toBe('low');
  });

  it('never conveys the level by colour alone', () => {
    const assessment = assessQuality(300, 100);
    expect(assessment.label).toMatch(/quality|warning/i);
    expect(assessment.advice.length).toBeGreaterThan(10);
  });

  it('assesses a placed element through its crop', () => {
    const asset = {
      id: 'asset_1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      bytes: 1,
      widthPx: 2400,
      heightPx: 1200,
      addedAt: 0,
    };
    const full = assessImageElement(image({ widthMm: 200, heightMm: 100 }), asset)!;
    const cropped = assessImageElement(
      image({ widthMm: 200, heightMm: 100, crop: { x: 0, y: 0, width: 0.25, height: 1 } }),
      asset,
    )!;
    expect(cropped.dpi).toBeLessThan(full.dpi);
  });

  it('returns nothing when the asset is missing or unmeasured', () => {
    expect(assessImageElement(image(), undefined)).toBeNull();
  });

  it('inverts cleanly between size and pixels', () => {
    expect(requiredPixels(100, 300)).toBe(1182);
    expect(maxPrintSizeMm(1182, 300)).toBeCloseTo(100.076, 2);
  });
});
