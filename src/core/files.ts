import { newId } from './ids.ts';
import { markdownToBlocks, sanitizeLine, sanitizeSvg, sanitizeText } from './sanitize.ts';
import type { AssetMeta } from './types.ts';

/**
 * File import and validation.
 *
 * Nothing here touches the network. Files are read with `FileReader` /
 * `Blob.arrayBuffer`, validated, and handed to the asset store. The type of a
 * file is decided by sniffing its bytes where a magic number exists, because
 * the extension and the browser-supplied MIME type are both attacker-controlled.
 */

export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_BYTES = 4 * 1024 * 1024;
export const MAX_FILES_PER_IMPORT = 500;

export type ImportKind = 'image' | 'vector' | 'pdf' | 'text';

export interface FileTypeInfo {
  kind: ImportKind;
  mime: string;
  label: string;
  /** Needs a decode attempt before we know whether this browser supports it. */
  needsDecodeProbe: boolean;
}

const ACCEPTED: Record<string, FileTypeInfo> = {
  'image/jpeg': { kind: 'image', mime: 'image/jpeg', label: 'JPEG', needsDecodeProbe: false },
  'image/png': { kind: 'image', mime: 'image/png', label: 'PNG', needsDecodeProbe: false },
  'image/webp': { kind: 'image', mime: 'image/webp', label: 'WebP', needsDecodeProbe: false },
  'image/gif': { kind: 'image', mime: 'image/gif', label: 'GIF', needsDecodeProbe: false },
  'image/avif': { kind: 'image', mime: 'image/avif', label: 'AVIF', needsDecodeProbe: true },
  'image/heic': { kind: 'image', mime: 'image/heic', label: 'HEIC', needsDecodeProbe: true },
  'image/heif': { kind: 'image', mime: 'image/heif', label: 'HEIF', needsDecodeProbe: true },
  'image/tiff': { kind: 'image', mime: 'image/tiff', label: 'TIFF', needsDecodeProbe: true },
  'image/svg+xml': { kind: 'vector', mime: 'image/svg+xml', label: 'SVG', needsDecodeProbe: false },
  'application/pdf': { kind: 'pdf', mime: 'application/pdf', label: 'PDF', needsDecodeProbe: false },
  'text/plain': { kind: 'text', mime: 'text/plain', label: 'Text', needsDecodeProbe: false },
  'text/markdown': { kind: 'text', mime: 'text/markdown', label: 'Markdown', needsDecodeProbe: false },
};

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
};

export const ACCEPT_ATTRIBUTE = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.heif',
  '.tif', '.tiff', '.svg', '.pdf', '.txt', '.md', '.printnest',
  'image/*', 'application/pdf', 'text/plain',
].join(',');

export function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

/**
 * Identify a file from its leading bytes. Returns `null` when the signature is
 * not one we accept, in which case the caller falls back to the extension.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]): boolean =>
    signature.every((byte, i) => bytes[i] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf'; // %PDF
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';

  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp';
  }

  // ISO-BMFF family: ....ftyp<brand>
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc')) {
      return 'image/heic';
    }
    if (brand.startsWith('mif1') || brand.startsWith('msf1')) return 'image/heif';
  }

  // SVG and plain text have no magic number; look for an XML/SVG opening.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!doctype svg')) {
    return head.includes('<svg') ? 'image/svg+xml' : null;
  }

  return null;
}

export interface ValidationFailure {
  fileName: string;
  reason: string;
  /** What the user can do about it. */
  suggestion?: string;
}

export interface ValidatedFile {
  file: File;
  info: FileTypeInfo;
  name: string;
}

/**
 * Validate a file's size and type. Reads only the first 4 KB — enough for
 * every signature we check — so a folder of large photographs stays fast.
 */
export async function validateFile(file: File): Promise<ValidatedFile | ValidationFailure> {
  const name = sanitizeLine(file.name || 'Untitled', 160);

  if (file.size === 0) {
    return { fileName: name, reason: 'The file is empty.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      fileName: name,
      reason: `The file is ${formatBytes(file.size)}, over the ${formatBytes(MAX_FILE_BYTES)} limit.`,
      suggestion: 'Try exporting a smaller version, or reduce the resolution before importing.',
    };
  }

  const head = await readHead(file, 4096);
  const sniffed = sniffMime(head);
  const byExtension = EXTENSION_MIME[fileExtension(name)];
  // Prefer the sniffed type; fall back to the extension only for formats with
  // no signature (SVG served as XML, .txt, .md).
  const mime = sniffed ?? byExtension ?? '';
  const info = ACCEPTED[mime];

  if (!info) {
    return {
      fileName: name,
      reason: 'PrintNest cannot read this file type.',
      suggestion:
        'Supported formats: JPEG, PNG, WebP, GIF, SVG, PDF, TXT and Markdown, plus HEIC/HEIF, AVIF and TIFF where the browser can decode them.',
    };
  }

  if (sniffed && byExtension && sniffed !== byExtension && info.kind !== 'text') {
    // Not fatal — a .jpg that is really a PNG is harmless — but worth saying.
    return {
      file,
      info: { ...info },
      name,
    };
  }

  if (info.kind === 'text' && file.size > MAX_TEXT_BYTES) {
    return {
      fileName: name,
      reason: `Text files are limited to ${formatBytes(MAX_TEXT_BYTES)}.`,
    };
  }
  if (info.kind === 'vector' && file.size > MAX_SVG_BYTES) {
    return {
      fileName: name,
      reason: `SVG files are limited to ${formatBytes(MAX_SVG_BYTES)}.`,
      suggestion: 'Very large SVGs are usually traced images — exporting a PNG will print the same.',
    };
  }

  return { file, info, name };
}

