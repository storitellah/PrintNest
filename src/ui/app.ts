import { releaseAll } from '../core/assets.ts';
import { requestPersistentStorage } from '../core/db.ts';
import { ACCEPT_ATTRIBUTE, filesFromDataTransfer } from '../core/files.ts';
import { store, ProjectStore } from '../core/store.ts';
import type { ViewMode } from '../core/store.ts';
import { animate, el, setChildren } from './dom.ts';
import { openExportDialog } from './dialogs/exportDialog.ts';
import { openHelpDialog, openPrivacyDialog, openShortcutsDialog } from './dialogs/helpDialog.ts';
import { openPrintDialog } from './dialogs/printDialog.ts';
import { openPrinterDialog } from './dialogs/printerDialog.ts';
import { confirmDialog } from './dialogs/dialog.ts';
import { alignSelection, changeLayerOrder, nudgeSelection } from './editorInteractions.ts';
import { brandMark, icon } from './icons.ts';
import { importFiles, importFromPicker, reportImport } from './importer.ts';
import { createPagesPanel } from './panels/pagesPanel.ts';
import { addElement, createPropertiesPanel } from './panels/propertiesPanel.ts';
import { createCanvas } from './screens/canvas.ts';
import { createHomeScreen } from './screens/home.ts';
import { toast, toastError } from './toast.ts';

/**
 * The application shell.
 *
 * Two screens — home and workspace — plus the persistent top bar, footer,
 * mobile navigation and the global drag-and-drop target. The store drives
 * which screen is shown: a project open means the workspace.
 */

const THEME_KEY = 'printnest:theme';
type Theme = 'system' | 'light' | 'dark';

