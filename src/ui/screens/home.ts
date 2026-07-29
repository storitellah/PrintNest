import { deleteProject, listProjects, loadProject, saveProject } from '../../core/db.ts';
import { ACCEPT_ATTRIBUTE } from '../../core/files.ts';
import { KIND_PRESETS, createProject, duplicateProject } from '../../core/project.ts';
import type { KindPreset } from '../../core/project.ts';
import { store } from '../../core/store.ts';
import { listTemplates, projectFromTemplate, templatesByCategory } from '../../core/templates.ts';
import type { Template } from '../../core/templates.ts';
import type { RecentProjectEntry } from '../../core/types.ts';
import { renderPage } from '../../render/pageRender.ts';
import { mmToCssPx } from '../../core/units.ts';
import { el, setChildren } from '../dom.ts';
import { confirmDialog, openDialog, promptDialog } from '../dialogs/dialog.ts';
import { brandMark, emptyArt, icon } from '../icons.ts';
import type { IconName } from '../icons.ts';
import { importFromPicker } from '../importer.ts';
import { toast, toastError } from '../toast.ts';

/**
 * The home screen.
 *
 * Large project options rather than a file browser, because the first decision
 * — "what am I making?" — is the one that sets up the paper, page size and
 * imposition correctly. Choosing "Zine Maker" is quicker and far more reliable
 * than expecting someone to configure A4 landscape with quarter pages by hand.
 */

export interface HomeScreen {
  root: HTMLElement;
  refresh: () => void;
}

