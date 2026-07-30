import { hydrateProjectAssets, releaseAll } from './assets.ts';
import { deleteMeta, getMeta, pruneOrphanAssets, saveProject, setMeta } from './db.ts';
import { cloneProject, usedAssetIds } from './project.ts';
import type { Project } from './types.ts';

/**
 * The application store.
 *
 * A deliberately small hand-rolled store rather than a framework: the document
 * is plain JSON, mutations are "produce the next document", and subscribers
 * re-render. That gives undo/redo, autosave and crash recovery essentially for
 * free, and keeps the bundle tiny.
 *
 * Undo history holds whole documents. For the sizes PrintNest deals with — a
 * 64-page book is well under a megabyte of JSON, because images live outside
 * the document — that is cheaper and far less bug-prone than a patch log.
 */

export interface Selection {
  pageIndex: number;
  elementIds: string[];
}

export type ViewMode = 'pages' | 'spreads' | 'sheets' | 'thumbnails' | 'reading';

export interface UiState {
  selection: Selection;
  view: ViewMode;
  /** Preview zoom, 1 = fit to the available space. */
  zoom: number;
  zoomToFit: boolean;
  showGrid: boolean;
  showGuides: boolean;
  showRulers: boolean;
  showBleed: boolean;
  showSafeArea: boolean;
  snapEnabled: boolean;
  softProof: boolean;
  /** Screen or print sheet numbering shown in the page list. */
  sheetPreview: boolean;
}

const AUTOSAVE_DELAY_MS = 900;
const HISTORY_LIMIT = 60;
const RECOVERY_KEY = 'session-recovery';

export interface RecoverySnapshot {
  project: Project;
  savedAt: number;
}

type Listener = () => void;

export class ProjectStore {
  #project: Project | null = null;
  #past: Project[] = [];
  #future: Project[] = [];
  #listeners = new Set<Listener>();
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #dirty = false;
  #saving = false;
  #saveError: string | null = null;

  ui: UiState = {
    selection: { pageIndex: 0, elementIds: [] },
    view: 'pages',
    zoom: 1,
    zoomToFit: true,
    showGrid: false,
    showGuides: true,
    showRulers: false,
    showBleed: false,
    showSafeArea: true,
    snapEnabled: true,
    softProof: false,
    sheetPreview: false,
  };

  get project(): Project | null {
    return this.#project;
  }