export function mountApp(root: HTMLElement): void {
  applyStoredTheme();

  const topbar = el('header', { class: 'pn-topbar' });
  const screenHost = el('div', {
    class: 'pn-workspace',
    style: { display: 'block' },
    id: 'pn-main',
  });
  const bottomNav = el('nav', { class: 'pn-bottomnav', 'aria-label': 'Main' });
  const footer = buildFooter();

  const app = el('div', { class: 'pn-app' }, topbar, screenHost, footer, bottomNav);
  root.append(
    el('a', { class: 'pn-skip-link', href: '#pn-main', text: 'Skip to the main area' }),
    app,
  );

  let canvas: ReturnType<typeof createCanvas> | null = null;
  let pagesPanel: ReturnType<typeof createPagesPanel> | null = null;
  let propertiesPanel: ReturnType<typeof createPropertiesPanel> | null = null;

  const home = createHomeScreen(() => showWorkspace());

  function showHome(): void {
    canvas?.destroy();
    pagesPanel?.destroy();
    propertiesPanel?.destroy();
    canvas = null;
    pagesPanel = null;
    propertiesPanel = null;

    screenHost.className = 'pn-home-host';
    screenHost.style.display = 'block';
    setChildren(screenHost, home.root);
    home.refresh();
    footer.hidden = false;
    renderTopbar();
    renderBottomNav();
  }

  function showWorkspace(): void {
    if (!store.project) {
      showHome();
      return;
    }
    canvas?.destroy();
    pagesPanel?.destroy();
    propertiesPanel?.destroy();

    pagesPanel = createPagesPanel();
    canvas = createCanvas();
    propertiesPanel = createPropertiesPanel();

    screenHost.className = 'pn-workspace';
    screenHost.style.display = 'grid';
    setChildren(screenHost, pagesPanel.root, canvas.root, propertiesPanel.root);
    footer.hidden = true;
    renderTopbar();
    renderBottomNav();
  }

  /* ---- Top bar --------------------------------------------------- */

  function renderTopbar(): void {
    const project = store.project;

    const brand = el(
      'button',
      {
        type: 'button',
        class: 'pn-brand',
        'aria-label': 'PrintNest home',
        onclick: () => void goHome(),
      },
      brandMark(30),
      el(
        'span',
        { class: 'pn-topbar__brand-text' },
        el('span', { class: 'pn-brand__name', text: 'PrintNest' }),
      ),
    );

    if (!project) {
      setChildren(
        topbar,
        brand,
        el('span', { class: 'pn-brand__tagline', text: 'Make it. Arrange it. Print it at home.' }),
        el(
          'div',
          { class: 'pn-topbar__actions' },
          iconButton('help', 'Help', () => openHelpDialog()),
          iconButton('settings', 'Printer setup', () => void openPrinterDialog()),
          themeButton(),
        ),
      );
      return;
    }

    const nameInput = el('input', {
      class: 'pn-topbar__project-name',
      value: project.name,
      'aria-label': 'Project name',
      maxlength: '120',
      onchange: (event: Event) => {
        const value = (event.target as HTMLInputElement).value.trim() || 'Untitled project';
        store.update((draft) => void (draft.name = value), { label: 'rename' });
      },
    });

    setChildren(
      topbar,
      brand,
      el('div', { class: 'pn-topbar__title' }, nameInput, saveState()),
      el(
        'div',
        { class: 'pn-topbar__actions' },
        iconButton('undo', 'Undo', () => store.undo(), !store.canUndo),
        iconButton('redo', 'Redo', () => store.redo(), !store.canRedo),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm pn-desktop-only',
            onclick: () => void importFromPicker(ACCEPT_ATTRIBUTE),
          },
          icon('upload', { size: 16 }),
          'Add files',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm pn-desktop-only',
            onclick: () => openExportDialog(),
          },
          icon('download', { size: 16 }),
          'Export',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--print pn-btn--sm',
            onclick: () => void openPrintDialog(),
          },
          icon('print', { size: 16 }),
          'Print',
        ),
        iconButton('help', 'Help', () => openHelpDialog()),
        iconButton('settings', 'Printer setup', () => void openPrinterDialog()),
        themeButton(),
      ),
    );
  }

  function saveState(): HTMLElement {
    const node = el('span', { class: 'pn-savestate', 'aria-live': 'polite' });
    const update = (): void => {
      node.textContent = store.isSaving
        ? 'Saving…'
        : store.saveError
          ? 'Not saved'
          : store.isDirty
            ? 'Unsaved changes'
            : 'Saved on this device';
      node.style.color = store.saveError ? 'var(--pn-warning)' : '';
    };
    update();
    store.subscribe(update);
    return node;
  }

  /* ---- Bottom navigation (mobile) -------------------------------- */

  function renderBottomNav(): void {
    if (!store.project) {
      setChildren(
        bottomNav,
        navItem('home', 'Home', true, () => void goHome()),
        navItem('help', 'Help', false, () => openHelpDialog()),
        navItem('settings', 'Printer', false, () => void openPrinterDialog()),
      );
      return;
    }

    setChildren(
      bottomNav,
      navItem('home', 'Home', false, () => void goHome()),
      navItem('upload', 'Add', false, () => void importFromPicker(ACCEPT_ATTRIBUTE)),
      navItem('pages', 'Pages', false, () => openMobilePanel('pages')),
      navItem('eye', 'Preview', store.ui.view === 'reading', () => {
        store.setUi({ view: store.ui.view === 'reading' ? 'pages' : 'reading' });
      }),
      navItem('settings', 'Settings', false, () => openMobilePanel('settings')),
      navItem('print', 'Print', false, () => void openPrintDialog()),
    );
  }

  /**
   * On mobile the two side panels become bottom sheets, reusing the exact same
   * panel components so there is only one implementation to keep correct.
   */
  function openMobilePanel(which: 'pages' | 'settings'): void {
    const panel = which === 'pages' ? createPagesPanel() : createPropertiesPanel();
    panel.root.style.overflowY = 'visible';
    panel.root.style.border = 'none';

    const dialog = el(
      'dialog',
      { class: 'pn-dialog', 'aria-label': which === 'pages' ? 'Pages and files' : 'Settings' },
      el(
        'div',
        { class: 'pn-dialog__header' },
        el('h2', { class: 'pn-dialog__title', text: which === 'pages' ? 'Pages and files' : 'Settings' }),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--ghost pn-btn--icon',
            'aria-label': 'Close',
            onclick: () => dialog.close(),
          },
          icon('close', { size: 18 }),
        ),
      ),
      el('div', { class: 'pn-dialog__body' }, panel.root),
    ) as HTMLDialogElement;

    dialog.addEventListener('close', () => {
      panel.destroy();
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  /* ---- Navigation ------------------------------------------------ */

  async function goHome(): Promise<void> {
    if (store.project) {
      await store.save();
      store.close();
    }
    releaseAll();
    showHome();
  }

  /* ---- Global behaviour ------------------------------------------ */

  installDragAndDrop();
  installKeyboardShortcuts({ goHome, addElementShortcut: addElement });
  installLifecycleHandlers();
  void offerSessionRecovery(() => showWorkspace());
  void requestPersistentStorage();

  store.subscribe(() => {
    const hasProject = store.project !== null;
    const showingWorkspace = screenHost.classList.contains('pn-workspace');
    if (hasProject && !showingWorkspace) showWorkspace();
    else if (!hasProject && showingWorkspace) showHome();
  });

  showHome();
}

/* ------------------------------------------------------------------ *
 * Shared controls
 * ------------------------------------------------------------------ */

function iconButton(
  name: Parameters<typeof icon>[0],
  label: string,
  onClick: () => void,
  disabled = false,
): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      class: 'pn-btn pn-btn--ghost pn-btn--icon pn-btn--sm',
      'aria-label': label,
      title: label,
      disabled,
      onclick: onClick,
    },
    icon(name, { size: 18 }),
  );
}

