import type { GuideLine, ImpositionResult, PrintSheet } from '../core/imposition.ts';
import { planPoster } from '../core/poster.ts';
import type { PosterPlan, PosterTile } from '../core/poster.ts';
import { cachedObjectUrl } from '../core/assets.ts';
import { projectSheet } from '../core/project.ts';
import type { Project } from '../core/types.ts';
import { renderCropMarks, renderPage } from './pageRender.ts';

/**
 * Sheet rendering.
 *
 * Takes the imposition plan and produces the physical sheets: each one a
 * paper-sized element with the document pages scaled and rotated into their
 * slots, plus fold, cut and crop guides.
 */

function mm(value: number): string {
  return `${Math.round(value * 1e4) / 1e4}mm`;
}

export interface RenderSheetOptions {
  project: Project;
  sheet: PrintSheet;
  result: ImpositionResult;
  /** Draw fold/cut guides. Off for the final print when the user prefers clean. */
  showGuides: boolean;
  /** Preview only: tint blank slots so missing pages are obvious. */
  markBlanks?: boolean;
}

export function renderSheet(options: RenderSheetOptions): HTMLElement {
  const { project, sheet, result } = options;
  const root = document.createElement('div');
  root.className = 'pn-sheet';
  root.dataset.sheetNumber = String(sheet.sheetNumber);
  root.dataset.side = sheet.side;
  root.style.width = mm(result.sheetSize.widthMm);
  root.style.height = mm(result.sheetSize.heightMm);

  for (const slot of sheet.slots) {
    const holder = document.createElement('div');
    holder.className = 'pn-slot';
    holder.style.left = mm(slot.rect.xMm);
    holder.style.top = mm(slot.rect.yMm);
    holder.style.width = mm(slot.rect.widthMm);
    holder.style.height = mm(slot.rect.heightMm);

    if (slot.pageIndex === null) {
      if (options.markBlanks) {
        holder.classList.add('pn-slot--blank');
        const label = document.createElement('span');
        label.textContent = 'Blank';
        holder.append(label);
      }
      root.append(holder);
      continue;
    }

    const page = project.pages[slot.pageIndex];
    if (!page) {
      root.append(holder);
      continue;
    }

    const pageNode = renderPage({
      project,
      page,
      pageIndex: slot.pageIndex,
      draft: false,
    });

    // The slot may be smaller than the page (imposition scales down); apply the
    // ratio as a transform so the page's own millimetre layout is untouched.
    const scale = slot.rect.widthMm / project.pageWidthMm;
    const transforms: string[] = [];
    if (slot.rotation) transforms.push(`rotate(${slot.rotation}deg)`);
    if (Math.abs(scale - 1) > 1e-6) transforms.push(`scale(${scale})`);
    if (transforms.length > 0) {
      pageNode.style.transform = transforms.join(' ');
      pageNode.style.transformOrigin = 'center center';
      // Centre the unscaled page inside the slot before transforming.
      pageNode.style.position = 'absolute';
      pageNode.style.left = mm((slot.rect.widthMm - project.pageWidthMm) / 2);
      pageNode.style.top = mm((slot.rect.heightMm - project.pageHeightMm) / 2);
    }

    holder.append(pageNode);
    root.append(holder);
  }

  if (options.showGuides && sheet.guides.length > 0) {
    root.append(renderGuides(sheet.guides, result.sheetSize.widthMm, result.sheetSize.heightMm));
  }

  if (project.settings.marks.cropMarks) {
    root.append(
      renderCropMarks({
        sheetWidthMm: result.sheetSize.widthMm,
        sheetHeightMm: result.sheetSize.heightMm,
        trimBoxes: sheet.slots.map((slot) => slot.rect),
        bleedMm: project.settings.marks.bleedMm,
        markLengthMm: project.settings.marks.cropMarkLengthMm,
        registration: project.settings.marks.registrationMarks,
      }),
    );
  }

  return root;
}

function renderGuides(guides: GuideLine[], widthMm: number, heightMm: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pn-guides');
  svg.setAttribute('viewBox', `0 0 ${widthMm} ${heightMm}`);
  svg.setAttribute('width', mm(widthMm));
  svg.setAttribute('height', mm(heightMm));
  svg.setAttribute('aria-hidden', 'true');

  for (const guide of guides) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(guide.x1Mm));
    line.setAttribute('y1', String(guide.y1Mm));
    line.setAttribute('x2', String(guide.x2Mm));
    line.setAttribute('y2', String(guide.y2Mm));
    line.setAttribute('class', `pn-guide pn-guide--${guide.kind}`);
    switch (guide.kind) {
      case 'fold':
        line.setAttribute('stroke', '#B4AFA5');
        line.setAttribute('stroke-width', '0.2');
        line.setAttribute('stroke-dasharray', '3 2');
        break;
      case 'slit':
        line.setAttribute('stroke', '#C94A4A');
        line.setAttribute('stroke-width', '0.4');
        break;
      case 'cut':
        line.setAttribute('stroke', '#8C877D');
        line.setAttribute('stroke-width', '0.2');
        line.setAttribute('stroke-dasharray', '1 1.5');
        break;
      case 'alignment':
        line.setAttribute('stroke', '#3D66F5');
        line.setAttribute('stroke-width', '0.3');
        break;
    }
    svg.append(line);
  }

  return svg;
}

/* ------------------------------------------------------------------ *
 * Poster tiles
 * ------------------------------------------------------------------ */

export interface RenderPosterOptions {
  project: Project;
  showLabels: boolean;
  showCutMarks: boolean;
  showAlignmentMarks: boolean;
}

