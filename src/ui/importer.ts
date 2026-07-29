import { storeAsset } from '../core/assets.ts';
import {
  MAX_FILES_PER_IMPORT,
  decodeAsset,
  isValidationFailure,
  sortFilesNaturally,
  validateFile,
} from '../core/files.ts';
import { importPdf } from '../core/pdfImport.ts';
import { createImageElement, createPage, createTextElement } from '../core/project.ts';
import { importProjectFile } from '../core/projectFile.ts';
import { store } from '../core/store.ts';
import { fillEmptyFrames } from '../core/templates.ts';
import type { AssetMeta, Project } from '../core/types.ts';
import { contentBox } from '../core/paper.ts';
import { progressToast, toast, toastError } from './toast.ts';

/**
 * The import pipeline.
 *
 * Every file follows the same path: validate → decode → store → place. It runs
 * one file at a time and yields to the event loop between files, so importing
 * a folder of eighty photographs keeps the interface responsive rather than
 * locking up until it finishes.
 *
 * Nothing here touches the network.
 */

export interface ImportOutcome {
  assets: AssetMeta[];
  textBlocks: { text: string; heading: boolean }[];
  failures: { fileName: string; reason: string; suggestion?: string }[];
  notices: string[];
  /** Set when the import replaced the whole project (a `.printnest` file). */
  replacedProject: Project | null;
}

export interface ImportOptions {
  /** Place imported images into the project automatically. */
  autoPlace?: boolean;
  /** Fill the template's empty frames first. */
  fillFrames?: boolean;
  /** Import PDF pages as images at this resolution. */
  pdfDpi?: number;
}

export async function importFiles(files: File[], options: ImportOptions = {}): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    assets: [],
    textBlocks: [],
    failures: [],
    notices: [],
    replacedProject: null,
  };

  if (files.length === 0) return outcome;

  // A .printnest file is a whole project, not an asset — handle it alone.
  const projectFile = files.find((file) => file.name.toLowerCase().endsWith('.printnest'));
  if (projectFile) {
    if (files.length > 1) {
      outcome.notices.push('Opened the PrintNest project file; the other files were ignored.');
    }
    const result = await importProjectFile(projectFile);
    outcome.replacedProject = result.project;
    outcome.notices.push(...result.warnings);
    return outcome;
  }

  const ordered = sortFilesNaturally(files).slice(0, MAX_FILES_PER_IMPORT);
  if (files.length > MAX_FILES_PER_IMPORT) {
    outcome.notices.push(
      `Only the first ${MAX_FILES_PER_IMPORT} files were imported — that is the limit for one go.`,
    );
  }

  const project = store.project;
  if (!project) throw new Error('Open or create a project before importing files.');

  const progress = ordered.length > 3 ? progressToast(`Importing ${ordered.length} files`) : null;

  try {
    for (let index = 0; index < ordered.length; index += 1) {
      const file = ordered[index]!;
      progress?.update(index / ordered.length, file.name);

      const validated = await validateFile(file);
      if (isValidationFailure(validated)) {
        outcome.failures.push(validated);
        continue;
      }

      try {
        if (validated.info.kind === 'pdf') {
          const pdf = await importPdf(file, {
            dpi: options.pdfDpi ?? 150,
            onProgress: (done, total) => {
              progress?.update((index + done / total) / ordered.length, `${file.name} — page ${done} of ${total}`);
            },
          });
          for (const page of pdf.pages) {
            await storeAsset(project.id, page.meta, page.blob);
            outcome.assets.push(page.meta);
          }
          outcome.notices.push(...pdf.notices);
          continue;
        }

        const decoded = await decodeAsset(validated);
        await storeAsset(project.id, decoded.meta, decoded.blob);
        if (decoded.textBlocks) {
          outcome.textBlocks.push(...decoded.textBlocks);
        } else {
          outcome.assets.push(decoded.meta);
        }
        outcome.notices.push(...decoded.notices);
      } catch (error) {
        outcome.failures.push({
          fileName: validated.name,
          reason: error instanceof Error ? error.message : 'This file could not be read.',
        });
      }

      // Let the browser paint between files.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    progress?.update(1, 'Placing files');
    applyImport(outcome, options);
    progress?.done(summarise(outcome));
  } catch (error) {
    progress?.fail(error instanceof Error ? error.message : 'The import failed.');
    throw error;
  }

  return outcome;
}

