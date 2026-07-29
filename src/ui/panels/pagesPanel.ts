import { previewUrl } from '../../core/assets.ts';
import { createPage } from '../../core/project.ts';
import { store } from '../../core/store.ts';
import { ACCEPT_ATTRIBUTE } from '../../core/files.ts';
import { countEmptyFrames } from '../../core/templates.ts';
import type { Page } from '../../core/types.ts';
import { el } from '../dom.ts';
import { emptyArt, icon } from '../icons.ts';
import { importFromPicker } from '../importer.ts';

/**
 * Left panel: the page list and the imported-file tray.
 *
 * Pages reorder by drag and drop, and — importantly — also by keyboard, using
 * Alt+Arrow on a focused page. Drag-only reordering would make the whole
 * feature unusable for anyone not using a mouse.
 */

export interface PagesPanel {
  root: HTMLElement;
  render: () => void;
  destroy: () => void;
}

export function createPagesPanel(): PagesPanel {
  const list = el('div', { class: 'pn-pagelist', role: 'list', 'aria-label': 'Pages' });
  const assets = el('div', { class: 'pn-assets', role: 'list', 'aria-label': 'Imported files' });
  const assetsHeader = el('div', { class: 'pn-panel__title', text: 'Files' });

  const root = el(
    'aside',
    { class: 'pn-panel pn-panel--left', 'aria-label': 'Project pages and files' },
    el('div', { class: 'pn-panel__title', text: 'Pages' }),
    list,
    assetsHeader,
    assets,
  );

  let dragIndex: number | null = null;

  function render(): void {
    const project = store.project;
    list.replaceChildren();
    assets.replaceChildren();
    if (!project) return;

    // ---- Pages -----------------------------------------------------------
    project.pages.forEach((page, index) => {
      list.append(pageRow(page, index));
    });

    list.append(
      el(
        'div',
        { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm',
            style: { flex: '1' },
            onclick: () => addPage(),
          },
          icon('plus', { size: 15 }),
          'Add page',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm',
            title: 'Insert a page that is meant to stay blank',
            onclick: () => addPage(true),
          },
          'Blank',
        ),
      ),
    );

    // ---- Files -----------------------------------------------------------
    const emptyFrames = countEmptyFrames(project);
    assetsHeader.textContent = emptyFrames > 0 ? `Files · ${emptyFrames} empty frames` : 'Files';

    if (project.assets.length === 0) {
      assets.style.display = 'block';
      assets.append(
        el(
          'div',
          { class: 'pn-empty', style: { padding: '1rem' } },
          emptyArt('no-files'),
          el('p', { class: 'pn-empty__body', text: 'No files yet. Drop images or a PDF anywhere on the page.' }),
          el(
            'button',
            {
              type: 'button',
              class: 'pn-btn pn-btn--sm',
              onclick: () => void importFromPicker(ACCEPT_ATTRIBUTE),
            },
            icon('upload', { size: 15 }),
            'Add files',
          ),
        ),
      );
      return;
    }

    assets.style.display = 'grid';
    const used = new Set<string>();
    for (const page of project.pages) {
      for (const element of page.elements) {
        if (element.type === 'image' && element.assetId) used.add(element.assetId);
      }
    }

    for (const asset of project.assets) {
      const button = el('button', {
        type: 'button',
        class: `pn-asset${used.has(asset.id) ? ' pn-asset--used' : ''}`,
        role: 'listitem',
        title: `${asset.name} — ${asset.widthPx} × ${asset.heightPx} px`,
        'aria-label': `${asset.name}${used.has(asset.id) ? ', already placed' : ', not yet placed'}. Add to the current page.`,
        draggable: 'true',
        onclick: () => placeAsset(asset.id),
        ondragstart: (event: DragEvent) => {
          event.dataTransfer?.setData('application/x-printnest-asset', asset.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
        },
      });

      const image = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
      button.append(image, el('span', { class: 'pn-asset__badge', text: asset.name }));
      assets.append(button);

      // Thumbnails come from the downsampled preview, never the original.
      void previewUrl(asset.id, 320).then((url) => {
        if (url) image.src = url;
      });
    }

    assets.append(
      el(
        'button',
        {
          type: 'button',
          class: 'pn-asset',
          style: { display: 'grid', placeItems: 'center' },
          'aria-label': 'Add more files',
          onclick: () => void importFromPicker(ACCEPT_ATTRIBUTE),
        },
        icon('plus', { size: 20 }),
      ),
    );
  }

  function pageRow(page: Page, index: number): HTMLElement {
    const project = store.project!;
    const isCurrent = index === store.ui.selection.pageIndex;

    const thumb = el('div', { class: 'pn-pagelist__thumb' });
    thumb.style.setProperty(
      '--pn-page-ratio',
      String(project.pageWidthMm / project.pageHeightMm),
    );

    // A cheap thumbnail: the first image on the page, or a text hint.
    const firstImage = page.elements.find(
      (element) => element.type === 'image' && element.assetId,
    );
    if (firstImage && firstImage.type === 'image') {
      const image = el('img', { alt: '', loading: 'lazy' });
      thumb.append(image);
      void previewUrl(firstImage.assetId, 200).then((url) => {
        if (url) image.src = url;
      });
    } else if (page.elements.length > 0) {
      thumb.append(icon('text', { size: 16, class: 'pn-pagelist__grip' }));
    }

    const roleNote = page.intentionallyBlank
      ? 'Intentionally blank'
      : page.elements.length === 0
        ? 'Empty'
        : `${page.elements.length} item${page.elements.length === 1 ? '' : 's'}`;

    return el(
      'div',
      {
        class: 'pn-pagelist__item',
        role: 'listitem',
        tabindex: '0',
        'aria-current': String(isCurrent),
        'aria-label': `${labelFor(page, index)}, ${roleNote}. Use Alt with the arrow keys to move this page.`,
        draggable: 'true',
        onclick: () => store.selectPage(index),
        onkeydown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            store.selectPage(index);
            return;
          }
          if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            movePage(index, index + (event.key === 'ArrowUp' ? -1 : 1));
          }
        },
        ondragstart: (event: DragEvent) => {
          dragIndex = index;
          (event.currentTarget as HTMLElement).dataset.dragging = 'true';
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        },
        ondragend: (event: DragEvent) => {
          dragIndex = null;
          delete (event.currentTarget as HTMLElement).dataset.dragging;
          render();
        },
        ondragover: (event: DragEvent) => {
          if (dragIndex === null) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).dataset.dropTarget = 'true';
        },
        ondragleave: (event: DragEvent) => {
          delete (event.currentTarget as HTMLElement).dataset.dropTarget;
        },
        ondrop: (event: DragEvent) => {
          event.preventDefault();
          delete (event.currentTarget as HTMLElement).dataset.dropTarget;
          if (dragIndex !== null) movePage(dragIndex, index);
          dragIndex = null;
        },
      },
      thumb,
      el(
        'div',
        { class: 'pn-pagelist__meta' },
        el('div', { class: 'pn-pagelist__name', text: labelFor(page, index) }),
        el('div', { class: 'pn-pagelist__note', text: roleNote }),
      ),
      el(
        'div',
        { class: 'pn-pagelist__actions' },
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm pn-btn--ghost pn-btn--icon',
            'aria-label': `Duplicate ${labelFor(page, index)}`,
            onclick: (event: Event) => {
              event.stopPropagation();
              duplicatePage(index);
            },
          },
          icon('copy', { size: 14 }),
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm pn-btn--ghost pn-btn--icon',
            'aria-label': `Delete ${labelFor(page, index)}`,
            disabled: store.project!.pages.length <= 1,
            onclick: (event: Event) => {
              event.stopPropagation();
              deletePage(index);
            },
          },
          icon('trash', { size: 14 }),
        ),
      ),
      icon('grip', { size: 16, class: 'pn-pagelist__grip' }),
    );
  }

  const unsubscribe = store.subscribe(render);
  render();

  return { root, render, destroy: unsubscribe };
}

