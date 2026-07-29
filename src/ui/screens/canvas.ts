import { preloadAssets } from '../../core/assets.ts';
import { imposeProject } from '../../core/imposition.ts';
import { projectSheet } from '../../core/project.ts';
import { store } from '../../core/store.ts';
import type { ViewMode } from '../../core/store.ts';
import { renderPage } from '../../render/pageRender.ts';
import { renderAssemblyMap, renderPosterSheets, renderSheet } from '../../render/sheetRender.ts';
import { mmToCssPx } from '../../core/units.ts';
import { attachSelectionOverlay } from '../editorInteractions.ts';
import type { SelectionOverlay } from '../editorInteractions.ts';
import { animate, el, prefersReducedMotion, rafThrottle } from '../dom.ts';
import { emptyArt, icon } from '../icons.ts';

/**
 * The canvas: everything between the two side panels.
 *
 * Five views share one renderer:
 *   pages      — one page at a time, editable
 *   spreads    — facing pages, as the reader will see them
 *   sheets     — the imposed print sheets, exactly as they will print
 *   thumbnails — a virtualised grid for long documents
 *   reading    — a full-width page turner
 *
 * Only the `pages` view is editable; the others are previews, which keeps the
 * interaction model simple — you never wonder whether a drag will move a page
 * or move an element.
 */

export interface CanvasController {
  root: HTMLElement;
  render: () => void;
  destroy: () => void;
}

/** Thumbnails beyond this many pages are rendered lazily as they scroll in. */
const VIRTUALISE_THRESHOLD = 24;