function navItem(
  name: Parameters<typeof icon>[0],
  label: string,
  current: boolean,
  onClick: () => void,
): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      class: 'pn-bottomnav__item',
      'aria-current': String(current),
      onclick: onClick,
    },
    icon(name, { size: 22, class: 'pn-bottomnav__icon' }),
    el('span', { text: label }),
  );
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

function applyStoredTheme(): void {
  const stored = readTheme();
  if (stored === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', stored);
}

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function themeButton(): HTMLElement {
  const cycle: Theme[] = ['system', 'light', 'dark'];
  const labels: Record<Theme, string> = {
    system: 'Theme: follows your system',
    light: 'Theme: light',
    dark: 'Theme: dark',
  };

  const button = el(
    'button',
    {
      type: 'button',
      class: 'pn-btn pn-btn--ghost pn-btn--icon pn-btn--sm',
      'aria-label': labels[readTheme()],
      title: labels[readTheme()],
      onclick: () => {
        const next = cycle[(cycle.indexOf(readTheme()) + 1) % cycle.length]!;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          /* private mode */
        }
        applyStoredTheme();
        button.setAttribute('aria-label', labels[next]);
        button.title = labels[next];
        toast({ title: labels[next], kind: 'info', duration: 1800 });
      },
    },
    icon('eye', { size: 18 }),
  );
  return button;
}

/* ------------------------------------------------------------------ *
 * Drag and drop
 * ------------------------------------------------------------------ */

function installDragAndDrop(): void {
  let veil: HTMLElement | null = null;
  let depth = 0;

  const showVeil = (): void => {
    if (veil) return;
    veil = el(
      'div',
      { class: 'pn-dragveil' },
      el('div', { class: 'pn-dragveil__card', text: 'Drop your files to import them' }),
    );
    document.body.append(veil);
  };

  const hideVeil = (): void => {
    veil?.remove();
    veil = null;
    depth = 0;
  };

  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    depth += 1;
    showVeil();
  });

  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', () => {
    depth -= 1;
    if (depth <= 0) hideVeil();
  });

  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    hideVeil();
    void handleDroppedFiles(event.dataTransfer);
  });

  // Pasting images from the clipboard, which is how most people move a
  // screenshot or a copied photo into an application.
  window.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void runImport(files);
  });
}

async function handleDroppedFiles(transfer: DataTransfer): Promise<void> {
  const files = await filesFromDataTransfer(transfer);
  if (files.length === 0) return;
  await runImport(files);
}