/* ------------------------------------------------------------------ *
 * Page operations
 * ------------------------------------------------------------------ */

function labelFor(page: Page, index: number): string {
  if (page.name) return page.name;
  switch (page.role) {
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

export function addPage(intentionallyBlank = false): void {
  store.update(
    (draft) => {
      const insertAt = Math.min(draft.pages.length, store.ui.selection.pageIndex + 1);
      draft.pages.splice(insertAt, 0, createPage({ intentionallyBlank }));
    },
    { label: 'add-page' },
  );
  store.selectPage(store.ui.selection.pageIndex + 1);
}

export function duplicatePage(index: number): void {
  store.update(
    (draft) => {
      const page = draft.pages[index];
      if (!page) return false;
      const copy = createPage({
        name: page.name,
        backgroundColor: page.backgroundColor,
        role: page.role === 'cover' || page.role === 'back-cover' ? 'content' : page.role,
        intentionallyBlank: page.intentionallyBlank,
        // Fresh element ids so selection never straddles two pages.
        elements: page.elements.map((element) => ({
          ...element,
          id: `${element.id}_copy_${Math.random().toString(36).slice(2, 8)}`,
        })),
      });
      draft.pages.splice(index + 1, 0, copy);
      return undefined;
    },
    { label: 'duplicate-page' },
  );
}

export function deletePage(index: number): void {
  const project = store.project;
  if (!project || project.pages.length <= 1) return;
  store.update(
    (draft) => {
      draft.pages.splice(index, 1);
    },
    { label: 'delete-page' },
  );
  store.selectPage(Math.max(0, index - 1));
}

export function movePage(from: number, to: number): void {
  const project = store.project;
  if (!project) return;
  const target = Math.max(0, Math.min(project.pages.length - 1, to));
  if (from === target) return;

  store.update(
    (draft) => {
      const [page] = draft.pages.splice(from, 1);
      if (!page) return false;
      draft.pages.splice(target, 0, page);
      return undefined;
    },
    { label: 'move-page' },
  );
  store.selectPage(target);
}

/** Drop an asset onto the current page, or into the first empty frame. */
export function placeAsset(assetId: string): void {
  const project = store.project;
  if (!project) return;

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;

      const emptyFrame = page.elements.find(
        (element) => element.type === 'image' && !element.assetId,
      );
      if (emptyFrame && emptyFrame.type === 'image') {
        emptyFrame.assetId = assetId;
        return undefined;
      }

      const asset = draft.assets.find((entry) => entry.id === assetId);
      const ratio = asset?.widthPx && asset.heightPx ? asset.widthPx / asset.heightPx : 1;
      const maxWidth = draft.pageWidthMm - draft.margins.leftMm - draft.margins.rightMm;
      const maxHeight = draft.pageHeightMm - draft.margins.topMm - draft.margins.bottomMm;
      const scale = Math.min(maxWidth / ratio, maxHeight) * 0.8;

      page.elements.push({
        id: `el_${Math.random().toString(36).slice(2, 10)}`,
        type: 'image',
        xMm: draft.margins.leftMm + (maxWidth - ratio * scale) / 2,
        yMm: draft.margins.topMm + (maxHeight - scale) / 2,
        widthMm: ratio * scale,
        heightMm: scale,
        rotation: 0,
        locked: false,
        hidden: false,
        opacity: 1,
        assetId,
        fit: 'fit',
        scale: 1,
        offsetXMm: 0,
        offsetYMm: 0,
        imageRotation: 0,
        flipH: false,
        flipV: false,
        crop: null,
        borderMm: 0,
        borderColor: '#171717',
        cornerRadiusMm: 0,
        matteColor: null,
        caption: '',
      });
      page.intentionallyBlank = false;
      return undefined;
    },
    { label: 'place-asset' },
  );
}
