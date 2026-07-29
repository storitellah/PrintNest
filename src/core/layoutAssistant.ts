import { assetOrientation } from './assets.ts';
import { contentBox } from './paper.ts';
import { createImageElement } from './project.ts';
import type { AssetMeta, ImageElement, Project } from './types.ts';

/**
 * The smart layout assistant.
 *
 * "Smart" here means arithmetic, not a model: everything runs locally on
 * aspect ratios and pixel counts. Nothing is uploaded, nothing is inferred
 * from image *content*, and every suggestion is optional.
 */

export interface LayoutSuggestion {
  id: string;
  title: string;
  detail: string;
  /** Applied to a draft project. */
  apply: (draft: Project) => void;
}

export interface ImageGrouping {
  portrait: AssetMeta[];
  landscape: AssetMeta[];
  square: AssetMeta[];
}

export function groupByOrientation(assets: AssetMeta[]): ImageGrouping {
  const grouping: ImageGrouping = { portrait: [], landscape: [], square: [] };
  for (const asset of assets) {
    if (!asset.widthPx || !asset.heightPx) continue;
    grouping[assetOrientation(asset)].push(asset);
  }
  return grouping;
}

/**
 * Choose a grid that wastes the least paper for a set of images.
 *
 * Scores every grid up to 6×6 by how much of the printable area the placed
 * images actually cover once each is fitted without cropping. The best score
 * wins; ties break towards fewer, larger cells.
 */
export function suggestGrid(
  assets: AssetMeta[],
  areaWidthMm: number,
  areaHeightMm: number,
  maxCells = 36,
): { columns: number; rows: number; coverage: number } {
  if (assets.length === 0 || areaWidthMm <= 0 || areaHeightMm <= 0) {
    return { columns: 1, rows: 1, coverage: 0 };
  }

  const ratios = assets
    .filter((asset) => asset.widthPx > 0 && asset.heightPx > 0)
    .map((asset) => asset.widthPx / asset.heightPx);
  if (ratios.length === 0) return { columns: 1, rows: 1, coverage: 0 };

  let best = { columns: 1, rows: 1, coverage: -1 };
  for (let columns = 1; columns <= 6; columns += 1) {
    for (let rows = 1; rows <= 6; rows += 1) {
      const cells = columns * rows;
      if (cells > maxCells) continue;
      if (cells < Math.min(ratios.length, maxCells) && cells < ratios.length) {
        // Allow fewer cells than images (multi-page), but do not reward it.
      }
      const cellWidth = areaWidthMm / columns;
      const cellHeight = areaHeightMm / rows;
      const cellArea = cellWidth * cellHeight;
      if (cellArea <= 0) continue;

      let used = 0;
      const sample = ratios.slice(0, cells);
      for (const ratio of sample) {
        const scale = Math.min(cellWidth / ratio, cellHeight);
        used += ratio * scale * scale;
      }
      const coverage = used / (cellArea * Math.max(1, sample.length));
      // Prefer grids that hold the whole set on one page.
      const completeness = Math.min(1, cells / ratios.length);
      const score = coverage * 0.75 + completeness * 0.25;
      if (score > best.coverage) best = { columns, rows, coverage: score };
    }
  }
  return best;
}

/**
 * Fill a page with images, one per cell, preserving aspect ratio.
 * Cropping is avoided: each image is fitted inside its cell, not cropped to it.
 */
export function autoPlaceImages(
  project: Project,
  assets: AssetMeta[],
  options: {
    columns: number;
    rows: number;
    gapMm: number;
    fit: 'fit' | 'fill';
    startPage?: number;
  },
): { pageIndex: number; elements: ImageElement[] }[] {
  const box = contentBox(
    { widthMm: project.pageWidthMm, heightMm: project.pageHeightMm },
    project.margins,
  );
  const { columns, rows, gapMm } = options;
  const cellWidth = (box.widthMm - gapMm * (columns - 1)) / columns;
  const cellHeight = (box.heightMm - gapMm * (rows - 1)) / rows;
  const perPage = columns * rows;
  const result: { pageIndex: number; elements: ImageElement[] }[] = [];

  for (let index = 0; index < assets.length; index += perPage) {
    const slice = assets.slice(index, index + perPage);
    const pageIndex = (options.startPage ?? 0) + result.length;
    const elements: ImageElement[] = slice.map((asset, cellIndex) => {
      const column = cellIndex % columns;
      const row = Math.floor(cellIndex / columns);
      const cellX = box.xMm + column * (cellWidth + gapMm);
      const cellY = box.yMm + row * (cellHeight + gapMm);

      if (options.fit === 'fill') {
        return createImageElement(
          asset.id,
          { xMm: cellX, yMm: cellY, widthMm: cellWidth, heightMm: cellHeight },
          { fit: 'fill' },
        );
      }

      // Shrink the frame to the image's own proportions so nothing is cropped
      // and the surrounding white space stays even.
      const ratio = asset.widthPx && asset.heightPx ? asset.widthPx / asset.heightPx : 1;
      const scale = Math.min(cellWidth / ratio, cellHeight);
      const widthMm = ratio * scale;
      const heightMm = scale;
      return createImageElement(
        asset.id,
        {
          xMm: cellX + (cellWidth - widthMm) / 2,
          yMm: cellY + (cellHeight - heightMm) / 2,
          widthMm,
          heightMm,
        },
        { fit: 'fit' },
      );
    });
    result.push({ pageIndex, elements });
  }

  return result;
}

/**
 * Suggestions offered in the assistant panel. Each carries an `apply` closure
 * so the interface stays a thin list renderer.
 */
