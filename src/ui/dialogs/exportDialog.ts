import { canvasToBlob, createCanvas } from '../../core/assets.ts';
import { imposeProject } from '../../core/imposition.ts';
import { projectSheet } from '../../core/project.ts';
import { downloadBlob, exportProjectFile, safeFileName } from '../../core/projectFile.ts';
import { store } from '../../core/store.ts';
import {
  DEFAULT_EXPORT_DPI,
  PREVIEW_EXPORT_DPI,
  decodeProjectImages,
  encodeCanvas,
  rasterizePage,
  rasterizeSheet,
  releaseImages,
} from '../../render/canvasRender.ts';
import { exportPdf } from '../../render/pdfExport.ts';
import { el, numberField, section, selectField, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import { progressToast, toast, toastError } from '../toast.ts';
import { openDialog } from './dialog.ts';

/**
 * Export.
 *
 * Everything is produced on the device and handed straight to the browser's
 * download mechanism — no upload, no temporary server copy.
 *
 * PDF is the recommended route for anything going to a print shop or another
 * device, because it carries the exact page dimensions with it. PNG and JPEG
 * are for sharing a preview or dropping a page into something else.
 */

type ExportFormat =
  | 'pdf-pages'
  | 'pdf-sheets'
  | 'png-pages'
  | 'jpeg-spreads'
  | 'png-sheets'
  | 'project'
  | 'preview';

interface FormatInfo {
  id: ExportFormat;
  label: string;
  description: string;
}

const FORMATS: FormatInfo[] = [
  {
    id: 'pdf-pages',
    label: 'PDF — reading order',
    description:
      'One PDF page per document page, at the finished page size. Text stays as text, so it prints sharply anywhere.',
  },
  {
    id: 'pdf-sheets',
    label: 'PDF — imposed print sheets',
    description:
      'The sheets exactly as PrintNest would print them, including folds and cut guides. This is the file to send to a copy shop.',
  },
  {
    id: 'png-pages',
    label: 'PNG — individual pages',
    description: 'One image per page at print resolution. Good for sharing single pages.',
  },
  {
    id: 'jpeg-spreads',
    label: 'JPEG — page spreads',
    description: 'Facing pages side by side, as the reader will see them.',
  },
  {
    id: 'png-sheets',
    label: 'PNG — imposed sheets',
    description: 'The print sheets as images, for checking the imposition outside PrintNest.',
  },
  {
    id: 'preview',
    label: 'Low-resolution preview',
    description: 'A small JPEG of every page, quick to share or email.',
  },
  {
    id: 'project',
    label: 'PrintNest project file',
    description:
      'The whole project including every imported file, as one .printnest file. Use it as a backup or to move the work to another device.',
  },
];

export function openExportDialog(): void {
  const project = store.project;
  if (!project) return;

  let format: ExportFormat = 'pdf-pages';
  let dpi = DEFAULT_EXPORT_DPI;

  const body = el('div');
  const handle = openDialog({
    title: 'Export',
    subtitle: project.name,
    body,
    wide: true,
  });

  const render = (): void => {
    const info = FORMATS.find((entry) => entry.id === format)!;
    const raster = format.startsWith('png') || format.startsWith('jpeg') || format === 'preview';
    const result = imposeProject(project);

    setChildren(
      body,
      selectField({
        label: 'What to export',
        value: format,
        options: FORMATS.map((entry) => ({ value: entry.id, label: entry.label })),
        onChange: (value) => {
          format = value as ExportFormat;
          render();
        },
      }),
      el('p', { class: 'pn-field__hint', style: { marginBottom: '1rem' }, text: info.description }),

      raster && format !== 'preview'
        ? numberField({
            label: 'Resolution (dots per inch)',
            hint: '300 matches photographic print quality. Higher values make very large files.',
            value: dpi,
            min: 72,
            max: 600,
            step: 6,
            onInput: (value) => {
              dpi = Math.round(value);
            },
          })
        : null,

      format.startsWith('pdf')
        ? numberField({
            label: 'Image resolution inside the PDF (dots per inch)',
            hint: 'Text and shapes are written as vectors and stay sharp at any size; this only affects pictures.',
            value: dpi,
            min: 72,
            max: 600,
            step: 6,
            onInput: (value) => {
              dpi = Math.round(value);
            },
          })
        : null,

      section(
        'What you will get',
        () =>
          el(
            'ul',
            { style: { margin: '0 0 0 1.1rem', lineHeight: '1.7', fontSize: '0.875rem' } },
            el('li', {
              text: format.includes('sheets')
                ? `${result.sheets.length} sheet${result.sheets.length === 1 ? '' : 's'} at ${Math.round(result.sheetSize.widthMm)} × ${Math.round(result.sheetSize.heightMm)} mm`
                : `${project.pages.length} page${project.pages.length === 1 ? '' : 's'} at ${Math.round(project.pageWidthMm)} × ${Math.round(project.pageHeightMm)} mm`,
            }),
            el('li', { text: 'Everything is produced on this device. Nothing is uploaded.' }),
            format.startsWith('pdf')
              ? el('li', { text: 'Page dimensions are written into the PDF, so printing at 100 % gives the true size.' })
              : null,
            format === 'project'
              ? el('li', { text: 'Imported pictures and PDFs are embedded, so the file is self-contained.' })
              : null,
          ),
        { open: true },
      ),
    );
  };

  handle.setFooter([
    el('button', { type: 'button', class: 'pn-btn', text: 'Cancel', onclick: () => handle.close() }),
    el(
      'button',
      {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        onclick: () => {
          handle.close();
          void runExport(format, dpi);
        },
      },
      icon('download', { size: 18 }),
      'Export',
    ),
  ]);

  render();
}

/* ------------------------------------------------------------------ *
 * Runners
 * ------------------------------------------------------------------ */

async function runExport(format: ExportFormat, dpi: number): Promise<void> {
  const project = store.project;
  if (!project) return;
  const stem = safeFileName(project.name);
  const progress = progressToast('Exporting');

  try {
    switch (format) {
      case 'pdf-pages':
      case 'pdf-sheets': {
        const blob = await exportPdf({
          project,
          layout: format === 'pdf-sheets' ? 'sheets' : 'pages',
          dpi,
          onProgress: (fraction, label) => progress.update(fraction, label),
        });
        downloadBlob(blob, `${stem}${format === 'pdf-sheets' ? '-print-sheets' : ''}.pdf`);
        break;
      }

      case 'png-pages':
        await exportPages(dpi, 'png', progress, stem);
        break;

      case 'preview':
        await exportPages(PREVIEW_EXPORT_DPI, 'jpeg', progress, `${stem}-preview`);
        break;

      case 'jpeg-spreads':
        await exportSpreads(dpi, progress, stem);
        break;

      case 'png-sheets':
        await exportSheets(dpi, progress, stem);
        break;

      case 'project': {
        const blob = await exportProjectFile(project, (done, total, label) =>
          progress.update(total > 0 ? done / total : 1, label),
        );
        downloadBlob(blob, `${stem}.printnest`);
        break;
      }
    }
    progress.done('Export finished');
  } catch (error) {
    progress.fail(error instanceof Error ? error.message : 'The export failed.');
    toastError(error);
  }
}

type Progress = ReturnType<typeof progressToast>;

async function exportPages(
  dpi: number,
  format: 'png' | 'jpeg',
  progress: Progress,
  stem: string,
): Promise<void> {
  const project = store.project!;
  const images = await decodeProjectImages(project);
  try {
    for (let index = 0; index < project.pages.length; index += 1) {
      progress.update(index / project.pages.length, `Page ${index + 1}`);
      const canvas = rasterizePage(project.pages[index]!, index, { project, images, dpi });
      if (!canvas) continue;
      const blob = await encodeCanvas(canvas, format, 0.9);
      if (blob) {
        downloadBlob(blob, `${stem}-page-${String(index + 1).padStart(2, '0')}.${format}`);
      }
      // Downloads are queued by the browser; a short gap keeps it from
      // dropping them or prompting for permission on every file.
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  } finally {
    releaseImages(images);
  }
}

async function exportSheets(dpi: number, progress: Progress, stem: string): Promise<void> {
  const project = store.project!;
  const result = imposeProject(project);
  const images = await decodeProjectImages(project);
  try {
    for (let index = 0; index < result.sheets.length; index += 1) {
      const sheet = result.sheets[index]!;
      progress.update(index / result.sheets.length, sheet.label);
      const canvas = rasterizeSheet(sheet, result, { project, images, dpi });
      if (!canvas) continue;
      const blob = await encodeCanvas(canvas, 'png');
      if (blob) {
        downloadBlob(
          blob,
          `${stem}-sheet-${String(sheet.sheetNumber).padStart(2, '0')}-${sheet.side}.png`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  } finally {
    releaseImages(images);
  }
}

/** Two pages side by side, as they read when the booklet is open. */
async function exportSpreads(dpi: number, progress: Progress, stem: string): Promise<void> {
  const project = store.project!;
  const images = await decodeProjectImages(project);
  const pxPerMm = dpi / 25.4;

  try {
    const spreads: [number | null, number | null][] = [[null, 0]];
    for (let index = 1; index < project.pages.length; index += 2) {
      spreads.push([index, index + 1 < project.pages.length ? index + 1 : null]);
    }

    for (let index = 0; index < spreads.length; index += 1) {
      progress.update(index / spreads.length, `Spread ${index + 1}`);
      const [left, right] = spreads[index]!;

      const width = Math.round(project.pageWidthMm * 2 * pxPerMm);
      const height = Math.round(project.pageHeightMm * pxPerMm);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
      if (!ctx) continue;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      for (const [side, pageIndex] of [
        [0, left],
        [1, right],
      ] as const) {
        if (pageIndex === null) continue;
        const page = project.pages[pageIndex];
        if (!page) continue;
        const pageCanvas = rasterizePage(page, pageIndex, { project, images, dpi });
        if (pageCanvas) {
          ctx.drawImage(pageCanvas as CanvasImageSource, side * (width / 2), 0);
        }
      }

      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      if (blob) {
        downloadBlob(blob, `${stem}-spread-${String(index + 1).padStart(2, '0')}.jpg`);
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  } finally {
    releaseImages(images);
  }
}

/** Export just the folding or cutting guide as its own printable sheet. */
export async function exportGuideSheet(kind: 'folding' | 'cutting'): Promise<void> {
  const project = store.project;
  if (!project) return;
  const result = imposeProject(project);
  const sheet = projectSheet(project);
  const wanted = kind === 'folding' ? 'fold' : 'cut';

  const guides = result.sheets[0]?.guides.filter((guide) =>
    kind === 'folding' ? guide.kind === 'fold' || guide.kind === 'slit' : guide.kind === 'cut',
  );

  if (!guides || guides.length === 0) {
    toast({
      title: `This layout has no ${wanted} guides`,
      detail: 'Folding and cutting guides come from the binding you have chosen.',
      kind: 'info',
    });
    return;
  }

  const pxPerMm = 300 / 25.4;
  const canvas = createCanvas(
    Math.round(sheet.widthMm * pxPerMm),
    Math.round(sheet.heightMm * pxPerMm),
  );
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = kind === 'folding' ? '#3D66F5' : '#C94A4A';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 8]);
  for (const guide of guides) {
    ctx.beginPath();
    ctx.moveTo(guide.x1Mm * pxPerMm, guide.y1Mm * pxPerMm);
    ctx.lineTo(guide.x2Mm * pxPerMm, guide.y2Mm * pxPerMm);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.fillStyle = '#171717';
  ctx.font = `${Math.round(5 * pxPerMm)}px sans-serif`;
  ctx.fillText(
    kind === 'folding' ? 'Fold along these lines' : 'Cut along these lines',
    10 * pxPerMm,
    12 * pxPerMm,
  );

  const blob = await canvasToBlob(canvas, 'image/png', 1);
  if (blob) downloadBlob(blob, `${safeFileName(project.name)}-${kind}-guide.png`);
}
