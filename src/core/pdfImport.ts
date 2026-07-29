import { canvasToBlob, createCanvas } from './assets.ts';
import { newId } from './ids.ts';
import { matchPaperSize } from './paper.ts';
import { sanitizeLine } from './sanitize.ts';
import type { AssetMeta } from './types.ts';
import { ptToMm } from './units.ts';

/**
 * PDF import.
 *
 * PDF.js is loaded lazily — it is the largest dependency in the bundle and
 * most sessions never touch a PDF. Rendering happens entirely in the browser;
 * the file is never uploaded.
 *
 * ## Sandboxing
 *
 * A PDF is an executable document format: it can contain JavaScript, embedded
 * files and external references. PDF.js is configured to refuse all of that —
 * scripting off, `isEvalSupported: false`, no external font or URL fetching —
 * so an imported PDF cannot reach the application or the network. Pages are
 * rasterised to images, which means nothing from the PDF's own object graph
 * survives into the project.
 */

export interface PdfPageImport {
  meta: AssetMeta;
  blob: Blob;
  /** Page size in millimetres, from the PDF's own media box. */
  widthMm: number;
  heightMm: number;
  pageNumber: number;
}

export interface PdfImportResult {
  pages: PdfPageImport[];
  /** Detected paper size, when the PDF matches a catalogue entry. */
  paperSizeId: string | null;
  documentName: string;
  notices: string[];
}

export interface PdfImportOptions {
  /** Raster resolution. 150 is fine for reflow; 300 for reprinting. */
  dpi?: number;
  /** Import only these 1-based page numbers. */
  pageNumbers?: number[];
  onProgress?: (done: number, total: number) => void;
  /** Abort a long import. */
  signal?: AbortSignal;
}

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Vite resolves this to a hashed asset in the bundle, so the worker is
      // served from our own origin and works offline.
      const workerUrl = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function importPdf(file: File, options: PdfImportOptions = {}): Promise<PdfImportResult> {
  const pdfjs = await loadPdfjs();
  const dpi = options.dpi ?? 150;
  const notices: string[] = [];
  const data = new Uint8Array(await file.arrayBuffer());

  const task = pdfjs.getDocument({
    data,
    // Refuse everything that could execute or reach the network.
    isEvalSupported: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });

  let document: Awaited<ReturnType<typeof task.promise>>;
  try {
    document = await task.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      throw new Error('This PDF is password protected. Remove the password, then import it again.');
    }
    throw new Error('This PDF could not be opened. It may be damaged or use an unsupported feature.');
  }

  try {
    const total = document.numPages;
    const wanted =
      options.pageNumbers && options.pageNumbers.length > 0
        ? options.pageNumbers.filter((n) => n >= 1 && n <= total)
        : Array.from({ length: total }, (_, i) => i + 1);

    const pages: PdfPageImport[] = [];
    const documentName = sanitizeLine(file.name.replace(/\.pdf$/i, ''), 120) || 'PDF';
    let paperSizeId: string | null = null;

    for (let index = 0; index < wanted.length; index += 1) {
      if (options.signal?.aborted) throw new Error('Import cancelled.');
      const pageNumber = wanted[index]!;
      const page = await document.getPage(pageNumber);

      // `getViewport({ scale: 1 })` is in PDF points; convert to millimetres
      // so the rest of PrintNest speaks its usual units.
      const baseViewport = page.getViewport({ scale: 1 });
      const widthMm = ptToMm(baseViewport.width);
      const heightMm = ptToMm(baseViewport.height);
      if (index === 0) {
        paperSizeId = matchPaperSize(widthMm, heightMm)?.id ?? null;
      }

      const scale = dpi / 72;
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.max(1, Math.round(viewport.width)),
        Math.max(1, Math.round(viewport.height)),
      );
      const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
      if (!context) throw new Error('This browser could not create a canvas to render the PDF.');

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport }).promise;
      page.cleanup();

      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      if (!blob) {
        notices.push(`Page ${pageNumber} could not be converted to an image and was skipped.`);
        continue;
      }

      const assetId = newId('asset');
      pages.push({
        meta: {
          id: assetId,
          name: `${documentName} — page ${pageNumber}`,
          type: 'image/jpeg',
          bytes: blob.size,
          widthPx: canvas.width,
          heightPx: canvas.height,
          addedAt: Date.now(),
          source: { kind: 'pdf', pdfAssetId: file.name, pageIndex: pageNumber - 1 },
        },
        blob,
        widthMm,
        heightMm,
        pageNumber,
      });

      options.onProgress?.(index + 1, wanted.length);
    }

    if (pages.length === 0) {
      throw new Error('No pages could be read from this PDF.');
    }

    return { pages, paperSizeId, documentName, notices };
  } finally {
    await document.destroy();
  }
}

/** Read a PDF's page count and first page size without rendering anything. */
export async function inspectPdf(
  file: File,
): Promise<{ pageCount: number; widthMm: number; heightMm: number; paperSizeId: string | null }> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    useSystemFonts: false,
  }).promise;

  try {
    const first = await document.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    const widthMm = ptToMm(viewport.width);
    const heightMm = ptToMm(viewport.height);
    first.cleanup();
    return {
      pageCount: document.numPages,
      widthMm,
      heightMm,
      paperSizeId: matchPaperSize(widthMm, heightMm)?.id ?? null,
    };
  } finally {
    await document.destroy();
  }
}