export function createCanvas(): CanvasController {
  const scroll = el('div', {
    class: 'pn-canvas__scroll',
    id: 'pn-canvas',
    tabindex: '-1',
  });
  const toolbar = el('div', { class: 'pn-canvas__toolbar', role: 'toolbar', 'aria-label': 'Preview controls' });
  const root = el('main', { class: 'pn-canvas' }, toolbar, scroll);

  let overlay: SelectionOverlay | null = null;
  let observer: IntersectionObserver | null = null;
  let lastPageIndex = -1;

  const renderNow = (): void => {
    const project = store.project;
    if (!project) return;

    overlay?.destroy();
    overlay = null;
    observer?.disconnect();
    observer = null;

    renderToolbar(toolbar, renderNow);

    const scrollTop = scroll.scrollTop;
    scroll.replaceChildren();

    switch (store.ui.view) {
      case 'sheets':
        renderSheetsView(scroll);
        break;
      case 'spreads':
        renderSpreadsView(scroll);
        break;
      case 'thumbnails':
        observer = renderThumbnailsView(scroll, renderNow);
        break;
      case 'reading':
        renderReadingView(scroll);
        break;
      case 'pages':
      default:
        overlay = renderPagesView(scroll, renderNow);
        break;
    }

    scroll.scrollTop = scrollTop;

    // A page turn animation when moving through the reading view.
    if (store.ui.view === 'reading' && store.ui.selection.pageIndex !== lastPageIndex) {
      const stage = scroll.querySelector<HTMLElement>('.pn-stage');
      if (stage) animate(stage, 'pn-pageturn', 400);
    }
    lastPageIndex = store.ui.selection.pageIndex;
  };

  const render = rafThrottle(renderNow);

  // Warm the image cache, then draw. Without this the first paint of a
  // freshly-opened project shows empty frames.
  void (async () => {
    const project = store.project;
    if (project) await preloadAssets(project.assets.map((asset) => asset.id));
    renderNow();
  })();

  const unsubscribe = store.subscribe(render);
  const onResize = rafThrottle(() => renderNow());
  window.addEventListener('resize', onResize);

  return {
    root,
    render: renderNow,
    destroy: () => {
      unsubscribe();
      window.removeEventListener('resize', onResize);
      overlay?.destroy();
      observer?.disconnect();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: Parameters<typeof icon>[0] }[] = [
  { value: 'pages', label: 'Pages', icon: 'pages' },
  { value: 'spreads', label: 'Spreads', icon: 'booklet' },
  { value: 'sheets', label: 'Print sheets', icon: 'sheets' },
  { value: 'thumbnails', label: 'Thumbnails', icon: 'grid' },
  { value: 'reading', label: 'Reading', icon: 'reading' },
];

function renderToolbar(toolbar: HTMLElement, rerender: () => void): void {
  const project = store.project;
  toolbar.replaceChildren();
  if (!project) return;

  const viewGroup = el('div', {
    class: 'pn-segment',
    role: 'radiogroup',
    'aria-label': 'Preview mode',
  });
  for (const option of VIEW_OPTIONS) {
    viewGroup.append(
      el(
        'button',
        {
          type: 'button',
          class: 'pn-segment__option',
          role: 'radio',
          'aria-checked': String(store.ui.view === option.value),
          tabindex: store.ui.view === option.value ? '0' : '-1',
          onclick: () => {
            store.setUi({ view: option.value });
            rerender();
          },
        },
        icon(option.icon, { size: 15 }),
        el('span', { class: 'pn-desktop-only', text: option.label }),
      ),
    );
  }
  toolbar.append(viewGroup);

  // Zoom.
  const zoomLabel = el('span', {
    class: 'pn-savestate',
    text: store.ui.zoomToFit ? 'Fit' : `${Math.round(store.ui.zoom * 100)}%`,
    'aria-live': 'polite',
  });
  toolbar.append(
    el(
      'div',
      { class: 'pn-segment', role: 'group', 'aria-label': 'Zoom' },
      el(
        'button',
        {
          type: 'button',
          class: 'pn-segment__option',
          'aria-label': 'Zoom out',
          onclick: () => {
            store.setUi({ zoomToFit: false, zoom: Math.max(0.1, store.ui.zoom - 0.1) });
            rerender();
          },
        },
        icon('zoom-out', { size: 15 }),
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-segment__option',
          text: 'Fit',
          'aria-pressed': String(store.ui.zoomToFit),
          onclick: () => {
            store.setUi({ zoomToFit: true });
            rerender();
          },
        },
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-segment__option',
          'aria-label': 'Zoom in',
          onclick: () => {
            store.setUi({ zoomToFit: false, zoom: Math.min(4, store.ui.zoom + 0.1) });
            rerender();
          },
        },
        icon('zoom-in', { size: 15 }),
      ),
    ),
    zoomLabel,
  );

  // Guides.
  const toggles: { key: 'showGrid' | 'showGuides' | 'showSafeArea' | 'showBleed' | 'snapEnabled'; label: string }[] = [
    { key: 'showGuides', label: 'Margins' },
    { key: 'showSafeArea', label: 'Safe area' },
    { key: 'showBleed', label: 'Bleed' },
    { key: 'showGrid', label: 'Grid' },
    { key: 'snapEnabled', label: 'Snap' },
  ];
  const guideGroup = el('div', { class: 'pn-segment pn-desktop-only', role: 'group', 'aria-label': 'Guides' });
  for (const toggle of toggles) {
    guideGroup.append(
      el('button', {
        type: 'button',
        class: 'pn-segment__option',
        text: toggle.label,
        'aria-pressed': String(store.ui[toggle.key]),
        onclick: () => {
          store.setUi({ [toggle.key]: !store.ui[toggle.key] } as never);
          rerender();
        },
      }),
    );
  }
  toolbar.append(guideGroup);

  const pageCount = project.pages.length;
  toolbar.append(
    el('span', {
      class: 'pn-savestate',
      style: { marginLeft: 'auto' },
      text: `${pageCount} page${pageCount === 1 ? '' : 's'}`,
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Scaling
 * ------------------------------------------------------------------ */

/** Scale that fits a page of `widthMm` into the visible canvas width. */
function fitScale(container: HTMLElement, widthMm: number, heightMm: number): number {
  const available = container.clientWidth - 64;
  const availableHeight = container.clientHeight - 96;
  if (available <= 0) return 1;
  const byWidth = available / mmToCssPx(widthMm);
  const byHeight = availableHeight > 0 ? availableHeight / mmToCssPx(heightMm) : byWidth;
  return Math.max(0.06, Math.min(byWidth, byHeight, 2.5));
}

function resolveScale(container: HTMLElement, widthMm: number, heightMm: number): number {
  return store.ui.zoomToFit ? fitScale(container, widthMm, heightMm) : store.ui.zoom;
}

/**
 * Wrap a rendered page or sheet in a stage box.
 *
 * The inner element keeps its true millimetre size; the wrapper is sized in
 * pixels to the scaled result, so the scroll container measures correctly.
 */
function stage(content: HTMLElement, widthMm: number, heightMm: number, scale: number, label?: string): HTMLElement {
  const box = el('div', { class: 'pn-stage' });
  box.style.width = `${mmToCssPx(widthMm) * scale}px`;
  box.style.height = `${mmToCssPx(heightMm) * scale}px`;

  content.style.transform = `scale(${scale})`;
  content.style.transformOrigin = 'top left';
  content.style.position = 'absolute';
  content.style.top = '0';
  content.style.left = '0';
  box.append(content);

  if (label) {
    box.append(el('span', { class: 'pn-stage__label', text: label }));
  }
  return box;
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function renderPagesView(container: HTMLElement, rerender: () => void): SelectionOverlay | null {
  const project = store.project!;
  const pageIndex = Math.min(store.ui.selection.pageIndex, project.pages.length - 1);
  const page = project.pages[pageIndex];
  if (!page) {
    container.append(emptyState('no-pages', 'This project has no pages', 'Add a page from the panel on the left.'));
    return null;
  }

  const scale = resolveScale(container, project.pageWidthMm, project.pageHeightMm);
  const pageNode = renderPage({
    project,
    page,
    pageIndex,
    overlays: {
      margins: store.ui.showGuides,
      safeArea: store.ui.showSafeArea,
      bleed: store.ui.showBleed,
      grid: store.ui.showGrid,
      gridSizeMm: 5,
    },
    interactive: true,
  });

  const box = stage(pageNode, project.pageWidthMm, project.pageHeightMm, scale, pageLabelFor(pageIndex));
  box.classList.add('pn-stage--editable');
  container.append(box);

  const overlay = attachSelectionOverlay({
    stage: box,
    pageIndex,
    scale,
    onChange: rerender,
  });
  box.append(overlay.root);

  container.append(pageStepper(pageIndex, project.pages.length));
  return overlay;
}

function renderSpreadsView(container: HTMLElement): null {
  const project = store.project!;
  const scale = resolveScale(container, project.pageWidthMm * 2, project.pageHeightMm);

  // Page 1 stands alone on the right, as a cover does when the booklet is shut.
  const spreads: (number | null)[][] = [[null, 0]];
  for (let index = 1; index < project.pages.length; index += 2) {
    spreads.push([index, index + 1 < project.pages.length ? index + 1 : null]);
  }

  for (const [left, right] of spreads) {
    const row = el('div', { class: 'pn-spread' });
    for (const index of [left, right]) {
      if (index === null || index === undefined) {
        const blank = el('div');
        blank.style.width = `${mmToCssPx(project.pageWidthMm) * scale}px`;
        blank.style.height = `${mmToCssPx(project.pageHeightMm) * scale}px`;
        row.append(blank);
        continue;
      }
      const page = project.pages[index];
      if (!page) continue;
      const node = renderPage({ project, page, pageIndex: index });
      const box = stage(node, project.pageWidthMm, project.pageHeightMm, scale, pageLabelFor(index));
      box.addEventListener('click', () => store.selectPage(index));
      row.append(box);
    }
    container.append(row);
  }
  return null;
}

function renderSheetsView(container: HTMLElement): null {
  const project = store.project!;

  if (project.kind === 'poster') {
    const { plan, sheets } = renderPosterSheets({
      project,
      showLabels: project.settings.poster.pageLabels,
      showCutMarks: project.settings.poster.cutMarks,
      showAlignmentMarks: project.settings.poster.alignmentMarks,
    });
    const sheetSize = projectSheet(project);
    const scale = resolveScale(container, sheetSize.widthMm, sheetSize.heightMm);
    plan.tiles.forEach((tile, index) => {
      const node = sheets[index];
      if (!node) return;
      container.append(
        stage(node, sheetSize.widthMm, sheetSize.heightMm, scale, `Tile ${tile.code} — sheet ${tile.number} of ${plan.sheetCount}`),
      );
    });
    if (project.settings.poster.assemblyMap) {
      container.append(
        stage(renderAssemblyMap(plan, sheetSize), sheetSize.widthMm, sheetSize.heightMm, scale, 'Assembly map'),
      );
    }
    return null;
  }

  const result = imposeProject(project);
  const scale = resolveScale(container, result.sheetSize.widthMm, result.sheetSize.heightMm);

  for (const sheet of result.sheets) {
    const node = renderSheet({ project, sheet, result, showGuides: true, markBlanks: true });
    container.append(stage(node, result.sheetSize.widthMm, result.sheetSize.heightMm, scale, sheet.label));
  }

  if (result.instructions.length > 0) {
    container.append(
      el(
        'div',
        { class: 'pn-card', style: { maxWidth: '56ch' } },
        el('h3', { text: 'After printing', style: { marginBottom: '0.5rem' } }),
        el(
          'ol',
          { class: 'pn-map__steps', style: { paddingLeft: '1.2rem' } },
          ...result.instructions.map((instruction) => el('li', { text: instruction })),
        ),
      ),
    );
  }
  return null;
}

function renderThumbnailsView(container: HTMLElement, rerender: () => void): IntersectionObserver | null {
  const project = store.project!;
  const grid = el('div', {
    class: 'pn-template-grid',
    style: { width: '100%', maxWidth: '1000px' },
    role: 'list',
  });

  const scale = 0.16;
  const virtualise = project.pages.length > VIRTUALISE_THRESHOLD;
  let observer: IntersectionObserver | null = null;

  if (virtualise) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const holder = entry.target as HTMLElement;
          const index = Number(holder.dataset.pageIndex);
          const page = project.pages[index];
          if (!page || holder.dataset.rendered === 'true') continue;
          holder.dataset.rendered = 'true';
          holder.replaceChildren(
            stage(
              renderPage({ project, page, pageIndex: index }),
              project.pageWidthMm,
              project.pageHeightMm,
              scale,
            ),
          );
          observer?.unobserve(holder);
        }
      },
      { root: container, rootMargin: '400px' },
    );
  }

  project.pages.forEach((page, index) => {
    const holder = el('div', {
      class: 'pn-template__preview',
      dataset: { pageIndex: String(index) },
      style: { minHeight: `${mmToCssPx(project.pageHeightMm) * scale + 12}px` },
    });

    if (!virtualise) {
      holder.append(
        stage(renderPage({ project, page, pageIndex: index }), project.pageWidthMm, project.pageHeightMm, scale),
      );
      holder.dataset.rendered = 'true';
    }

    const card = el(
      'button',
      {
        type: 'button',
        class: 'pn-template',
        role: 'listitem',
        'aria-current': String(index === store.ui.selection.pageIndex),
        onclick: () => {
          store.selectPage(index);
          store.setUi({ view: 'pages' });
          rerender();
        },
      },
      holder,
      el('span', { class: 'pn-template__name', text: pageLabelFor(index) }),
    );
    grid.append(card);
    if (observer) observer.observe(holder);
  });

  container.append(grid);
  return observer;
}

function renderReadingView(container: HTMLElement): null {
  const project = store.project!;
  const pageIndex = Math.min(store.ui.selection.pageIndex, project.pages.length - 1);
  const page = project.pages[pageIndex];
  if (!page) return null;

  const scale = resolveScale(container, project.pageWidthMm, project.pageHeightMm);
  const node = renderPage({ project, page, pageIndex });
  container.append(stage(node, project.pageWidthMm, project.pageHeightMm, scale, pageLabelFor(pageIndex)));
  container.append(pageStepper(pageIndex, project.pages.length));

  // Swipe between pages on touch devices.
  let startX = 0;
  container.addEventListener(
    'touchstart',
    (event) => {
      startX = event.touches[0]?.clientX ?? 0;
    },
    { passive: true },
  );
  container.addEventListener(
    'touchend',
    (event) => {
      const endX = event.changedTouches[0]?.clientX ?? startX;
      const delta = endX - startX;
      if (Math.abs(delta) < 60) return;
      store.selectPage(pageIndex + (delta < 0 ? 1 : -1));
    },
    { passive: true },
  );

  return null;
}

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

function pageStepper(pageIndex: number, total: number): HTMLElement {
  return el(
    'nav',
    { class: 'pn-segment', 'aria-label': 'Page navigation' },
    el(
      'button',
      {
        type: 'button',
        class: 'pn-segment__option',
        'aria-label': 'Previous page',
        disabled: pageIndex === 0,
        onclick: () => store.selectPage(pageIndex - 1),
      },
      icon('chevron-left', { size: 16 }),
    ),
    el('span', {
      class: 'pn-segment__option',
      'aria-live': 'polite',
      text: `${pageIndex + 1} of ${total}`,
    }),
    el(
      'button',
      {
        type: 'button',
        class: 'pn-segment__option',
        'aria-label': 'Next page',
        disabled: pageIndex >= total - 1,
        onclick: () => store.selectPage(pageIndex + 1),
      },
      icon('chevron-right', { size: 16 }),
    ),
  );
}

function pageLabelFor(index: number): string {
  const project = store.project;
  if (!project) return `Page ${index + 1}`;
  const page = project.pages[index];
  if (page?.name) return page.name;
  switch (page?.role) {
    case 'cover':
      return 'Front cover';
    case 'inside-cover':
      return 'Inside cover';
    case 'back-cover':
      return 'Back cover';
    default:
      return `Page ${index + 1}`;
  }
}

function emptyState(art: Parameters<typeof emptyArt>[0], title: string, body: string): HTMLElement {
  return el(
    'div',
    { class: 'pn-empty' },
    emptyArt(art),
    el('p', { class: 'pn-empty__title', text: title }),
    el('p', { class: 'pn-empty__body', text: body }),
  );
}

/** Exported so the print flow can play the fold animation on the same node. */
export function celebrate(container: HTMLElement): void {
  if (prefersReducedMotion()) return;
  const stageNode = container.querySelector<HTMLElement>('.pn-stage');
  if (stageNode) animate(stageNode, 'pn-anim-celebrate', 700);
}
