import type { ImageElement } from '../core/types.ts';
import { mmToInch } from '../core/units.ts';

/**
 * Image placement maths.
 *
 * Kept separate from the DOM so it can be unit tested and reused by the PDF
 * and canvas exporters, which need exactly the same geometry as the screen.
 *
 * The DOM structure this describes is:
 *
 *   frame        — the element's rectangle, clips everything
 *     rotator    — rotated/flipped, sized `preWidthMm × preHeightMm`
 *       window   — clips the crop
 *         img    — oversized, offset so the crop window shows the right part
 */

export interface ImageLayout {
  /** Footprint of the placed image inside the frame, after rotation. */
  footprintXMm: number;
  footprintYMm: number;
  footprintWidthMm: number;
  footprintHeightMm: number;
  /** Size of the rotator before rotation is applied. */
  preWidthMm: number;
  preHeightMm: number;
  /** The `<img>` box inside the crop window. */
  imageWidthMm: number;
  imageHeightMm: number;
  imageLeftMm: number;
  imageTopMm: number;
  /** Degrees of rotation applied to the rotator. */
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  /** True when the placed image is larger than the frame and gets clipped. */
  clipped: boolean;
}

export interface ImageLayoutInput {
  element: ImageElement;
  /** Intrinsic pixel size of the source. */
  naturalWidthPx: number;
  naturalHeightPx: number;
  /** Resolution assumed by the "actual size" fit mode. */
  actualSizeDpi?: number;
}

const DEFAULT_ACTUAL_DPI = 300;

export function computeImageLayout(input: ImageLayoutInput): ImageLayout {
  const { element } = input;
  const frameWidthMm = Math.max(0.1, element.widthMm);
  const frameHeightMm = Math.max(0.1, element.heightMm);

  const crop = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const naturalWidthPx = input.naturalWidthPx > 0 ? input.naturalWidthPx : 1;
  const naturalHeightPx = input.naturalHeightPx > 0 ? input.naturalHeightPx : 1;

  const croppedWidthPx = naturalWidthPx * crop.width;
  const croppedHeightPx = naturalHeightPx * crop.height;

  const quarterTurn = element.imageRotation === 90 || element.imageRotation === 270;
  // After a quarter turn the image presents its other edge to the frame.
  const aspect = quarterTurn
    ? croppedHeightPx / croppedWidthPx
    : croppedWidthPx / croppedHeightPx;

  let footprintWidthMm: number;
  let footprintHeightMm: number;

  switch (element.fit) {
    case 'stretch':
      footprintWidthMm = frameWidthMm;
      footprintHeightMm = frameHeightMm;
      break;
    case 'fill': {
      // Cover: the shorter dimension is filled and the rest overflows.
      const scale = Math.max(frameWidthMm / aspect, frameHeightMm);
      footprintWidthMm = aspect * scale;
      footprintHeightMm = scale;
      break;
    }
    case 'actual': {
      const dpi = input.actualSizeDpi ?? DEFAULT_ACTUAL_DPI;
      const widthMm = (croppedWidthPx / dpi) * 25.4;
      const heightMm = (croppedHeightPx / dpi) * 25.4;
      footprintWidthMm = quarterTurn ? heightMm : widthMm;
      footprintHeightMm = quarterTurn ? widthMm : heightMm;
      break;
    }
    case 'custom': {
      const scale = Math.min(frameWidthMm / aspect, frameHeightMm) * element.scale;
      footprintWidthMm = aspect * scale;
      footprintHeightMm = scale;
      break;
    }
    case 'fit':
    default: {
      const scale = Math.min(frameWidthMm / aspect, frameHeightMm);
      footprintWidthMm = aspect * scale;
      footprintHeightMm = scale;
      break;
    }
  }

  // Centre in the frame, then apply the user's pan.
  const footprintXMm = (frameWidthMm - footprintWidthMm) / 2 + element.offsetXMm;
  const footprintYMm = (frameHeightMm - footprintHeightMm) / 2 + element.offsetYMm;

  // The rotator is the footprint with its axes swapped for a quarter turn, so
  // that rotating it lands exactly on the footprint.
  const preWidthMm = quarterTurn ? footprintHeightMm : footprintWidthMm;
  const preHeightMm = quarterTurn ? footprintWidthMm : footprintHeightMm;

  // Inside the crop window the image is scaled up so that the cropped region
  // exactly fills the window.
  const imageWidthMm = preWidthMm / Math.max(0.0001, crop.width);
  const imageHeightMm = preHeightMm / Math.max(0.0001, crop.height);

  return {
    footprintXMm,
    footprintYMm,
    footprintWidthMm,
    footprintHeightMm,
    preWidthMm,
    preHeightMm,
    imageWidthMm,
    imageHeightMm,
    imageLeftMm: -crop.x * imageWidthMm,
    imageTopMm: -crop.y * imageHeightMm,
    rotationDeg: element.imageRotation,
    scaleX: element.flipH ? -1 : 1,
    scaleY: element.flipV ? -1 : 1,
    clipped:
      footprintWidthMm > frameWidthMm + 0.01 ||
      footprintHeightMm > frameHeightMm + 0.01 ||
      footprintXMm < -0.01 ||
      footprintYMm < -0.01,
  };
}

/**
 * Frame size that shows a whole image at a given print size, used by
 * "fit frame to image" and by the artwork sizing controls.
 */
export function frameForImage(
  naturalWidthPx: number,
  naturalHeightPx: number,
  longestEdgeMm: number,
): { widthMm: number; heightMm: number } {
  if (naturalWidthPx <= 0 || naturalHeightPx <= 0) {
    return { widthMm: longestEdgeMm, heightMm: longestEdgeMm };
  }
  const aspect = naturalWidthPx / naturalHeightPx;
  return aspect >= 1
    ? { widthMm: longestEdgeMm, heightMm: longestEdgeMm / aspect }
    : { widthMm: longestEdgeMm * aspect, heightMm: longestEdgeMm };
}

/** Effective DPI of a placed image, honouring crop and fit. */
export function placedDpi(input: ImageLayoutInput): number {
  const layout = computeImageLayout(input);
  const crop = input.element.crop ?? { width: 1, height: 1 };
  const quarterTurn = input.element.imageRotation === 90 || input.element.imageRotation === 270;
  const pixelsAcross =
    (quarterTurn ? input.naturalHeightPx * crop.height : input.naturalWidthPx * crop.width) || 1;
  const inches = mmToInch(layout.footprintWidthMm);
  return inches > 0 ? pixelsAcross / inches : 0;
}