/** Render every tile of a tiled poster as its own sheet element. */
export function renderPosterSheets(options: RenderPosterOptions): {
  plan: PosterPlan;
  sheets: HTMLElement[];
} {
  const { project } = options;
  const sheet = projectSheet(project);
  const settings = project.settings.poster;
  const plan = planPoster({
    posterWidthMm: settings.targetWidthMm,
    posterHeightMm: settings.targetHeightMm,
    sheet,
    margins: project.margins,
    overlapMm: settings.overlapMm,
    ...(settings.autoGrid ? {} : { columns: settings.columns, rows: settings.rows }),
  });

  const asset = settings.assetId
    ? project.assets.find((entry) => entry.id === settings.assetId)
    : undefined;
  const url = asset ? cachedObjectUrl(asset.id) : null;

  const sheets = plan.tiles.map((tile) =>
    renderPosterTile(tile, plan, sheet, url, asset?.name ?? '', options),
  );

  return { plan, sheets };
}

function renderPosterTile(
  tile: PosterTile,
  plan: PosterPlan,
  sheet: { widthMm: number; heightMm: number },
  url: string | null,
  altText: string,
  options: RenderPosterOptions,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pn-sheet pn-sheet--poster';
  root.dataset.tile = tile.code;
  root.style.width = mm(sheet.widthMm);
  root.style.height = mm(sheet.heightMm);

  const window = document.createElement('div');
  window.className = 'pn-poster-window';
  window.style.left = mm(tile.destXMm);
  window.style.top = mm(tile.destYMm);
  window.style.width = mm(tile.destWidthMm);
  window.style.height = mm(tile.destHeightMm);

  if (url) {
    const image = document.createElement('img');
    image.className = 'pn-poster-image';
    image.src = url;
    image.alt = altText;
    image.draggable = false;
    // The whole poster is laid out, then shifted so this tile's slice shows.
    image.style.width = mm(plan.posterWidthMm);
    image.style.height = mm(plan.posterHeightMm);
    image.style.left = mm(-tile.sourceXMm);
    image.style.top = mm(-tile.sourceYMm);
    window.append(image);
  } else {
    window.classList.add('pn-poster-window--empty');
    const notice = document.createElement('span');
    notice.textContent = 'Choose an image to tile';
    window.append(notice);
  }

  root.append(window);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pn-guides');
  svg.setAttribute('viewBox', `0 0 ${sheet.widthMm} ${sheet.heightMm}`);
  svg.setAttribute('width', mm(sheet.widthMm));
  svg.setAttribute('height', mm(sheet.heightMm));
  svg.setAttribute('aria-hidden', 'true');

  const addLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    dash?: string,
  ): void => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', '0.25');
    if (dash) line.setAttribute('stroke-dasharray', dash);
    svg.append(line);
  };

  if (options.showCutMarks) {
    const left = tile.destXMm;
    const top = tile.destYMm;
    const right = tile.destXMm + tile.destWidthMm;
    const bottom = tile.destYMm + tile.destHeightMm;
    addLine(left, 0, left, sheet.heightMm, '#8C877D', '1 1.5');
    addLine(right, 0, right, sheet.heightMm, '#8C877D', '1 1.5');
    addLine(0, top, sheet.widthMm, top, '#8C877D', '1 1.5');
    addLine(0, bottom, sheet.widthMm, bottom, '#8C877D', '1 1.5');
  }

  if (options.showAlignmentMarks && plan.overlapMm > 0) {
    // Dashed line showing where the neighbouring sheet's edge should land.
    if (tile.overlapEdges.right) {
      const x = tile.destXMm + tile.destWidthMm - plan.overlapMm;
      addLine(x, tile.destYMm, x, tile.destYMm + tile.destHeightMm, '#3D66F5', '2 2');
    }
    if (tile.overlapEdges.bottom) {
      const y = tile.destYMm + tile.destHeightMm - plan.overlapMm;
      addLine(tile.destXMm, y, tile.destXMm + tile.destWidthMm, y, '#3D66F5', '2 2');
    }
  }

  root.append(svg);

  if (options.showLabels) {
    const label = document.createElement('div');
    label.className = 'pn-poster-label';
    label.textContent = `${tile.code}  ·  sheet ${tile.number} of ${plan.sheetCount}`;
    root.append(label);
  }

  return root;
}

/** A printable map showing which tile goes where. */
export function renderAssemblyMap(plan: PosterPlan, sheet: { widthMm: number; heightMm: number }): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pn-sheet pn-sheet--map';
  root.style.width = mm(sheet.widthMm);
  root.style.height = mm(sheet.heightMm);

  const title = document.createElement('h2');
  title.className = 'pn-map__title';
  title.textContent = 'Assembly map';
  root.append(title);

  const note = document.createElement('p');
  note.className = 'pn-map__note';
  note.textContent = `Lay the sheets out in this order. Finished poster: ${Math.round(
    plan.posterWidthMm,
  )} × ${Math.round(plan.posterHeightMm)} mm across ${plan.sheetCount} sheets.`;
  root.append(note);

  const grid = document.createElement('div');
  grid.className = 'pn-map__grid';
  grid.style.gridTemplateColumns = `repeat(${plan.columns}, 1fr)`;
  for (const tile of plan.tiles) {
    const cell = document.createElement('div');
    cell.className = 'pn-map__cell';
    const code = document.createElement('strong');
    code.textContent = tile.code;
    const number = document.createElement('span');
    number.textContent = `Sheet ${tile.number}`;
    cell.append(code, number);
    grid.append(cell);
  }
  root.append(grid);

  const steps = document.createElement('ol');
  steps.className = 'pn-map__steps';
  for (const instruction of plan.instructions) {
    const item = document.createElement('li');
    item.textContent = instruction;
    steps.append(item);
  }
  root.append(steps);

  return root;
}