export function createHomeScreen(onOpenProject: () => void): HomeScreen {
  const inner = el('div', { class: 'pn-home__inner' });
  const root = el('main', { class: 'pn-home', id: 'pn-home' }, inner);

  const refresh = (): void => {
    void render();
  };

  async function render(): Promise<void> {
    let recents: RecentProjectEntry[] = [];
    try {
      recents = await listProjects();
    } catch {
      // Storage may be unavailable in private browsing; the rest still works.
    }

    setChildren(
      inner,
      hero(),
      heading('Start something', 'Each option sets the paper, page size and folding for you.'),
      kindGrid(),
      heading('Templates', 'Editable starting points — change anything you like.'),
      templateStrip(),
      heading(
        recents.length > 0 ? 'Recent projects' : 'Your projects',
        'Stored on this device only. Nothing is uploaded.',
      ),
      recents.length > 0 ? recentGrid(recents) : emptyProjects(),
    );
  }

  function hero(): HTMLElement {
    return el(
      'section',
      { class: 'pn-hero' },
      el(
        'div',
        {},
        el('h1', { class: 'pn-hero__title', text: 'PrintNest' }),
        el('p', { class: 'pn-hero__tagline', text: 'Make it. Arrange it. Print it at home.' }),
        el('p', {
          class: 'pn-hero__lead',
          text: 'A print workshop in your browser. Bring in pictures, PDFs and text, arrange them into zines, books, photographs and posters, and print them properly on the printer you already own. Everything happens on your device.',
        }),
        el(
          'div',
          { class: 'pn-hero__actions' },
          el(
            'button',
            {
              type: 'button',
              class: 'pn-btn pn-btn--primary pn-btn--lg',
              onclick: () => openNewProjectDialog(onOpenProject),
            },
            icon('plus', { size: 20 }),
            'New print project',
          ),
          el(
            'button',
            {
              type: 'button',
              class: 'pn-btn pn-btn--lg',
              onclick: () => void openSavedProject(onOpenProject, refresh),
            },
            icon('folder', { size: 20 }),
            'Open saved project',
          ),
        ),
      ),
      el('div', { style: { flex: 'none' } }, brandMark(96)),
    );
  }

  function kindGrid(): HTMLElement {
    return el(
      'div',
      { class: 'pn-kind-grid' },
      ...KIND_PRESETS.map((preset) =>
        el(
          'button',
          {
            type: 'button',
            class: 'pn-kind',
            onclick: () => void startProject(preset, onOpenProject),
          },
          icon(preset.icon as IconName, { size: 30, class: 'pn-kind__icon' }),
          el('span', { class: 'pn-kind__title', text: preset.title }),
          el('span', { class: 'pn-kind__blurb', text: preset.blurb }),
        ),
      ),
    );
  }

  function templateStrip(): HTMLElement {
    const templates = listTemplates().slice(0, 8);
    return el(
      'div',
      {},
      el(
        'div',
        { class: 'pn-template-grid' },
        ...templates.map((template) => templateCard(template, onOpenProject)),
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn pn-btn--sm',
          style: { marginTop: '0.75rem' },
          onclick: () => openTemplateDialog(onOpenProject),
        },
        `See all ${listTemplates().length} templates`,
      ),
    );
  }

  function recentGrid(recents: RecentProjectEntry[]): HTMLElement {
    return el(
      'div',
      { class: 'pn-recent-grid' },
      ...recents.map((entry) =>
        el(
          'div',
          { class: 'pn-recent' },
          el(
            'button',
            {
              type: 'button',
              class: 'pn-btn pn-btn--ghost',
              style: { justifyContent: 'flex-start', padding: '0', minHeight: 'auto', width: '100%' },
              onclick: () => void openProjectById(entry.id, onOpenProject),
            },
            el(
              'span',
              { style: { display: 'block', textAlign: 'left', width: '100%' } },
              el('span', { class: 'pn-recent__name', text: entry.name }),
              el('span', {
                class: 'pn-recent__meta',
                style: { display: 'block' },
                text: `${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'} · ${relativeTime(entry.updatedAt)}`,
              }),
            ),
          ),
          el(
            'div',
            { style: { display: 'flex', gap: '0.25rem', marginTop: '0.5rem' } },
            el('button', {
              type: 'button',
              class: 'pn-btn pn-btn--sm pn-btn--ghost',
              text: 'Rename',
              onclick: () => void renameProject(entry, refresh),
            }),
            el('button', {
              type: 'button',
              class: 'pn-btn pn-btn--sm pn-btn--ghost',
              text: 'Duplicate',
              onclick: () => void duplicateSaved(entry, refresh),
            }),
            el('button', {
              type: 'button',
              class: 'pn-btn pn-btn--sm pn-btn--ghost',
              text: 'Delete',
              onclick: () => void removeProject(entry, refresh),
            }),
          ),
          el(
            'button',
            {
              type: 'button',
              class: 'pn-recent__pin',
              'aria-pressed': String(entry.pinned),
              'aria-label': entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`,
              onclick: () => void togglePin(entry, refresh),
            },
            icon('pin', { size: 16 }),
          ),
        ),
      ),
    );
  }

  function emptyProjects(): HTMLElement {
    return el(
      'div',
      { class: 'pn-empty' },
      emptyArt('no-projects'),
      el('p', { class: 'pn-empty__title', text: 'No projects yet' }),
      el('p', {
        class: 'pn-empty__body',
        text: 'Pick something to make above, or open a .printnest file you saved earlier.',
      }),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn',
          onclick: () => void importFromPicker('.printnest'),
        },
        icon('upload', { size: 16 }),
        'Open a .printnest file',
      ),
    );
  }

  refresh();
  return { root, refresh };
}

function heading(title: string, note: string): HTMLElement {
  return el(
    'div',
    { class: 'pn-section-heading' },
    el('h2', { text: title }),
    el('p', { text: note }),
  );
}

/* ------------------------------------------------------------------ *
 * Project lifecycle
 * ------------------------------------------------------------------ */

async function startProject(preset: KindPreset, onOpen: () => void): Promise<void> {
  try {
    const project = createProject({ kind: preset.kind });
    await store.open(project);
    await store.save();
    onOpen();
    // Straight into importing: for most kinds the first thing you want is
    // your pictures.
    if (preset.kind !== 'custom') {
      toast({
        title: `${preset.title} ready`,
        detail: 'Drop pictures anywhere, or use Add files.',
        kind: 'success',
        action: { label: 'Add files', onClick: () => void importFromPicker(ACCEPT_ATTRIBUTE) },
      });
    }
  } catch (error) {
    toastError(error, 'The project could not be created.');
  }
}

async function openProjectById(id: string, onOpen: () => void): Promise<void> {
  try {
    const project = await loadProject(id);
    if (!project) {
      toast({ title: 'That project could not be found', kind: 'error' });
      return;
    }
    await store.open(project);
    onOpen();
  } catch (error) {
    toastError(error, 'The project could not be opened.');
  }
}

async function openSavedProject(onOpen: () => void, refresh: () => void): Promise<void> {
  const recents = await listProjects();
  if (recents.length === 0) {
    void importFromPicker('.printnest');
    return;
  }

  const handle = openDialog({
    title: 'Open a project',
    subtitle: 'Saved on this device',
    body: el(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
      ...recents.map((entry) =>
        el(
          'button',
          {
            type: 'button',
            class: 'pn-card pn-card--raised',
            style: { textAlign: 'left', cursor: 'pointer' },
            onclick: () => {
              handle.close();
              void openProjectById(entry.id, onOpen);
            },
          },
          el('strong', { text: entry.name }),
          el('div', {
            style: { marginTop: '2px', fontSize: '0.8125rem', color: 'var(--pn-text-muted)' },
            text: `${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'} · ${relativeTime(entry.updatedAt)}`,
          }),
        ),
      ),
    ),
    footer: [
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn',
          onclick: () => {
            handle.close();
            void importFromPicker('.printnest');
          },
        },
        icon('upload', { size: 16 }),
        'Import a .printnest file',
      ),
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Cancel',
        onclick: () => handle.close(),
      }),
    ],
    onClose: refresh,
  });
}