export function isValidationFailure(
  value: ValidatedFile | ValidationFailure,
): value is ValidationFailure {
  return 'reason' in value;
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

export interface DecodedAsset {
  meta: AssetMeta;
  /** The bytes to persist. For SVG this is the *sanitised* document. */
  blob: Blob;
  /** Present for text imports. */
  textBlocks?: { text: string; heading: boolean }[];
  /** Non-fatal notes, e.g. "removed a script element from this SVG". */
  notices: string[];
}

/**
 * Turn a validated file into an asset: sanitise it if needed, measure it, and
 * produce the blob to store. Throws with a user-facing message on failure.
 */
export async function decodeAsset(validated: ValidatedFile): Promise<DecodedAsset> {
  const { file, info, name } = validated;
  const id = newId('asset');
  const notices: string[] = [];

  if (info.kind === 'vector') {
    const source = await file.text();
    const result = sanitizeSvg(source);
    if (result.removed.length > 0) {
      notices.push(
        `Removed unsafe content from “${name}”: ${result.removed.slice(0, 6).join(', ')}.`,
      );
    }
    const blob = new Blob([result.svg], { type: 'image/svg+xml' });
    return {
      meta: {
        id,
        name,
        type: 'image/svg+xml',
        bytes: blob.size,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
        addedAt: Date.now(),
      },
      blob,
      notices,
    };
  }

  if (info.kind === 'text') {
    const raw = await file.text();
    const isMarkdown = info.mime === 'text/markdown';
    const blocks = isMarkdown
      ? markdownToBlocks(raw)
      : sanitizeText(raw, MAX_TEXT_BYTES)
          .split(/\n{2,}/)
          .map((text) => ({ text: text.trim(), heading: false }))
          .filter((block) => block.text.length > 0);
    const blob = new Blob([raw], { type: info.mime });
    return {
      meta: {
        id,
        name,
        type: info.mime,
        bytes: blob.size,
        widthPx: 0,
        heightPx: 0,
        addedAt: Date.now(),
      },
      blob,
      textBlocks: blocks,
      notices,
    };
  }

  if (info.kind === 'pdf') {
    return {
      meta: {
        id,
        name,
        type: 'application/pdf',
        bytes: file.size,
        widthPx: 0,
        heightPx: 0,
        addedAt: Date.now(),
      },
      blob: file,
      notices,
    };
  }

  // Raster image: measure it by decoding. This is also the point where an
  // unsupported HEIC or TIFF reveals itself.
  const size = await measureImage(file);
  if (!size) {
    throw new Error(
      `This browser cannot open “${name}” (${info.label}). ` +
        (info.needsDecodeProbe
          ? 'Safari on iPhone and Mac reads HEIC directly; on other browsers, export the photo as JPEG first.'
          : 'The file may be damaged.'),
    );
  }
  if (info.needsDecodeProbe) {
    notices.push(`“${name}” decoded successfully as ${info.label}.`);
  }

  return {
    meta: {
      id,
      name,
      type: info.mime,
      bytes: file.size,
      widthPx: size.width,
      heightPx: size.height,
      addedAt: Date.now(),
    },
    blob: file,
    notices,
  };
}

/**
 * Read an image's intrinsic pixel size. Prefers `createImageBitmap`, which
 * runs off the main thread and handles orientation metadata, and falls back to
 * an `HTMLImageElement` for browsers where the bitmap path rejects.
 */
export async function measureImage(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      // Fall through to the element-based path.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size.width > 0 && size.height > 0 ? size : null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Read the first `length` bytes of a file, via `FileReader` where
 * `Blob.arrayBuffer` is unavailable (Safari before 14).
 */
async function readHead(file: File, length: number): Promise<Uint8Array> {
  const slice = file.slice(0, length);
  if (typeof slice.arrayBuffer === 'function') {
    return new Uint8Array(await slice.arrayBuffer());
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => resolve(new Uint8Array(0));
    reader.readAsArrayBuffer(slice);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Pull files out of a drop or paste event, including directory drops, which
 * arrive as `webkitGetAsEntry` trees rather than a flat list.
 */
export async function filesFromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));

  if (entries.some(Boolean)) {
    const files: File[] = [];
    for (const entry of entries) {
      if (entry) await collectEntry(entry, files);
      if (files.length >= MAX_FILES_PER_IMPORT) break;
    }
    if (files.length > 0) return files.slice(0, MAX_FILES_PER_IMPORT);
  }
  return Array.from(transfer.files ?? []).slice(0, MAX_FILES_PER_IMPORT);
}

async function collectEntry(entry: FileSystemEntry, out: File[], depth = 0): Promise<void> {
  if (out.length >= MAX_FILES_PER_IMPORT || depth > 6) return;
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most 100 at a time; keep going until it is empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) break;
      for (const child of batch) await collectEntry(child, out, depth + 1);
      if (out.length >= MAX_FILES_PER_IMPORT) break;
    }
  }
}

/**
 * Natural sort so `img2.jpg` comes before `img10.jpg` — the order a
 * photographer expects when importing a shoot.
 */
export function sortFilesNaturally(files: File[]): File[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}