function summarise(outcome: ImportOutcome): string {
  const parts: string[] = [];
  if (outcome.assets.length > 0) {
    parts.push(`${outcome.assets.length} image${outcome.assets.length === 1 ? '' : 's'}`);
  }
  if (outcome.textBlocks.length > 0) {
    parts.push(`${outcome.textBlocks.length} text block${outcome.textBlocks.length === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return 'Nothing was imported';
  return `Imported ${parts.join(' and ')}`;
}

/** Register the new assets on the project and place them where asked. */
function applyImport(outcome: ImportOutcome, options: ImportOptions): void {
  if (outcome.assets.length === 0 && outcome.textBlocks.length === 0) return;

  store.update(
    (draft) => {
      draft.assets.push(...outcome.assets);

      let remaining = outcome.assets.map((asset) => asset.id);

      if (options.fillFrames !== false) {
        const filled = fillEmptyFrames(draft, remaining);
        remaining = remaining.slice(filled);
      }

      if (options.autoPlace !== false && remaining.length > 0) {
        placeOnePerPage(draft, remaining);
      }

      if (outcome.textBlocks.length > 0) {
        placeTextBlocks(draft, outcome.textBlocks);
      }
    },
    { label: 'import' },
  );
}

/**
 * Place one image per page, centred within the margins and never cropped.
 * Existing empty pages are used before new ones are added.
 */
function placeOnePerPage(draft: Project, assetIds: string[]): void {
  const assets = new Map(draft.assets.map((asset) => [asset.id, asset]));
  const box = contentBox(
    { widthMm: draft.pageWidthMm, heightMm: draft.pageHeightMm },
    draft.margins,
  );

  for (const assetId of assetIds) {
    const asset = assets.get(assetId);
    if (!asset) continue;

    const ratio = asset.widthPx && asset.heightPx ? asset.widthPx / asset.heightPx : 1;
    const scale = Math.min(box.widthMm / ratio, box.heightMm);
    const widthMm = ratio * scale;
    const heightMm = scale;

    const element = createImageElement(assetId, {
      xMm: box.xMm + (box.widthMm - widthMm) / 2,
      yMm: box.yMm + (box.heightMm - heightMm) / 2,
      widthMm,
      heightMm,
    });

    const target = draft.pages.find((page) => page.elements.length === 0 && page.role === 'content');
    if (target) {
      target.elements.push(element);
      target.intentionallyBlank = false;
    } else {
      const page = createPage({ elements: [element] });
      // Keep a back cover last if the project has one.
      const backCoverIndex = draft.pages.findIndex((entry) => entry.role === 'back-cover');
      if (backCoverIndex >= 0) draft.pages.splice(backCoverIndex, 0, page);
      else draft.pages.push(page);
    }
  }
}

/** Flow imported text onto pages, one text frame per page. */
function placeTextBlocks(draft: Project, blocks: { text: string; heading: boolean }[]): void {
  const box = contentBox(
    { widthMm: draft.pageWidthMm, heightMm: draft.pageHeightMm },
    draft.margins,
  );

  // Rough capacity: characters that fit in the frame at the body size.
  const bodySizePt = 11;
  const charsPerLine = Math.max(20, Math.round(box.widthMm / (bodySizePt * 0.19)));
  const lines = Math.max(4, Math.floor(box.heightMm / (bodySizePt * 0.55)));
  const capacity = charsPerLine * lines;

  let buffer = '';
  const flush = (): void => {
    if (!buffer.trim()) return;
    const page = createPage({
      elements: [
        createTextElement(buffer.trim(), {
          xMm: box.xMm,
          yMm: box.yMm,
          widthMm: box.widthMm,
          heightMm: box.heightMm,
        }),
      ],
    });
    const backCoverIndex = draft.pages.findIndex((entry) => entry.role === 'back-cover');
    if (backCoverIndex >= 0) draft.pages.splice(backCoverIndex, 0, page);
    else draft.pages.push(page);
    buffer = '';
  };

  for (const block of blocks) {
    const chunk = block.heading ? `${block.text}\n` : block.text;
    if (buffer.length + chunk.length > capacity && buffer.length > 0) flush();
    buffer += `${chunk}\n\n`;
  }
  flush();
}

/** Report failures to the user without burying the successes. */
export function reportImport(outcome: ImportOutcome): void {
  for (const notice of outcome.notices.slice(0, 3)) {
    toast({ title: notice, kind: 'info' });
  }
  if (outcome.failures.length === 0) return;

  const first = outcome.failures[0]!;
  toast({
    title:
      outcome.failures.length === 1
        ? `Could not import “${first.fileName}”`
        : `${outcome.failures.length} files could not be imported`,
    detail: first.suggestion ? `${first.reason} ${first.suggestion}` : first.reason,
    kind: 'error',
  });
}

/** Open the system file picker. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    // `change` does not fire when the dialog is cancelled, so the promise is
    // also settled by the window regaining focus.
    const settle = (files: File[]): void => {
      input.remove();
      window.removeEventListener('focus', onFocus);
      resolve(files);
    };
    const onFocus = (): void => {
      setTimeout(() => {
        if (input.isConnected && (!input.files || input.files.length === 0)) settle([]);
      }, 400);
    };
    input.addEventListener('change', () => settle(Array.from(input.files ?? [])));
    window.addEventListener('focus', onFocus);
    document.body.append(input);
    input.click();
  });
}

/** Convenience wrapper used by every "Add files" button. */
export async function importFromPicker(accept: string, options: ImportOptions = {}): Promise<void> {
  const files = await pickFiles(accept);
  if (files.length === 0) return;
  try {
    const outcome = await importFiles(files, options);
    if (outcome.replacedProject) {
      await store.open(outcome.replacedProject);
      await store.save();
      toast({ title: `Opened “${outcome.replacedProject.name}”`, kind: 'success' });
      return;
    }
    reportImport(outcome);
  } catch (error) {
    toastError(error, 'The files could not be imported.');
  }
}
