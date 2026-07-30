import type { AssetMeta, InkSettings, Page, Project } from './types.ts';

/**
 * Ink usage estimation and ink-saving mode.
 *
 * A browser cannot know how much ink a print will use — that depends on the
 * driver's halftoning, the paper type, the quality setting and the cartridge.
 * What PrintNest *can* do honestly is estimate **relative** coverage: what
 * proportion of each page is covered by dark or saturated material.
 *
 * The interface therefore reports low / medium / high, never millilitres or
 * money, unless the user supplies their own cartridge yield.
 */

export type InkLevel = 'low' | 'medium' | 'high';

export interface InkEstimate {
  level: InkLevel;
  /** 0–1: share of the page area carrying ink, weighted by darkness. */
  coverage: number;
  label: string;
  detail: string;
  /** Pages sorted worst-first, for the "these pages are ink-heavy" list. */
  heaviestPages: { pageIndex: number; coverage: number }[];
}

const LEVEL_LABELS: Record<InkLevel, string> = {
  low: 'Low ink use',
  medium: 'Medium ink use',
  high: 'High ink use',
};

/**
 * Coverage of a single page.
 *
 * Images count their full area at a weight reflecting that photographs are
 * mostly mid-tone; solid fills count at their own darkness; text counts at a
 * small fraction of its box, because glyphs cover far less than their bounds.
 */
export function pageCoverage(page: Page, pageAreaMm2: number, assets: Map<string, AssetMeta>): number {
  if (pageAreaMm2 <= 0) return 0;
  let inked = 0;

  const background = darkness(page.backgroundColor);
  if (background > 0.05) inked += pageAreaMm2 * background;

  for (const element of page.elements) {
    if (element.hidden) continue;
    const area = Math.max(0, element.widthMm) * Math.max(0, element.heightMm);
    if (area <= 0) continue;

    switch (element.type) {
      case 'image': {
        const asset = assets.get(element.assetId);
        // Vector art is usually flat and light; photographs are dense.
        const weight = asset?.type === 'image/svg+xml' ? 0.35 : 0.72;
        inked += area * weight * element.opacity;
        break;
      }
      case 'text': {
        // A dense paragraph covers roughly 12 % of its box with glyph strokes.
        const fill = element.backgroundColor ? darkness(element.backgroundColor) : 0;
        inked += area * fill * element.opacity;
        inked += area * 0.12 * darkness(element.color) * element.opacity;
        break;
      }
      case 'page-number':
        inked += area * 0.06 * darkness(element.color);
        break;
      case 'shape': {
        if (element.fill) inked += area * darkness(element.fill) * element.opacity;
        if (element.stroke) {
          const perimeter = 2 * (element.widthMm + element.heightMm);
          inked += perimeter * element.strokeMm * darkness(element.stroke) * element.opacity;
        }
        break;
      }
    }
  }

  return Math.min(1, inked / pageAreaMm2);
}

export function estimateInk(project: Project): InkEstimate {
  const pageAreaMm2 = project.pageWidthMm * project.pageHeightMm;
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));

  const perPage = project.pages.map((page, pageIndex) => ({
    pageIndex,
    coverage: pageCoverage(page, pageAreaMm2, assets),
  }));

  const coverage =
    perPage.length === 0 ? 0 : perPage.reduce((sum, page) => sum + page.coverage, 0) / perPage.length;

  const adjusted = project.settings.ink.enabled ? coverage * inkSavingFactor(project.settings.ink) : coverage;

  const level: InkLevel = adjusted >= 0.45 ? 'high' : adjusted >= 0.18 ? 'medium' : 'low';

  return {
    level,
    coverage: adjusted,
    label: LEVEL_LABELS[level],
    detail: DETAILS[level],
    heaviestPages: [...perPage].sort((a, b) => b.coverage - a.coverage).slice(0, 5),
  };
}

