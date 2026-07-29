import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as db from '../src/core/db.ts';
import {
  deleteProject,
  estimateStorage,
  getAsset,
  getMeta,
  getProjectAssets,
  listProjects,
  loadProject,
  pruneOrphanAssets,
  putAsset,
  resetDatabaseConnection,
  saveProject,
  setMeta,
} from '../src/core/db.ts';
import { createImageElement, createProject, createTextElement } from '../src/core/project.ts';
import { base64ToBlob, blobToBase64, exportProjectFile, importProjectFile } from '../src/core/projectFile.ts';
import { ProjectStore } from '../src/core/store.ts';
import { exportPdf, hexToRgb, sanitizeForStandardFont } from '../src/render/pdfExport.ts';
import { mmToPt } from '../src/core/units.ts';
import type { AssetMeta } from '../src/core/types.ts';

/**
 * Storage and export round-trips.
 *
 * These run against `fake-indexeddb`-free jsdom, so they need a real
 * IndexedDB. Where one is unavailable the suite skips rather than pretending
 * to pass — a silent skip is better than a green tick that proves nothing.
 */

const hasIndexedDb = typeof indexedDB !== 'undefined';
const describeDb = hasIndexedDb ? describe : describe.skip;

function assetMeta(id: string): AssetMeta {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    bytes: 4,
    widthPx: 100,
    heightPx: 100,
    addedAt: Date.now(),
  };
}