async function runImport(files: File[]): Promise<void> {
  if (!store.project) {
    toast({
      title: 'Start a project first',
      detail: 'Choose what you are making, then bring your files in.',
      kind: 'info',
    });
    return;
  }
  try {
    const outcome = await importFiles(files);
    if (outcome.replacedProject) {
      await store.open(outcome.replacedProject);
      await store.save();
      toast({ title: `Opened “${outcome.replacedProject.name}”`, kind: 'success' });
      return;
    }
    reportImport(outcome);
    const canvas = document.getElementById('pn-canvas');
    if (canvas) animate(canvas, 'pn-anim-stack', 500);
  } catch (error) {
    toastError(error, 'Those files could not be imported.');
  }
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

function installKeyboardShortcuts(actions: {
  goHome: () => Promise<void>;
  addElementShortcut: typeof addElement;
}): void {
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true;

    const modifier = event.metaKey || event.ctrlKey;

    // Shortcuts that work even while typing.
    if (modifier && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      void openPrintDialog();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void store.save();
      toast({ title: 'Saved', kind: 'success', duration: 1400 });
      return;
    }

    if (typing) return;

    if (modifier) {
      switch (event.key.toLowerCase()) {
        case 'z':
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          return;
        case 'y':
          event.preventDefault();
          store.redo();
          return;
        case 'e':
          event.preventDefault();
          openExportDialog();
          return;
        case 'o':
          event.preventDefault();
          void importFromPicker(ACCEPT_ATTRIBUTE);
          return;
        case 'a': {
          event.preventDefault();
          const page = store.selectedPage;
          if (page) store.selectElements(page.elements.map((element) => element.id));
          return;
        }
        case 'd':
          event.preventDefault();
          duplicateSelection();
          return;
        case ']':
          event.preventDefault();
          changeLayerOrder(event.shiftKey ? 'front' : 'forward');
          return;
        case '[':
          event.preventDefault();
          changeLayerOrder(event.shiftKey ? 'back' : 'backward');
          return;
        default:
          return;
      }
    }

    switch (event.key) {
      case 'Delete':
      case 'Backspace': {
        if (store.ui.selection.elementIds.length === 0) return;
        event.preventDefault();
        deleteSelection();
        return;
      }
      case 'Escape':
        store.selectElements([]);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (store.ui.selection.elementIds.length === 0) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
        return;
      }
      case 'PageDown':
        event.preventDefault();
        store.selectPage(store.ui.selection.pageIndex + 1);
        return;
      case 'PageUp':
        event.preventDefault();
        store.selectPage(store.ui.selection.pageIndex - 1);
        return;
      case '?':
        openShortcutsDialog();
        return;
      case '+':
      case '=':
        store.setUi({ zoomToFit: false, zoom: Math.min(4, store.ui.zoom + 0.1) });
        return;
      case '-':
        store.setUi({ zoomToFit: false, zoom: Math.max(0.1, store.ui.zoom - 0.1) });
        return;
      case '0':
        store.setUi({ zoomToFit: true });
        return;
      case 't':
        if (store.project) actions.addElementShortcut('text');
        return;
      case 'r':
        if (store.project) actions.addElementShortcut('rect');
        return;
      case 'h':
        void actions.goHome();
        return;
      default:
        break;
    }

    // Number keys switch preview mode.
    const views: ViewMode[] = ['pages', 'spreads', 'sheets', 'thumbnails', 'reading'];
    const index = Number(event.key) - 1;
    if (index >= 0 && index < views.length) {
      store.setUi({ view: views[index]! });
    }
  });

  // Alignment shortcuts, which are common enough to earn a modifier chord.
  window.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey) return;
    const map: Record<string, Parameters<typeof alignSelection>[0]> = {
      l: 'left',
      c: 'centre-x',
      r: 'right',
      t: 'top',
      m: 'centre-y',
      b: 'bottom',
    };
    const mode = map[event.key.toLowerCase()];
    if (!mode) return;
    event.preventDefault();
    alignSelection(mode);
  });
}

function duplicateSelection(): void {
  const ids = new Set(store.ui.selection.elementIds);
  if (ids.size === 0) return;
  const created: string[] = [];

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      for (const element of [...page.elements]) {
        if (!ids.has(element.id)) continue;
        const copy = {
          ...element,
          id: `el_${Math.random().toString(36).slice(2, 10)}`,
          xMm: element.xMm + 4,
          yMm: element.yMm + 4,
        };
        page.elements.push(copy);
        created.push(copy.id);
      }
      return created.length > 0 ? undefined : false;
    },
    { label: 'duplicate-elements' },
  );

  if (created.length > 0) store.selectElements(created);
}