  /** Throws when no project is open — use at call sites that require one. */
  requireProject(): Project {
    if (!this.#project) throw new Error('No project is open.');
    return this.#project;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get isDirty(): boolean {
    return this.#dirty;
  }

  get isSaving(): boolean {
    return this.#saving;
  }

  get saveError(): string | null {
    return this.#saveError;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Notify subscribers without touching the document — for UI-only changes. */
  notify(): void {
    for (const listener of Array.from(this.#listeners)) listener();
  }

  async open(project: Project): Promise<void> {
    releaseAll();
    this.#project = project;
    this.#past = [];
    this.#future = [];
    this.#dirty = false;
    this.#saveError = null;
    this.ui.selection = { pageIndex: 0, elementIds: [] };
    await hydrateProjectAssets(project.id);
    this.notify();
  }

  close(): void {
    this.flushSave();
    releaseAll();
    this.#project = null;
    this.#past = [];
    this.#future = [];
    this.notify();
  }

  /**
   * Apply a mutation.
   *
   * `mutate` receives a *draft copy* it may modify freely. Returning `false`
   * cancels the change, which lets callers bail out cheaply when a drag ends
   * up being a no-op.
   *
   * `label` groups consecutive changes: dragging an element fires dozens of
   * mutations, and coalescing them under one label keeps undo sensible.
   */
  update(
    mutate: (draft: Project) => void | false,
    options: { label?: string; coalesce?: boolean; skipHistory?: boolean } = {},
  ): void {
    const current = this.#project;
    if (!current) return;

    const draft = cloneProject(current);
    if (mutate(draft) === false) return;

    draft.updatedAt = Date.now();

    if (!options.skipHistory) {
      const shouldCoalesce =
        options.coalesce === true &&
        this.#lastLabel === options.label &&
        Date.now() - this.#lastChangeAt < 1200;
      if (!shouldCoalesce) {
        this.#past.push(current);
        if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
      }
      this.#future = [];
      this.#lastLabel = options.label ?? null;
      this.#lastChangeAt = Date.now();
    }

    this.#project = draft;
    this.#dirty = true;
    this.#scheduleSave();
    this.notify();
  }

  #lastLabel: string | null = null;
  #lastChangeAt = 0;

  undo(): void {
    const previous = this.#past.pop();
    if (!previous || !this.#project) return;
    this.#future.push(this.#project);
    this.#project = previous;
    this.#lastLabel = null;
    this.#dirty = true;
    this.#clampSelection();
    this.#scheduleSave();
    this.notify();
  }

  redo(): void {
    const next = this.#future.pop();
    if (!next || !this.#project) return;
    this.#past.push(this.#project);
    this.#project = next;
    this.#lastLabel = null;
    this.#dirty = true;
    this.#clampSelection();
    this.#scheduleSave();
    this.notify();
  }

  #clampSelection(): void {
    const project = this.#project;
    if (!project) return;
    const maxIndex = Math.max(0, project.pages.length - 1);
    if (this.ui.selection.pageIndex > maxIndex) {
      this.ui.selection = { pageIndex: maxIndex, elementIds: [] };
      return;
    }
    const page = project.pages[this.ui.selection.pageIndex];
    if (!page) return;
    const alive = new Set(page.elements.map((element) => element.id));
    const kept = this.ui.selection.elementIds.filter((id) => alive.has(id));
    if (kept.length !== this.ui.selection.elementIds.length) {
      this.ui.selection = { ...this.ui.selection, elementIds: kept };
    }
  }

  /* ---------------------------------------------------------------- *
   * Selection
   * ---------------------------------------------------------------- */

  selectPage(pageIndex: number): void {
    const project = this.#project;
    if (!project) return;
    const clamped = Math.max(0, Math.min(project.pages.length - 1, pageIndex));
    this.ui.selection = { pageIndex: clamped, elementIds: [] };
    this.notify();
  }

  selectElements(elementIds: string[], pageIndex = this.ui.selection.pageIndex): void {
    this.ui.selection = { pageIndex, elementIds: [...new Set(elementIds)] };
    this.notify();
  }

  toggleElement(elementId: string): void {
    const ids = new Set(this.ui.selection.elementIds);
    if (ids.has(elementId)) ids.delete(elementId);
    else ids.add(elementId);
    this.ui.selection = { ...this.ui.selection, elementIds: [...ids] };
    this.notify();
  }

  get selectedPage() {
    return this.#project?.pages[this.ui.selection.pageIndex] ?? null;
  }

  get selectedElements() {
    const page = this.selectedPage;
    if (!page) return [];
    const ids = new Set(this.ui.selection.elementIds);
    return page.elements.filter((element) => ids.has(element.id));
  }

  setUi(patch: Partial<UiState>): void {
    this.ui = { ...this.ui, ...patch };
    this.notify();
  }

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  #scheduleSave(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      void this.save();
    }, AUTOSAVE_DELAY_MS);
    // Keep a synchronous-ish recovery copy in sessionStorage so a crash or an
    // accidental tab close between autosaves does not lose work.
    this.#writeRecoveryMarker();
  }

  #writeRecoveryMarker(): void {
    const project = this.#project;
    if (!project || typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(
        'printnest:recovery-id',
        JSON.stringify({ id: project.id, at: Date.now() }),
      );
    } catch {
      // Private-mode Safari throws on write; recovery is best-effort.
    }
  }

  async save(): Promise<void> {
    const project = this.#project;
    if (!project) return;
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    this.#saving = true;
    this.notify();
    try {
      await saveProject(project);
      await pruneOrphanAssets(project.id, usedAssetIds(project));
      await setMeta<RecoverySnapshot>(RECOVERY_KEY, { project, savedAt: Date.now() });
      this.#dirty = false;
      this.#saveError = null;
    } catch (error) {
      this.#saveError =
        error instanceof Error ? error.message : 'The project could not be saved locally.';
    } finally {
      this.#saving = false;
      this.notify();
    }
  }

  /** Fire-and-forget save used on `pagehide`, where awaiting is not an option. */
  flushSave(): void {
    if (this.#dirty) void this.save();
  }

  static async readRecovery(): Promise<RecoverySnapshot | null> {
    try {
      return await getMeta<RecoverySnapshot>(RECOVERY_KEY);
    } catch {
      return null;
    }
  }

  static async clearRecovery(): Promise<void> {
    try {
      await deleteMeta(RECOVERY_KEY);
    } catch {
      /* nothing to clear */
    }
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.removeItem('printnest:recovery-id');
      } catch {
        /* ignore */
      }
    }
  }
}

export const store = new ProjectStore();