const DETAILS: Record<InkLevel, string> = {
  low: 'Mostly white paper. This should be cheap to print.',
  medium: 'A normal mix of images and text.',
  high: 'Large dark or photographic areas. Consider ink-saving mode, or draft quality for proofs.',
};

/** How much ink-saving mode is expected to reduce coverage by. */
export function inkSavingFactor(settings: InkSettings): number {
  let factor = 1;
  if (settings.greyscale) factor *= 0.72;
  if (settings.removeBackgrounds) factor *= 0.78;
  factor *= 0.4 + 0.6 * settings.imageDensity;
  return factor;
}

/**
 * Optional cost estimate. Only produced when the user has told PrintNest what
 * a cartridge costs and how many pages it claims — otherwise the honest answer
 * is that we do not know.
 */
export interface CartridgeInfo {
  costPerSet: number;
  pageYield: number;
  currency: string;
}

export function estimateCost(
  estimate: InkEstimate,
  sheetCount: number,
  cartridge: CartridgeInfo | null,
): string | null {
  if (!cartridge || cartridge.pageYield <= 0 || cartridge.costPerSet <= 0) return null;
  // Manufacturer page yields assume roughly 5 % coverage (ISO/IEC 24711).
  const referenceCoverage = 0.05;
  const relative = Math.max(0.2, estimate.coverage / referenceCoverage);
  const costPerPage = cartridge.costPerSet / cartridge.pageYield;
  const total = costPerPage * relative * sheetCount;
  return `About ${cartridge.currency}${total.toFixed(2)} of ink for ${sheetCount} sheet${
    sheetCount === 1 ? '' : 's'
  } — a rough guide only, based on the yield figure you entered.`;
}

/**
 * CSS filter applied to the preview and to the print output when ink-saving
 * mode is on. Kept as a string so both the screen renderer and the print
 * stylesheet use exactly the same transform.
 */
export function inkFilter(settings: InkSettings): string {
  if (!settings.enabled) return '';
  const filters: string[] = [];
  if (settings.greyscale) filters.push('grayscale(1)');
  if (settings.imageDensity < 1) {
    // Lifting brightness and dropping contrast lays down measurably less ink
    // while keeping the image readable.
    const brightness = 1 + (1 - settings.imageDensity) * 0.35;
    const contrast = 1 - (1 - settings.imageDensity) * 0.2;
    filters.push(`brightness(${brightness.toFixed(3)})`, `contrast(${contrast.toFixed(3)})`);
  }
  return filters.join(' ');
}

/** Pages worth warning about individually. */
export function inkHeavyPages(project: Project, threshold = 0.5): number[] {
  const pageAreaMm2 = project.pageWidthMm * project.pageHeightMm;
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  return project.pages
    .map((page, index) => ({ index, coverage: pageCoverage(page, pageAreaMm2, assets) }))
    .filter((entry) => entry.coverage >= threshold)
    .map((entry) => entry.index);
}

function darkness(color: string): number {
  const hex = color.trim().replace('#', '');
  if (color === 'transparent') return 0;
  let r: number;
  let g: number;
  let b: number;
  let a = 1;

  if (hex.length === 3 || hex.length === 4) {
    r = Number.parseInt(hex[0]! + hex[0]!, 16);
    g = Number.parseInt(hex[1]! + hex[1]!, 16);
    b = Number.parseInt(hex[2]! + hex[2]!, 16);
    if (hex.length === 4) a = Number.parseInt(hex[3]! + hex[3]!, 16) / 255;
  } else if (hex.length === 6 || hex.length === 8) {
    r = Number.parseInt(hex.slice(0, 2), 16);
    g = Number.parseInt(hex.slice(2, 4), 16);
    b = Number.parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) a = Number.parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    const match = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i.exec(color);
    if (!match) return 0;
    r = Number(match[1]);
    g = Number(match[2]);
    b = Number(match[3]);
    a = match[4] === undefined ? 1 : Number(match[4]);
  }

  if (![r, g, b].every(Number.isFinite)) return 0;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return Math.max(0, Math.min(1, (1 - luma) * a));
}