describeDb('IndexedDB project storage', () => {
  beforeEach(() => {
    resetDatabaseConnection();
  });

  afterEach(async () => {
    for (const entry of await listProjects()) await deleteProject(entry.id);
  });

  it('saves and reloads a project unchanged', async () => {
    const project = createProject({ kind: 'zine', name: 'Round trip' });
    project.pages[0]!.elements.push(
      createTextElement('hello', { xMm: 5, yMm: 5, widthMm: 50, heightMm: 10 }),
    );

    await saveProject(project);
    const loaded = await loadProject(project.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Round trip');
    expect(loaded!.pages).toHaveLength(8);
    expect(loaded!.pages[0]!.elements[0]).toMatchObject({ type: 'text', text: 'hello' });
    // Geometry must survive the round trip exactly.
    expect(loaded!.pageWidthMm).toBe(project.pageWidthMm);
  });

  it('returns null for a project that does not exist', async () => {
    expect(await loadProject('nope')).toBeNull();
  });

  it('lists projects with pinned ones first, then most recent', async () => {
    const older = createProject({ kind: 'quick', name: 'Older' });
    older.updatedAt = Date.now() - 100_000;
    const newer = createProject({ kind: 'quick', name: 'Newer' });
    const pinned = createProject({ kind: 'quick', name: 'Pinned' });
    pinned.pinned = true;
    pinned.updatedAt = Date.now() - 200_000;

    await Promise.all([saveProject(older), saveProject(newer), saveProject(pinned)]);
    const listed = await listProjects();

    expect(listed[0]!.name).toBe('Pinned');
    expect(listed[1]!.name).toBe('Newer');
    expect(listed[2]!.name).toBe('Older');
  });

  it('deletes a project and sweeps its assets', async () => {
    const project = createProject({ kind: 'quick' });
    await saveProject(project);
    await putAsset({
      id: 'asset_x',
      projectId: project.id,
      blob: new Blob(['abcd']),
      type: 'image/png',
      name: 'x.png',
    });
    expect(await getProjectAssets(project.id)).toHaveLength(1);

    await deleteProject(project.id);
    expect(await loadProject(project.id)).toBeNull();
    expect(await getAsset('asset_x')).toBeNull();
  });

  it('prunes assets a project no longer references', async () => {
    const project = createProject({ kind: 'quick' });
    await saveProject(project);
    for (const id of ['keep', 'drop']) {
      await putAsset({
        id,
        projectId: project.id,
        blob: new Blob(['x']),
        type: 'image/png',
        name: `${id}.png`,
      });
    }

    const removed = await pruneOrphanAssets(project.id, new Set(['keep']));
    expect(removed).toBe(1);
    expect(await getAsset('keep')).not.toBeNull();
    expect(await getAsset('drop')).toBeNull();
  });

  it('stores and reads arbitrary preferences', async () => {
    await setMeta('unit-test-key', { hello: 'world' });
    expect(await getMeta<{ hello: string }>('unit-test-key')).toEqual({ hello: 'world' });
    expect(await getMeta('never-set')).toBeNull();
  });

  it('reports a storage estimate or nothing at all', async () => {
    const estimate = await estimateStorage();
    if (estimate) {
      expect(estimate.usedBytes).toBeGreaterThanOrEqual(0);
    } else {
      expect(estimate).toBeNull();
    }
  });
});

describeDb('the project store', () => {
  let store: ProjectStore;

  beforeEach(async () => {
    resetDatabaseConnection();
    store = new ProjectStore();
    await store.open(createProject({ kind: 'quick', name: 'Session' }));
  });

  afterEach(async () => {
    const project = store.project;
    store.close();
    if (project) await deleteProject(project.id);
  });

  it('applies a mutation to a copy, leaving the previous document intact', () => {
    const before = store.requireProject();
    store.update((draft) => void (draft.name = 'Renamed'));
    expect(store.project!.name).toBe('Renamed');
    expect(before.name).toBe('Session');
  });

  it('cancels a mutation that returns false', () => {
    store.update(() => false);
    expect(store.canUndo).toBe(false);
    expect(store.isDirty).toBe(false);
  });

  it('undoes and redoes', () => {
    store.update((draft) => void (draft.name = 'One'));
    store.update((draft) => void (draft.name = 'Two'));
    expect(store.project!.name).toBe('Two');

    store.undo();
    expect(store.project!.name).toBe('One');
    store.undo();
    expect(store.project!.name).toBe('Session');
    expect(store.canUndo).toBe(false);

    store.redo();
    expect(store.project!.name).toBe('One');
    expect(store.canRedo).toBe(true);
  });

  it('coalesces a run of drag updates into one undo step', () => {
    for (let i = 0; i < 20; i += 1) {
      store.update((draft) => void (draft.margins.topMm = i), { label: 'drag', coalesce: true });
    }
    store.undo();
    // One undo returns to the state before the whole drag.
    expect(store.project!.margins.topMm).toBe(10);
    expect(store.canUndo).toBe(false);
  });

  it('drops the redo stack once a new change is made', () => {
    store.update((draft) => void (draft.name = 'One'));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.update((draft) => void (draft.name = 'Other'));
    expect(store.canRedo).toBe(false);
  });

  it('clamps the selection when undo removes the selected page', () => {
    store.update((draft) => {
      draft.pages.push(...createProject({ kind: 'quick', pageCount: 3 }).pages);
    });
    store.selectPage(3);
    store.undo();
    expect(store.ui.selection.pageIndex).toBeLessThan(store.project!.pages.length);
  });

  it('clears element selection when the elements disappear', () => {
    let elementId = '';
    store.update((draft) => {
      const element = createTextElement('x', { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 });
      elementId = element.id;
      draft.pages[0]!.elements.push(element);
    });
    store.selectElements([elementId]);
    expect(store.selectedElements).toHaveLength(1);

    store.undo();
    expect(store.selectedElements).toHaveLength(0);
  });

  it('saves to storage and can be reloaded', async () => {
    store.update((draft) => void (draft.description = 'saved by the store'));
    await store.save();
    expect(store.isDirty).toBe(false);

    const reloaded = await loadProject(store.project!.id);
    expect(reloaded!.description).toBe('saved by the store');
  });

  it('writes a recovery snapshot that can be read back', async () => {
    store.update((draft) => void (draft.name = 'Recover me'));
    await store.save();

    const snapshot = await ProjectStore.readRecovery();
    expect(snapshot?.project.name).toBe('Recover me');

    await ProjectStore.clearRecovery();
    expect(await ProjectStore.readRecovery()).toBeNull();
  });

  it('notifies subscribers and stops on unsubscribe', () => {
    let count = 0;
    const unsubscribe = store.subscribe(() => {
      count += 1;
    });
    store.update((draft) => void (draft.name = 'A'));
    expect(count).toBeGreaterThan(0);

    const after = count;
    unsubscribe();
    store.update((draft) => void (draft.name = 'B'));
    expect(count).toBe(after);
  });

  it('throws a clear error when no project is open', () => {
    store.close();
    expect(() => store.requireProject()).toThrow(/No project/);
  });
});

describeDb('the .printnest project file', () => {
  beforeEach(() => {
    resetDatabaseConnection();
  });

  /**
   * The export reads its assets from IndexedDB. `fake-indexeddb` cannot
   * structured-clone a jsdom `Blob` — it stores an empty object — so the blob
   * read is stubbed here. Everything else, including the bundle format and the
   * whole import path, is exercised for real.
   */
  it('round-trips a project and its assets', async () => {
    const project = createProject({ kind: 'zine', name: 'Bundled' });
    const meta = assetMeta('asset_round');
    project.assets.push(meta);
    project.pages[0]!.elements.push(
      createImageElement(meta.id, { xMm: 5, yMm: 5, widthMm: 40, heightMm: 40 }),
    );
    await saveProject(project);

    const payload = new Uint8Array([1, 2, 3, 4]);
    const spy = vi.spyOn(db, 'getProjectAssets').mockResolvedValue([
      {
        id: meta.id,
        projectId: project.id,
        blob: new Blob([payload], { type: 'image/png' }),
        type: 'image/png',
        name: 'asset_round.png',
      },
    ]);

    const blob = await exportProjectFile(project);
    spy.mockRestore();

    const file = new File([blob], 'bundled.printnest', { type: 'application/json' });
    const result = await importProjectFile(file);

    expect(result.project.name).toBe('Bundled');
    // A fresh id, so importing a backup never overwrites the original.
    expect(result.project.id).not.toBe(project.id);
    expect(result.assetCount).toBe(1);
    expect(result.project.pages[0]!.elements[0]).toMatchObject({
      type: 'image',
      assetId: meta.id,
    });

    await deleteProject(project.id);
    await deleteProject(result.project.id);
  });

  it('writes the asset bytes into the bundle', async () => {
    const project = createProject({ kind: 'quick', name: 'Bytes' });
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const spy = vi.spyOn(db, 'getProjectAssets').mockResolvedValue([
      {
        id: 'a',
        projectId: project.id,
        blob: new Blob([payload], { type: 'image/png' }),
        type: 'image/png',
        name: 'a.png',
      },
    ]);

    const bundle = JSON.parse(await (await exportProjectFile(project)).text());
    spy.mockRestore();

    expect(bundle.format).toBe('printnest-project');
    expect(bundle.application).toContain('PrintNest');
    const decoded = new Uint8Array(await base64ToBlob(bundle.assets.a.data, '').arrayBuffer());
    expect(Array.from(decoded)).toEqual(Array.from(payload));
  });

  it('rejects a file that is not a PrintNest project', async () => {
    const file = new File(['{"format":"something-else"}'], 'x.printnest');
    await expect(importProjectFile(file)).rejects.toThrow(/does not look like/i);
  });

  it('rejects damaged JSON with a readable message', async () => {
    const file = new File(['{not json'], 'x.printnest');
    await expect(importProjectFile(file)).rejects.toThrow(/not a valid|damaged/i);
  });

  it('refuses a file from a newer version rather than mangling it', async () => {
    const file = new File(
      [JSON.stringify({ format: 'printnest-project', version: 999, project: {} })],
      'x.printnest',
    );
    await expect(importProjectFile(file)).rejects.toThrow(/newer version/i);
  });

  it('skips assets whose declared type is not on the allow-list', async () => {
    const file = new File(
      [
        JSON.stringify({
          format: 'printnest-project',
          version: 1,
          project: createProject({ kind: 'quick' }),
          assets: {
            bad: { type: 'application/x-msdownload', name: 'evil.exe', data: 'AAAA' },
          },
        }),
      ],
      'x.printnest',
    );
    const result = await importProjectFile(file);
    expect(result.assetCount).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/unsupported file type/i);
    await deleteProject(result.project.id);
  });

  it('cannot be used to pollute the prototype', async () => {
    const file = new File(
      [
        JSON.stringify({
          format: 'printnest-project',
          version: 1,
          __proto__: { polluted: true },
          project: { __proto__: { polluted: true }, name: 'Sneaky' },
        }),
      ],
      'x.printnest',
    );
    const result = await importProjectFile(file);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.project.name).toBe('Sneaky');
    await deleteProject(result.project.id);
  });
});

