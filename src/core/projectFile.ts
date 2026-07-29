import { getProjectAssets, putAsset } from './db.ts';
import { releaseAll } from './assets.ts';
import { newProjectId } from './ids.ts';
import { normalizeProject } from './project.ts';
import { safeJsonParse, sanitizeLine, stripUnsafeKeys } from './sanitize.ts';
import { PROJECT_FILE_VERSION } from './types.ts';
import type { Project, ProjectBundle } from './types.ts';

/**
 * The `.printnest` project file.
 *
 * A single self-contained JSON document holding the layout **and** the assets,
 * so a project can move between devices, be emailed to a collaborator or kept
 * as a backup. Assets are base64-encoded inside the file: less compact than a
 * zip, but readable, dependency-free and safe to parse.
 *
 * Import is treated as untrusted input throughout: parsed with a
 * prototype-safe reviver, normalised field by field, and asset payloads are
 * re-typed from an allow-list rather than trusting the declared MIME type.
 */

export const PROJECT_FILE_EXTENSION = '.printnest';

const ALLOWED_ASSET_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
]);

/** Roughly the point where base64 in a single JSON string gets unwieldy. */
export const MAX_BUNDLE_BYTES = 250 * 1024 * 1024;

export interface ExportProgress {
  (done: number, total: number, label: string): void;
}

/** Bundle a project and its assets into a downloadable file. */
export async function exportProjectFile(
  project: Project,
  onProgress?: ExportProgress,
): Promise<Blob> {
  const stored = await getProjectAssets(project.id);
  const assets: ProjectBundle['assets'] = {};

  for (let index = 0; index < stored.length; index += 1) {
    const asset = stored[index]!;
    onProgress?.(index, stored.length, asset.name);
    assets[asset.id] = {
      type: asset.type,
      name: asset.name,
      data: await blobToBase64(asset.blob),
    };
  }

  const bundle: ProjectBundle = {
    format: 'printnest-project',
    version: PROJECT_FILE_VERSION,
    exportedAt: Date.now(),
    application: 'PrintNest by Storitellah',
    project,
    assets,
  };

  onProgress?.(stored.length, stored.length, 'Writing file');
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' });
}

export interface ImportResult {
  project: Project;
  assetCount: number;
  warnings: string[];
}

/**
 * Read a `.printnest` file back into a project.
 *
 * The imported project always gets a **new id**, so importing a backup never
 * silently overwrites the copy already on the device.
 */
export async function importProjectFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_BUNDLE_BYTES) {
    throw new Error(
      `This project file is ${Math.round(file.size / 1024 / 1024)} MB, which is larger than PrintNest can read.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParse(await file.text());
  } catch {
    throw new Error('This file is not a valid PrintNest project. It may be damaged.');
  }

  const bundle = stripUnsafeKeys(parsed) as Partial<ProjectBundle>;
  if (!bundle || bundle.format !== 'printnest-project') {
    throw new Error('This does not look like a PrintNest project file.');
  }
  if (typeof bundle.version === 'number' && bundle.version > PROJECT_FILE_VERSION) {
    throw new Error(
      'This project was made with a newer version of PrintNest. Update the app, then try again.',
    );
  }

  const warnings: string[] = [];
  const project = normalizeProject(bundle.project);
  project.id = newProjectId();
  project.updatedAt = Date.now();
  project.name = sanitizeLine(project.name, 120) || 'Imported project';

  const rawAssets = (bundle.assets ?? {}) as ProjectBundle['assets'];
  let assetCount = 0;

  for (const [assetId, payload] of Object.entries(rawAssets)) {
    if (!payload || typeof payload.data !== 'string') continue;
    if (!ALLOWED_ASSET_TYPES.has(payload.type)) {
      warnings.push(`Skipped “${sanitizeLine(payload.name, 80)}” — unsupported file type.`);
      continue;
    }
    try {
      const blob = base64ToBlob(payload.data, payload.type);
      await putAsset({
        id: assetId,
        projectId: project.id,
        blob,
        type: payload.type,
        name: sanitizeLine(payload.name, 160) || 'Imported file',
      });
      assetCount += 1;
    } catch {
      warnings.push(`Could not read the data for “${sanitizeLine(payload.name, 80)}”.`);
    }
  }

  // Drop image frames whose asset failed to import, so the project opens clean.
  const availableAssets = new Set(Object.keys(rawAssets));
  project.assets = project.assets.filter((asset) => availableAssets.has(asset.id));
  const liveAssets = new Set(project.assets.map((asset) => asset.id));
  for (const page of project.pages) {
    const before = page.elements.length;
    page.elements = page.elements.filter(
      (element) => element.type !== 'image' || liveAssets.has(element.assetId),
    );
    if (page.elements.length !== before) {
      warnings.push('Some image frames were removed because their files were missing.');
    }
  }

  releaseAll();
  return { project, assetCount, warnings: Array.from(new Set(warnings)) };
}

/* ------------------------------------------------------------------ *
 * Base64
 * ------------------------------------------------------------------ */

/**
 * Read a blob's bytes.
 *
 * `Blob.arrayBuffer()` is the direct route but is missing on Safari before 14
 * — still a real iPad in a classroom — so fall back to `FileReader`, which has
 * been available forever.
 */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Encode a blob as base64 without blowing the call stack on large files —
 * `String.fromCharCode(...bytes)` throws for anything over a few hundred KB.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blobBytes(blob);
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < buffer.length; offset += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* ------------------------------------------------------------------ *
 * Download helper
 * ------------------------------------------------------------------ */

/** Turn a project name into a safe file name stem. */
export function safeFileName(name: string, fallback = 'printnest-project'): string {
  const cleaned = sanitizeLine(name, 80)
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return cleaned || fallback;
}

/** Save a blob to the user's device. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