function deleteSelection(): void {
  const ids = new Set(store.ui.selection.elementIds);
  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      page.elements = page.elements.filter((element) => !ids.has(element.id));
      return undefined;
    },
    { label: 'delete-elements' },
  );
  store.selectElements([]);
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

function installLifecycleHandlers(): void {
  // `pagehide` fires reliably on mobile Safari where `beforeunload` does not.
  window.addEventListener('pagehide', () => store.flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flushSave();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!store.isDirty) return;
    store.flushSave();
    // Only warn when a save is genuinely still pending.
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('unload', () => releaseAll());
}

/**
 * If the last session ended without a clean close, offer the work back.
 * Autosave means this is rare, but a crash between saves would otherwise
 * silently lose a few seconds of editing.
 */
async function offerSessionRecovery(onOpen: () => void): Promise<void> {
  let marker: { id: string; at: number } | null = null;
  try {
    const raw = sessionStorage.getItem('printnest:recovery-id');
    marker = raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
  } catch {
    marker = null;
  }
  if (!marker) return;

  const snapshot = await ProjectStore.readRecovery();
  if (!snapshot || snapshot.project.id !== marker.id) {
    await ProjectStore.clearRecovery();
    return;
  }

  const restore = await confirmDialog({
    title: 'Pick up where you left off?',
    message: `“${snapshot.project.name}” was open when this browser tab last closed. Would you like to reopen it?`,
    confirmLabel: 'Reopen it',
  });

  if (restore) {
    await store.open(snapshot.project);
    onOpen();
  }
  await ProjectStore.clearRecovery();
}

/* ------------------------------------------------------------------ *
 * Footer
 * ------------------------------------------------------------------ */

function buildFooter(): HTMLElement {
  const link = (text: string, href: string): HTMLElement =>
    el('li', {}, el('a', { href, text, rel: 'noopener noreferrer', target: '_blank' }));

  const action = (text: string, onClick: () => void): HTMLElement =>
    el('li', {}, el('button', { type: 'button', text, onclick: onClick }));

  return el(
    'footer',
    { class: 'pn-footer' },
    el(
      'div',
      { class: 'pn-footer__inner' },
      el(
        'div',
        { class: 'pn-footer__brand' },
        el('div', { class: 'pn-footer__name', text: 'PrintNest by Storitellah' }),
        el('div', { class: 'pn-footer__tagline', text: 'Make it. Arrange it. Print it at home.' }),
        el(
          'p',
          { class: 'pn-footer__made' },
          'Made with care by ',
          el('a', {
            href: 'https://storitellah.com',
            text: 'Storitellah',
            rel: 'noopener noreferrer',
            target: '_blank',
          }),
          '.',
        ),
      ),
      el(
        'div',
        { class: 'pn-footer__links' },
        el(
          'div',
          { class: 'pn-footer__group' },
          el('h3', { text: 'PrintNest' }),
          el(
            'ul',
            {},
            action('Help', () => openHelpDialog()),
            action('Keyboard shortcuts', () => openShortcutsDialog()),
            action('Privacy', () => openPrivacyDialog()),
            link('Documentation', 'https://github.com/storitellah/printnest#readme'),
          ),
        ),
        el(
          'div',
          { class: 'pn-footer__group' },
          el('h3', { text: 'Project' }),
          el(
            'ul',
            {},
            link('GitHub', 'https://github.com/storitellah/printnest'),
            link('Report a bug', 'mailto:hello@storitellah.com?subject=PrintNest%20bug%20report'),
            link('Support the project', 'https://storitellah.com'),
          ),
        ),
        el(
          'div',
          { class: 'pn-footer__group' },
          el('h3', { text: 'Storitellah' }),
          el(
            'ul',
            {},
            link('storitellah.com', 'https://storitellah.com'),
            link('hello@storitellah.com', 'mailto:hello@storitellah.com'),
          ),
        ),
      ),
    ),
  );
}