describe('base64 helpers', () => {
  it('round-trips binary data of every byte value', async () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    const blob = new Blob([bytes], { type: 'application/octet-stream' });

    const encoded = await blobToBase64(blob);
    const decoded = base64ToBlob(encoded, 'application/octet-stream');
    const back = new Uint8Array(await decoded.arrayBuffer());

    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it('handles a payload larger than the chunk size without overflowing', async () => {
    // 0x8000 is the chunk size; go comfortably past it.
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(0xab);
    const encoded = await blobToBase64(new Blob([bytes]));
    const back = new Uint8Array(await base64ToBlob(encoded, '').arrayBuffer());
    expect(back).toHaveLength(bytes.length);
    expect(back[back.length - 1]).toBe(0xab);
  });
});

describe('PDF export', () => {
  it('writes pages at the exact paper size', async () => {
    const project = createProject({ kind: 'quick', pageCount: 2 });
    project.pages[0]!.elements.push(
      createTextElement('Hello', { xMm: 20, yMm: 20, widthMm: 100, heightMm: 20 }),
    );

    const blob = await exportPdf({ project, layout: 'pages' });
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));

    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(mmToPt(210), 2);
    expect(height).toBeCloseTo(mmToPt(297), 2);
  });

  it('writes the imposed sheets at the sheet size', async () => {
    const project = createProject({ kind: 'booklet', pageCount: 8 });
    project.pages.forEach((page, index) =>
      page.elements.push(
        createTextElement(`Page ${index + 1}`, { xMm: 10, yMm: 10, widthMm: 100, heightMm: 20 }),
      ),
    );

    const blob = await exportPdf({ project, layout: 'sheets' });
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));

    // Two folded sheets, two sides each.
    expect(doc.getPageCount()).toBe(4);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(mmToPt(297), 2);
    expect(height).toBeCloseTo(mmToPt(210), 2);
  });

  it('writes a page for every page of a template', async () => {
    const project = createProject({ kind: 'zine' });
    const blob = await exportPdf({ project, layout: 'pages' });
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(doc.getPageCount()).toBe(8);
  });

  it('records the project name in the document metadata', async () => {
    const project = createProject({ kind: 'quick', name: 'Metadata test' });
    const blob = await exportPdf({ project, layout: 'pages' });
    // `load` rewrites the producer unless told not to, so read it as-is.
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), {
      updateMetadata: false,
    });
    expect(doc.getTitle()).toBe('Metadata test');
    expect(doc.getProducer()).toContain('PrintNest');
  });

  it('reports progress as it goes', async () => {
    const project = createProject({ kind: 'quick', pageCount: 3 });
    const fractions: number[] = [];
    await exportPdf({
      project,
      layout: 'pages',
      onProgress: (fraction) => fractions.push(fraction),
    });
    expect(fractions).toHaveLength(3);
    expect(fractions[fractions.length - 1]).toBeCloseTo(1, 6);
  });

  it('honours a custom paper size', async () => {
    const project = createProject({ kind: 'custom' });
    project.pageWidthMm = 100;
    project.pageHeightMm = 150;
    const blob = await exportPdf({ project, layout: 'pages' });
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(mmToPt(100), 2);
    expect(height).toBeCloseTo(mmToPt(150), 2);
  });
});

