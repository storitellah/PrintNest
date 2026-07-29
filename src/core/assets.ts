import { getAsset, getProjectAssets, putAsset } from './db.ts';
import { measureImage } from './files.ts';
import type { AssetMeta } from './types.ts';

/**
 * Asset manager.
 *
 * Owns the object URLs handed to `<img>` elements and the downsampled preview
 * bitmaps used by the canvas. Both are expensive: an unreleased object URL
 * pins the whole blob in memory, and a 48-megapixel photograph decoded at full
 * size for a thumbnail will stall a phone.
 *
 * The contract: ask for a URL through `objectUrl()`, never call
 * `URL.createObjectURL` directly, and call `releaseAll()` when a project closes.
 */

const urlCache = new Map<string, string>();
const blobCache = new Map<string, Blob>();
const previewCache = new Map<string, string>();
const pendingUrls = new Map<string, Promise<string | null>>();

/** Longest edge, in pixels, of a screen preview. */
export const PREVIEW_MAX_EDGE = 1400;
/** Longest edge of a thumbnail in the page list / asset tray. */
export const THUMBNAIL_MAX_EDGE = 320;

export async function storeAsset(projectId: string, meta: AssetMeta, blob: Blob): Promise<void> {
  blobCache.set(meta.id, blob);
  await putAsset({ id: meta.id, projectId, blob, type: meta.type, name: meta.name });
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  const cached = blobCache.get(assetId);
  if (cached) return cached;
  const stored = await getAsset(assetId);
  if (!stored) return null;
  blobCache.set(assetId, stored.blob);
  return stored.blob;
}

/**
 * A stable object URL for an asset. Repeat calls return the same URL, so
 * re-rendering a page does not leak a URL per frame.
 */
export async function objectUrl(assetId: string): Promise<string | null> {
  const existing = urlCache.get(assetId);
  if (existing) return existing;

  const inFlight = pendingUrls.get(assetId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const blob = await getAssetBlob(assetId);
    if (!blob) return null;
    // Another caller may have won the race while we were awaiting.
    const raced = urlCache.get(assetId);
    if (raced) return raced;
    const url = URL.createObjectURL(blob);
    urlCache.set(assetId, url);
    return url;
  })();

  pendingUrls.set(assetId, promise);
  try {
    return await promise;
  } finally {
    pendingUrls.delete(assetId);
  }
}

/** Synchronous read for render paths that have already warmed the cache. */
export function cachedObjectUrl(assetId: string): string | null {
  return urlCache.get(assetId) ?? null;
}

/** Warm the URL cache for a batch of assets before a render pass. */
export async function preloadAssets(assetIds: Iterable<string>): Promise<void> {
  await Promise.all(Array.from(new Set(assetIds)).map((id) => objectUrl(id)));
}

/**
 * A downsampled preview URL. Large photographs are re-encoded to a modest
 * JPEG/PNG so the editor scrolls smoothly; the original blob is untouched and
 * is what the exporters use.
 */
export async function previewUrl(assetId: string, maxEdge = PREVIEW_MAX_EDGE): Promise<string | null> {
  const key = `${assetId}@${maxEdge}`;
  const cached = previewCache.get(key);
  if (cached) return cached;

  const blob = await getAssetBlob(assetId);
  if (!blob) return null;

  // Vector and small rasters are already cheap — hand back the real thing.
  if (blob.type === 'image/svg+xml' || blob.size < 400 * 1024) {
    return objectUrl(assetId);
  }

  const downsampled = await downsample(blob, maxEdge);
  if (!downsampled) return objectUrl(assetId);

  const url = URL.createObjectURL(downsampled);
  previewCache.set(key, url);
  return url;
}

/**
 * Re-encode a raster to fit inside `maxEdge`. Returns `null` when the browser
 * cannot decode it, or when it is already small enough to leave alone.
 */
export async function downsample(blob: Blob, maxEdge: number): Promise<Blob | null> {
  const size = await measureImage(blob);
  if (!size) return null;
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return null;

  const scale = maxEdge / longest;
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));

  const bitmap = await createBitmap(blob);
  if (!bitmap) return null;
  try {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvasToBlob(canvas, 'image/jpeg', 0.82);
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}

async function createBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through */
    }
  }
  if (typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

export function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** Release one asset's cached URLs — used when an asset is deleted. */
export function release(assetId: string): void {
  const url = urlCache.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(assetId);
  }
  for (const [key, previewUrlValue] of previewCache) {
    if (key.startsWith(`${assetId}@`)) {
      URL.revokeObjectURL(previewUrlValue);
      previewCache.delete(key);
    }
  }
  blobCache.delete(assetId);
}

/** Release everything. Called when switching projects and on page unload. */
export function releaseAll(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  for (const url of previewCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  previewCache.clear();
  blobCache.clear();
  pendingUrls.clear();
}

/** Pull a project's blobs into the in-memory cache after loading from disk. */
export async function hydrateProjectAssets(projectId: string): Promise<void> {
  const stored = await getProjectAssets(projectId);
  for (const asset of stored) blobCache.set(asset.id, asset.blob);
}

export function assetAspectRatio(meta: AssetMeta): number {
  if (!meta.widthPx || !meta.heightPx) return 1;
  return meta.widthPx / meta.heightPx;
}

export function assetOrientation(meta: AssetMeta): 'portrait' | 'landscape' | 'square' {
  const ratio = assetAspectRatio(meta);
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}
