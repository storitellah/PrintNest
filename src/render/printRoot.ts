import { preloadAssets } from '../core/assets.ts';
import { imposeProject, manualDuplexPasses } from '../core/imposition.ts';
import type { PrintSheet } from '../core/imposition.ts';
import type { Project } from '../core/types.ts';
import { renderAssemblyMap, renderPosterSheets, renderSheet } from './sheetRender.ts';
import { projectSheet } from '../core/project.ts';

/**
 * The print document.
 *
 * PrintNest never opens a pop-up or an iframe to print. It builds the sheets
 * into a dedicated `#pn-print-root` element in the live document, sets an
 * `@page` rule matching the paper, and calls `window.print()`. The application
 * chrome is hidden by the print stylesheet, so what reaches the printer is
 * exactly the sheets and nothing else.
 *
 * This is deliberate: the browser's own print dialog is the only way a web
 * page can reach a printer, and it is the same dialog the operating system
 * gives every other application — so AirPrint, Mopria, Wi-Fi, USB and network
 * printers all work without PrintNest knowing anything about them.
 */

const PRINT_ROOT_ID = 'pn-print-root';
const PAGE_STYLE_ID = 'pn-page-rule';

export type PrintPass = 'all' | 'fronts' | 'backs';

export interface PrintJobOptions {
  project: Project;
  /** Which half of a manual duplex run to send. */
  pass?: PrintPass;
  /** Print fold/cut guides onto the paper. */
  showGuides?: boolean;
  /** Reverse the back pass for printers that stack face up. */
  reverseBacks?: boolean;
  /** Called once the browser's print dialog has closed. */
  onFinished?: () => void;
}

export interface PreparedPrintJob {
  sheetCount: number;
  sheetLabels: string[];
  /** Sends the prepared document to the browser's print dialog. */
  print: () => void;
  /** Removes the print document without printing. */
  dispose: () => void;
}

function getPrintRoot(): HTMLElement {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    document.body.append(root);
  }
  root.replaceChildren();
  return root;
}

/**
 * Set the `@page` rule to the project's paper.
 *
 * `size` in a named or explicit form is respected by Chrome, Edge and Safari.
 * Firefox honours the dimensions but still shows its own paper picker, and
 * every browser lets the user override — which is why the print screen always
 * repeats the paper size in words for the user to confirm in the dialog.
 */
function applyPageRule(widthMm: number, heightMm: number): void {
  let style = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    document.head.append(style);
  }
  const width = Math.round(widthMm * 100) / 100;
  const height = Math.round(heightMm * 100) / 100;
  style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
}

/**
 * Build the print document. Nothing is sent to the printer until `print()` is
 * called, so the caller can show a confirmation step first.
 */
export async function preparePrintJob(options: PrintJobOptions): Promise<PreparedPrintJob> {
  const { project } = options;
  const root = getPrintRoot();

  // Every image must be decodable before the print dialog opens, otherwise the
  // browser snapshots empty frames.
  await preloadAssets(
    project.assets
      .filter((asset) => asset.type.startsWith('image/'))
      .map((asset) => asset.id),
  );

  const sheetSize = projectSheet(project);
  applyPageRule(sheetSize.widthMm, sheetSize.heightMm);
  document.body.classList.add('pn-printing');

  const labels: string[] = [];

  if (project.kind === 'poster') {
    const { plan, sheets } = renderPosterSheets({
      project,
      showLabels: project.settings.poster.pageLabels,
      showCutMarks: project.settings.poster.cutMarks,
      showAlignmentMarks: project.settings.poster.alignmentMarks,
    });
    for (const sheet of sheets) {
      root.append(wrapSheet(sheet));
    }
    labels.push(...plan.tiles.map((tile) => `Tile ${tile.code}`));
    if (project.settings.poster.assemblyMap) {
      root.append(wrapSheet(renderAssemblyMap(plan, sheetSize)));
      labels.push('Assembly map');
    }
  } else {
    const result = imposeProject(project);
    let sheets: PrintSheet[] = result.sheets;

    if (options.pass === 'fronts' || options.pass === 'backs') {
      const passes = manualDuplexPasses(result, options.reverseBacks ?? false);
      sheets = options.pass === 'fronts' ? passes.fronts : passes.backs;
    }

    for (const sheet of sheets) {
      const node = renderSheet({
        project,
        sheet,
        result,
        showGuides: options.showGuides ?? project.settings.imposition.foldMarks,
        markBlanks: false,
      });
      root.append(wrapSheet(node));
      labels.push(sheet.label);
    }
  }

  // Scale correction learned from the calibration page. Applied to the whole
  // print root so every sheet is affected identically.
  const correction = project.settings.scaleCorrection;
  if (correction && Math.abs(correction - 1) > 0.0005) {
    root.style.setProperty('--pn-print-scale', String(correction));
    root.classList.add('pn-print-root--corrected');
  } else {
    root.style.removeProperty('--pn-print-scale');
    root.classList.remove('pn-print-root--corrected');
  }

  const dispose = (): void => {
    root.replaceChildren();
    document.body.classList.remove('pn-printing');
  };

  return {
    sheetCount: labels.length,
    sheetLabels: labels,
    print: () => {
      runPrint(dispose, options.onFinished);
    },
    dispose,
  };
}

function wrapSheet(sheet: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'pn-print-sheet';
  wrapper.append(sheet);
  return wrapper;
}

/**
 * Call `window.print()` and clean up afterwards.
 *
 * `afterprint` is the reliable signal on Chrome, Edge, Firefox and modern
 * Safari. The `matchMedia('print')` listener is a fallback for older WebKit,
 * and the timeout guarantees the print DOM is eventually torn down even if
 * neither fires — leaving it in place would slow the editor down.
 */
function runPrint(dispose: () => void, onFinished?: () => void): void {
  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    window.removeEventListener('afterprint', finish);
    mediaQuery?.removeEventListener?.('change', mediaListener);
    clearTimeout(timer);
    // Let the browser finish its own teardown before we remove the nodes.
    setTimeout(() => {
      dispose();
      onFinished?.();
    }, 120);
  };

  const mediaQuery = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
  const mediaListener = (event: MediaQueryListEvent): void => {
    if (!event.matches) finish();
  };

  window.addEventListener('afterprint', finish);
  mediaQuery?.addEventListener?.('change', mediaListener);
  const timer = setTimeout(finish, 60_000);

  window.print();
}

/**
 * Render a standalone document — the calibration page, a folding guide — and
 * print it without going through the project imposition.
 */
export async function printStandalone(
  build: () => HTMLElement[],
  paper: { widthMm: number; heightMm: number },
  onFinished?: () => void,
): Promise<void> {
  const root = getPrintRoot();
  applyPageRule(paper.widthMm, paper.heightMm);
  document.body.classList.add('pn-printing');
  for (const sheet of build()) root.append(wrapSheet(sheet));

  // Give the browser a frame to lay the new nodes out before snapshotting.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  runPrint(() => {
    root.replaceChildren();
    document.body.classList.remove('pn-printing');
  }, onFinished);
}

/** Clear any print document left behind, e.g. when the user cancels. */
export function clearPrintRoot(): void {
  const root = document.getElementById(PRINT_ROOT_ID);
  root?.replaceChildren();
  document.body.classList.remove('pn-printing');
}