describe('PDF helpers', () => {
  it('converts colours to the PDF range', () => {
    expect(hexToRgb('#000000')).toMatchObject({ red: 0, green: 0, blue: 0 });
    expect(hexToRgb('#FFFFFF')).toMatchObject({ red: 1, green: 1, blue: 1 });
    const orange = hexToRgb('#F4A340');
    expect(orange.red).toBeCloseTo(244 / 255, 4);
    expect(hexToRgb('#fff')).toMatchObject({ red: 1, green: 1, blue: 1 });
    // Anything unparseable falls back to ink black rather than throwing.
    expect(hexToRgb('not a colour').red).toBeCloseTo(0.09, 2);
  });

  it('maps typographic characters the standard fonts cannot encode', () => {
    expect(sanitizeForStandardFont('“smart” ‘quotes’')).toBe('"smart" \'quotes\'');
    expect(sanitizeForStandardFont('an em—dash and an en–dash')).toBe(
      'an em-dash and an en-dash',
    );
    expect(sanitizeForStandardFont('and so on…')).toBe('and so on...');
    expect(sanitizeForStandardFont('• bullet')).toBe('- bullet');
  });

  it('keeps Latin-1 accents, which the standard fonts do encode', () => {
    expect(sanitizeForStandardFont('café naïve Zürich')).toBe('café naïve Zürich');
  });

  it('drops characters outside the encoding rather than failing the export', () => {
    expect(sanitizeForStandardFont('hello 你好 world')).toBe('hello  world');
  });
});