export function buildSuggestions(project: Project): LayoutSuggestion[] {
  const suggestions: LayoutSuggestion[] = [];
  const { binding } = project.settings.imposition;

  // Booklet page counts.
  if ((binding === 'saddle-stitch' || binding === 'perfect-bound') && project.pages.length % 4 !== 0) {
    const needed = 4 - (project.pages.length % 4);
    suggestions.push({
      id: 'pad-four',
      title: `Round up to ${project.pages.length + needed} pages`,
      detail: 'Folded booklets always use pages in multiples of four.',
      apply: (draft) => {
        for (let i = 0; i < needed; i += 1) {
          draft.pages.splice(Math.max(0, draft.pages.length - 1), 0, {
            ...draft.pages[draft.pages.length - 1]!,
            id: `${draft.pages[draft.pages.length - 1]!.id}_blank_${i}`,
            elements: [],
            intentionallyBlank: true,
            role: 'content',
            name: '',
          });
        }
      },
    });
  }

  // Balance: pages that are much emptier than their neighbours.
  const density = project.pages.map((page) => page.elements.length);
  const busiest = Math.max(0, ...density);
  const sparse = density.filter((count) => count === 0).length;
  if (busiest >= 4 && sparse > 0) {
    suggestions.push({
      id: 'balance-white-space',
      title: 'Spread content across the empty pages',
      detail: `${sparse} page${sparse === 1 ? ' is' : 's are'} empty while others hold ${busiest} items. Moving a few across evens out the white space.`,
      apply: () => {
        /* Advisory only — moving content automatically would be too invasive. */
      },
    });
  }

  // Orientation grouping.
  const grouping = groupByOrientation(project.assets);
  if (grouping.portrait.length >= 2 && grouping.landscape.length >= 2) {
    suggestions.push({
      id: 'group-orientation',
      title: 'Group portrait and landscape images separately',
      detail: `You have ${grouping.portrait.length} upright and ${grouping.landscape.length} wide images. Keeping each kind together avoids awkward gaps.`,
      apply: (draft) => {
        const order = [...grouping.portrait, ...grouping.landscape, ...grouping.square].map(
          (asset) => asset.id,
        );
        const rank = new Map(order.map((id, index) => [id, index]));
        for (const page of draft.pages) {
          page.elements.sort((a, b) => {
            if (a.type !== 'image' || b.type !== 'image') return 0;
            return (rank.get(a.assetId) ?? 0) - (rank.get(b.assetId) ?? 0);
          });
        }
      },
    });
  }

  // Unplaced assets.
  const placed = new Set<string>();
  for (const page of project.pages) {
    for (const element of page.elements) {
      if (element.type === 'image') placed.add(element.assetId);
    }
  }
  const unplaced = project.assets.filter(
    (asset) => !placed.has(asset.id) && asset.widthPx > 0,
  );
  if (unplaced.length > 0) {
    const box = contentBox(
      { widthMm: project.pageWidthMm, heightMm: project.pageHeightMm },
      project.margins,
    );
    const grid = suggestGrid(unplaced, box.widthMm, box.heightMm);
    suggestions.push({
      id: 'place-unplaced',
      title: `Place ${unplaced.length} imported image${unplaced.length === 1 ? '' : 's'}`,
      detail: `A ${grid.columns} × ${grid.rows} grid fits them with the least wasted paper.`,
      apply: (draft) => {
        const pages = autoPlaceImages(draft, unplaced, {
          columns: grid.columns,
          rows: grid.rows,
          gapMm: 4,
          fit: 'fit',
          startPage: draft.pages.length,
        });
        for (const { elements } of pages) {
          draft.pages.push({
            id: `page_auto_${draft.pages.length}`,
            name: '',
            backgroundColor: '#FFFFFF',
            elements,
            intentionallyBlank: false,
            role: 'content',
          });
        }
      },
    });
  }

  // Low-resolution warnings that a smaller frame would fix.
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  let lowCount = 0;
  for (const page of project.pages) {
    for (const element of page.elements) {
      if (element.type !== 'image') continue;
      const asset = assets.get(element.assetId);
      if (!asset || !asset.widthPx) continue;
      const dpi = (asset.widthPx / element.widthMm) * 25.4;
      if (dpi < 150) lowCount += 1;
    }
  }
  if (lowCount > 0) {
    suggestions.push({
      id: 'shrink-low-res',
      title: `Shrink ${lowCount} low-resolution image${lowCount === 1 ? '' : 's'} to a safe size`,
      detail: 'Each frame is reduced until it reaches 150 dots per inch, and stays centred.',
      apply: (draft) => {
        for (const page of draft.pages) {
          for (const element of page.elements) {
            if (element.type !== 'image') continue;
            const asset = assets.get(element.assetId);
            if (!asset || !asset.widthPx || !asset.heightPx) continue;
            const dpi = (asset.widthPx / element.widthMm) * 25.4;
            if (dpi >= 150) continue;
            const factor = dpi / 150;
            const centreX = element.xMm + element.widthMm / 2;
            const centreY = element.yMm + element.heightMm / 2;
            element.widthMm *= factor;
            element.heightMm *= factor;
            element.xMm = centreX - element.widthMm / 2;
            element.yMm = centreY - element.heightMm / 2;
          }
        }
      },
    });
  }

  return suggestions;
}

/**
 * Detect gaps in a book: pages that carry a number but no content around them,
 * which usually means a spread was deleted by accident.
 */
export function detectMissingPages(project: Project): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < project.pages.length - 1; index += 1) {
    const previous = project.pages[index - 1]!;
    const current = project.pages[index]!;
    const next = project.pages[index + 1]!;
    if (
      current.elements.length === 0 &&
      !current.intentionallyBlank &&
      previous.elements.length > 0 &&
      next.elements.length > 0
    ) {
      gaps.push(index);
    }
  }
  return gaps;
}