async function renameProject(entry: RecentProjectEntry, refresh: () => void): Promise<void> {
  const name = await promptDialog({
    title: 'Rename project',
    label: 'Project name',
    value: entry.name,
  });
  if (name === null || name === '') return;
  const project = await loadProject(entry.id);
  if (!project) return;
  project.name = name;
  project.updatedAt = Date.now();
  await saveProject(project);
  if (store.project?.id === project.id) {
    store.update((draft) => void (draft.name = name), { label: 'rename' });
  }
  refresh();
}

async function duplicateSaved(entry: RecentProjectEntry, refresh: () => void): Promise<void> {
  const project = await loadProject(entry.id);
  if (!project) return;
  const copy = duplicateProject(project);
  await saveProject(copy);
  toast({ title: `Duplicated as “${copy.name}”`, kind: 'success' });
  refresh();
}

async function removeProject(entry: RecentProjectEntry, refresh: () => void): Promise<void> {
  const confirmed = await confirmDialog({
    title: 'Delete this project?',
    message: `“${entry.name}” and its imported files will be removed from this device. This cannot be undone — export a .printnest file first if you might want it back.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  await deleteProject(entry.id);
  if (store.project?.id === entry.id) store.close();
  toast({ title: 'Project deleted', kind: 'info' });
  refresh();
}

async function togglePin(entry: RecentProjectEntry, refresh: () => void): Promise<void> {
  const project = await loadProject(entry.id);
  if (!project) return;
  project.pinned = !project.pinned;
  await saveProject(project);
  refresh();
}

/* ------------------------------------------------------------------ *
 * New project and templates
 * ------------------------------------------------------------------ */

export function openNewProjectDialog(onOpen: () => void): void {
  const handle = openDialog({
    title: 'New print project',
    subtitle: 'Pick what you are making — the paper and folding are set up for you',
    body: el(
      'div',
      { class: 'pn-kind-grid' },
      ...KIND_PRESETS.map((preset) =>
        el(
          'button',
          {
            type: 'button',
            class: 'pn-kind',
            onclick: () => {
              handle.close();
              void startProject(preset, onOpen);
            },
          },
          icon(preset.icon as IconName, { size: 28, class: 'pn-kind__icon' }),
          el('span', { class: 'pn-kind__title', text: preset.title }),
          el('span', { class: 'pn-kind__blurb', text: preset.blurb }),
        ),
      ),
    ),
    wide: true,
    footer: [
      el('button', {
        type: 'button',
        class: 'pn-btn',
        text: 'Browse templates instead',
        onclick: () => {
          handle.close();
          openTemplateDialog(onOpen);
        },
      }),
    ],
  });
}

export function openTemplateDialog(onOpen: () => void): void {
  const groups = templatesByCategory();
  const body = el('div');

  for (const group of groups) {
    body.append(
      el('h3', { text: group.category, style: { margin: '1.5rem 0 0.75rem', fontSize: '1rem' } }),
      el(
        'div',
        { class: 'pn-template-grid' },
        ...group.templates.map((template) => templateCard(template, onOpen, () => handle.close())),
      ),
    );
  }

  const handle = openDialog({
    title: 'Templates',
    subtitle: 'Every template is editable — change the paper, the type, anything',
    body,
    wide: true,
    footer: [
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Close',
        onclick: () => handle.close(),
      }),
    ],
  });
}

function templateCard(template: Template, onOpen: () => void, beforeOpen?: () => void): HTMLElement {
  const preview = el('div', { class: 'pn-template__preview' });

  // A live miniature of the template's first page, built from the same
  // renderer the editor uses — so what you see is genuinely what you get.
  try {
    const project = projectFromTemplate(template);
    const page = project.pages[0];
    if (page) {
      const node = renderPage({ project, page, pageIndex: 0 });
      const scale = Math.min(
        150 / mmToCssPx(project.pageWidthMm),
        110 / mmToCssPx(project.pageHeightMm),
      );
      node.style.transform = `scale(${scale})`;
      node.style.transformOrigin = 'center center';
      preview.append(node);
    }
  } catch {
    preview.append(icon('pages', { size: 28 }));
  }

  return el(
    'button',
    {
      type: 'button',
      class: 'pn-template',
      onclick: async () => {
        beforeOpen?.();
        try {
          const project = projectFromTemplate(template);
          await store.open(project);
          await store.save();
          onOpen();
          toast({
            title: `${template.name} ready`,
            detail: 'Drop pictures into the dashed frames to fill them.',
            kind: 'success',
          });
        } catch (error) {
          toastError(error, 'The template could not be opened.');
        }
      },
    },
    preview,
    el('span', { class: 'pn-template__name', text: template.name }),
    el('span', { class: 'pn-template__desc', text: template.description }),
  );
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
