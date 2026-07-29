import { imposeProject } from './imposition.ts';
import { contentBox, getPaperSize, resolveSheet } from './paper.ts';
import { isBooklet, projectSheet } from './project.ts';
import type { PrinterProfile } from './printerProfiles.ts';
import { assessImageElement } from './resolution.ts';
import type { Project } from './types.ts';
import { roundTo } from './units.ts';

/**
 * The pre-flight checker.
 *
 * Runs before printing and answers, in plain language, "is this going to come
 * out right?" Each check is independent and returns zero or more issues; the
 * worst severity present decides the overall verdict.
 */

export type IssueSeverity = 'ready' | 'review' | 'action';

export interface CheckIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** Offered as a one-click correction where one exists. */
  fix?: { label: string; action: FixAction };
  /** Jumps the interface to the offending page. */
  pageIndex?: number;
}

export type FixAction =
  | { kind: 'pad-to-multiple-of-four' }
  | { kind: 'grow-margins'; margins: { topMm: number; rightMm: number; bottomMm: number; leftMm: number } }
  | { kind: 'disable-crop-marks' }
  | { kind: 'switch-to-manual-duplex' }
  | { kind: 'switch-to-single-sided' }
  | { kind: 'select-page'; pageIndex: number };

export interface CheckReport {
  verdict: IssueSeverity;
  headline: string;
  issues: CheckIssue[];
  /** Counts for the summary strip. */
  sheetCount: number;
  pageCount: number;
  requiresTrimming: boolean;
  requiresManualReload: boolean;
}

export interface CheckContext {
  project: Project;
  profile: PrinterProfile | null;
}

export function runChecks({ project, profile }: CheckContext): CheckReport {
  const issues: CheckIssue[] = [];
  const sheet = projectSheet(project);
  const imposition = imposeProject(project);

  checkContent(project, issues);
  checkResolution(project, issues);
  checkPageOrder(project, issues);
  checkBookletCount(project, issues);
  checkDuplex(project, profile, issues);
  checkPrintableArea(project, profile, issues);
  checkElementsInsideSafeArea(project, issues);
  checkBlankPages(project, issues);
  checkPaperSupport(project, profile, issues);
  checkMarks(project, profile, issues);
  checkPageFitsSheet(project, sheet, issues);

  const verdict: IssueSeverity = issues.some((issue) => issue.severity === 'action')
    ? 'action'
    : issues.some((issue) => issue.severity === 'review')
      ? 'review'
      : 'ready';

  return {
    verdict,
    headline: HEADLINES[verdict],
    issues,
    sheetCount: imposition.sheets.length,
    pageCount: project.pages.length,
    requiresTrimming: imposition.requiresTrimming,
    requiresManualReload: imposition.requiresManualReload,
  };
}

const HEADLINES: Record<IssueSeverity, string> = {
  ready: 'Ready to print',
  review: 'Review suggested',
  action: 'Action required',
};

/* ------------------------------------------------------------------ *
 * Individual checks
 * ------------------------------------------------------------------ */

function checkContent(project: Project, issues: CheckIssue[]): void {
  const hasContent = project.pages.some((page) => page.elements.length > 0);
  if (!hasContent) {
    issues.push({
      id: 'no-content',
      severity: 'action',
      title: 'There is nothing on the pages yet',
      detail: 'Add images, text or shapes before printing — every page is currently empty.',
    });
    return;
  }

  const known = new Set(project.assets.map((asset) => asset.id));
  const broken: number[] = [];
  const empty: number[] = [];
  project.pages.forEach((page, index) => {
    for (const element of page.elements) {
      if (element.type !== 'image') continue;
      if (!element.assetId) empty.push(index);
      else if (!known.has(element.assetId)) broken.push(index);
    }
  });

  if (empty.length > 0) {
    issues.push({
      id: 'empty-frames',
      severity: 'review',
      title: `${empty.length} photo frame${empty.length === 1 ? ' is' : 's are'} still empty`,
      detail:
        'Empty template frames print as blank space. Drop a picture into each one, or delete the frames you do not need.',
      pageIndex: empty[0],
      fix: { label: 'Go to the page', action: { kind: 'select-page', pageIndex: empty[0]! } },
    });
  }

  if (broken.length > 0) {
    issues.push({
      id: 'missing-assets',
      severity: 'action',
      title: `${broken.length} image ${broken.length === 1 ? 'frame is' : 'frames are'} missing their file`,
      detail:
        'The image data is no longer in local storage. Re-import the file, or delete the empty frame.',
      pageIndex: broken[0],
      fix: { label: 'Go to the page', action: { kind: 'select-page', pageIndex: broken[0]! } },
    });
  }
}

function checkResolution(project: Project, issues: CheckIssue[]): void {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const low: { pageIndex: number; dpi: number }[] = [];

  project.pages.forEach((page, pageIndex) => {
    for (const element of page.elements) {
      if (element.type !== 'image') continue;
      const assessment = assessImageElement(element, assets.get(element.assetId));
      if (assessment && assessment.level === 'low') low.push({ pageIndex, dpi: assessment.dpi });
    }
  });

  if (low.length === 0) return;
  const worst = low.reduce((a, b) => (a.dpi < b.dpi ? a : b));
  issues.push({
    id: 'low-resolution',
    severity: 'review',
    title: `${low.length} image${low.length === 1 ? '' : 's'} may print soft`,
    detail: `The lowest works out at about ${worst.dpi} dots per inch at its printed size. Make the frame smaller, or use a larger original file.`,
    pageIndex: worst.pageIndex,
    fix: { label: 'Go to the page', action: { kind: 'select-page', pageIndex: worst.pageIndex } },
  });
}

function checkPageOrder(project: Project, issues: CheckIssue[]): void {
  if (!isBooklet(project) && project.settings.imposition.binding === 'none') return;
  const covers = project.pages.filter((page) => page.role === 'cover');
  if (covers.length > 1) {
    issues.push({
      id: 'multiple-covers',
      severity: 'review',
      title: 'More than one page is marked as the front cover',
      detail: 'Page numbering skips covers, so extra covers will leave gaps in the numbering.',
    });
  }
  const firstIsCover = project.pages[0]?.role === 'cover';
  if (project.pages.length >= 4 && !firstIsCover && isBooklet(project)) {
    issues.push({
      id: 'no-cover',
      severity: 'review',
      title: 'The first page is not marked as a cover',
      detail:
        'In a folded booklet, page 1 lands on the outside. Mark it as the front cover so page numbers start on the right page.',
      pageIndex: 0,
    });
  }
}

function checkBookletCount(project: Project, issues: CheckIssue[]): void {
  const { binding, signatureSize } = project.settings.imposition;
  if (binding !== 'saddle-stitch' && binding !== 'perfect-bound') {
    if (binding === 'mini-zine-8' && project.pages.length % 8 !== 0) {
      issues.push({
        id: 'zine-not-multiple-of-eight',
        severity: 'review',
        title: `A mini zine needs pages in groups of eight — you have ${project.pages.length}`,
        detail: `The remaining ${8 - (project.pages.length % 8)} panel${
          8 - (project.pages.length % 8) === 1 ? '' : 's'
        } will print blank.`,
      });
    }
    return;
  }

  const count = project.pages.length;
  if (count < 4) {
    issues.push({
      id: 'booklet-too-short',
      severity: 'action',
      title: 'A folded booklet needs at least four pages',
      detail: 'Add pages until you have four, which is one folded sheet.',
      fix: { label: 'Add blank pages', action: { kind: 'pad-to-multiple-of-four' } },
    });
    return;
  }
  if (count % 4 !== 0) {
    const needed = 4 - (count % 4);
    issues.push({
      id: 'booklet-not-multiple-of-four',
      severity: 'review',
      title: `Booklet pages come in fours — you have ${count}`,
      detail: `${needed} blank page${needed === 1 ? '' : 's'} will be added automatically. Add ${
        needed === 1 ? 'it' : 'them'
      } yourself if you want to choose where the blanks land.`,
      fix: { label: `Add ${needed} blank page${needed === 1 ? '' : 's'}`, action: { kind: 'pad-to-multiple-of-four' } },
    });
  }
  if (signatureSize >= 4 && signatureSize % 4 !== 0) {
    issues.push({
      id: 'signature-not-multiple-of-four',
      severity: 'review',
      title: 'Signature size is not a multiple of four',
      detail: `A signature is made of folded sheets, so it must be 4, 8, 12, 16 … pages. ${signatureSize} will be rounded up.`,
    });
  }
}

function checkDuplex(project: Project, profile: PrinterProfile | null, issues: CheckIssue[]): void {
  const { duplex, binding } = project.settings.imposition;
  const needsDuplex = binding === 'saddle-stitch' || binding === 'perfect-bound';

  if (needsDuplex && duplex === 'single-sided') {
    issues.push({
      id: 'booklet-single-sided',
      severity: 'action',
      title: 'A folded booklet has to be printed on both sides',
      detail: 'Choose automatic duplex if your printer has it, or use the manual duplex assistant.',
      fix: { label: 'Use manual duplex', action: { kind: 'switch-to-manual-duplex' } },
    });
  }

  if (duplex === 'auto-duplex' && profile && !profile.autoDuplex) {
    issues.push({
      id: 'no-auto-duplex',
      severity: 'action',
      title: `${profile.brand} ${profile.model} has no automatic duplex`,
      detail:
        'This printer cannot turn the paper over on its own. Switch to manual duplex and PrintNest will walk you through reloading.',
      fix: { label: 'Switch to manual duplex', action: { kind: 'switch-to-manual-duplex' } },
    });
  }

  if (duplex !== 'single-sided' && profile && !profile.autoDuplex && !profile.manualDuplex) {
    issues.push({
      id: 'no-duplex-at-all',
      severity: 'action',
      title: 'This printer profile is single-sided only',
      detail: 'Dedicated photo printers usually cannot print on the back of a sheet.',
      fix: { label: 'Print single-sided', action: { kind: 'switch-to-single-sided' } },
    });
  }

  if (duplex === 'manual-duplex' && profile?.duplexFlip === 'unknown') {
    issues.push({
      id: 'unknown-flip',
      severity: 'review',
      title: 'The paper-flip direction for this printer is not known yet',
      detail:
        'Run the one-page duplex test in the manual duplex assistant. PrintNest will remember the answer for next time.',
    });
  }
}

function checkPrintableArea(
  project: Project,
  profile: PrinterProfile | null,
  issues: CheckIssue[],
): void {
  if (!profile) return;
  const { margins } = project;
  const min = profile.minMargins;
  const tight: string[] = [];
  if (margins.topMm < min.topMm) tight.push('top');
  if (margins.rightMm < min.rightMm) tight.push('right');
  if (margins.bottomMm < min.bottomMm) tight.push('bottom');
  if (margins.leftMm < min.leftMm) tight.push('left');

  if (tight.length === 0) return;

  const borderlessAvailable = profile.borderlessSizes.includes(project.paper.sizeId);
  issues.push({
    id: 'margins-too-small',
    severity: borderlessAvailable ? 'review' : 'action',
    title: `Margins are smaller than ${profile.brand} ${profile.model} can print`,
    detail: borderlessAvailable
      ? `The ${tight.join(', ')} margin${tight.length === 1 ? ' is' : 's are'} inside the normal unprintable area. This works only if you switch the printer driver to borderless for ${project.paper.sizeId.toUpperCase()}.`
      : `The ${tight.join(', ')} margin${
          tight.length === 1 ? ' is' : 's are'
        } inside the unprintable edge — content there will be cut off. This printer has no borderless mode for this paper size.`,
    fix: {
      label: 'Grow margins to the safe minimum',
      action: {
        kind: 'grow-margins',
        margins: {
          topMm: Math.max(margins.topMm, min.topMm),
          rightMm: Math.max(margins.rightMm, min.rightMm),
          bottomMm: Math.max(margins.bottomMm, min.bottomMm),
          leftMm: Math.max(margins.leftMm, min.leftMm),
        },
      },
    },
  });
}

function checkElementsInsideSafeArea(project: Project, issues: CheckIssue[]): void {
  const safe = project.settings.marks.safeAreaMm;
  const outside: number[] = [];

  project.pages.forEach((page, pageIndex) => {
    for (const element of page.elements) {
      if (element.hidden) continue;
      const bleed = project.settings.marks.bleedMm;
      // Full-bleed elements are meant to run off the page; only flag content
      // that overshoots without reaching a deliberate bleed.
      const overshootsLeft = element.xMm < -bleed;
      const overshootsTop = element.yMm < -bleed;
      const overshootsRight = element.xMm + element.widthMm > project.pageWidthMm + bleed;
      const overshootsBottom = element.yMm + element.heightMm > project.pageHeightMm + bleed;
      const insideSafe =
        element.xMm >= safe - 0.01 &&
        element.yMm >= safe - 0.01 &&
        element.xMm + element.widthMm <= project.pageWidthMm - safe + 0.01 &&
        element.yMm + element.heightMm <= project.pageHeightMm - safe + 0.01;

      const isFullBleed =
        element.xMm <= 0.01 &&
        element.yMm <= 0.01 &&
        element.xMm + element.widthMm >= project.pageWidthMm - 0.01 &&
        element.yMm + element.heightMm >= project.pageHeightMm - 0.01;

      if (overshootsLeft || overshootsTop || overshootsRight || overshootsBottom) {
        outside.push(pageIndex);
      } else if (!insideSafe && !isFullBleed && element.type === 'text') {
        // Text is what actually suffers from being close to the trim.
        outside.push(pageIndex);
      }
    }
  });

  if (outside.length === 0) return;
  const unique = Array.from(new Set(outside));
  issues.push({
    id: 'outside-safe-area',
    severity: 'review',
    title: `Content sits close to the edge on ${unique.length} page${unique.length === 1 ? '' : 's'}`,
    detail: `Anything within ${roundTo(safe, 1)} mm of the trim can be clipped by the printer or lost when cutting. Full-bleed images are fine — this mostly matters for text.`,
    pageIndex: unique[0],
    fix: { label: 'Go to the page', action: { kind: 'select-page', pageIndex: unique[0]! } },
  });
}

function checkBlankPages(project: Project, issues: CheckIssue[]): void {
  const accidental = project.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.elements.length === 0 && !page.intentionallyBlank);

  if (accidental.length === 0) return;
  issues.push({
    id: 'blank-pages',
    severity: 'review',
    title: `${accidental.length} page${accidental.length === 1 ? ' is' : 's are'} empty`,
    detail:
      'Empty pages still use paper. Mark them as intentionally blank to silence this, or delete them.',
    pageIndex: accidental[0]!.index,
    fix: { label: 'Go to the page', action: { kind: 'select-page', pageIndex: accidental[0]!.index } },
  });
}

function checkPaperSupport(
  project: Project,
  profile: PrinterProfile | null,
  issues: CheckIssue[],
): void {
  if (!profile) return;
  if (project.paper.sizeId === 'custom') {
    const max = getPaperSize(profile.maxPaperSizeId);
    if (max && (project.paper.widthMm > max.widthMm + 1 || project.paper.heightMm > max.heightMm + 1)) {
      issues.push({
        id: 'custom-paper-too-large',
        severity: 'review',
        title: 'This custom paper is larger than the printer’s maximum',
        detail: `${profile.brand} ${profile.model} takes up to ${max.name}. Larger sheets will be scaled down or clipped by the driver.`,
      });
    }
    return;
  }
  if (!profile.paperSizes.includes(project.paper.sizeId)) {
    const paper = getPaperSize(project.paper.sizeId);
    issues.push({
      id: 'paper-not-supported',
      severity: 'review',
      title: `${paper?.name ?? 'This paper size'} is not listed for ${profile.model}`,
      detail:
        'The print dialog may substitute a different size, which changes the scale. Check the paper size in the driver, or add this size to the printer profile.',
    });
  }
}

function checkMarks(project: Project, profile: PrinterProfile | null, issues: CheckIssue[]): void {
  const { marks } = project.settings;
  if (!marks.cropMarks) return;

  const sheet = projectSheet(project);
  const needed = marks.bleedMm + marks.cropMarkLengthMm + 1;
  const available = Math.min(
    project.margins.topMm,
    project.margins.rightMm,
    project.margins.bottomMm,
    project.margins.leftMm,
  );
  const printableEdge = profile
    ? Math.min(
        profile.minMargins.topMm,
        profile.minMargins.rightMm,
        profile.minMargins.bottomMm,
        profile.minMargins.leftMm,
      )
    : 0;

  if (available < needed) {
    issues.push({
      id: 'crop-marks-clipped',
      severity: 'review',
      title: 'Crop marks do not fit in the margin',
      detail: `Crop marks need about ${roundTo(needed, 1)} mm of margin and there is ${roundTo(
        available,
        1,
      )} mm. Grow the margins, shorten the marks, or turn them off.`,
      fix: { label: 'Turn crop marks off', action: { kind: 'disable-crop-marks' } },
    });
  } else if (profile && available - needed < printableEdge) {
    issues.push({
      id: 'crop-marks-outside-printable',
      severity: 'review',
      title: 'Crop marks may fall in the unprintable edge',
      detail: `${profile.model} cannot print within ${roundTo(printableEdge, 1)} mm of the paper edge, so the outer ends of the marks may not appear.`,
    });
  }

  if (marks.bleedMm > 0 && sheet.widthMm - project.pageWidthMm < marks.bleedMm * 2) {
    issues.push({
      id: 'no-room-for-bleed',
      severity: 'review',
      title: 'There is not enough paper around the page for the bleed',
      detail:
        'Bleed only works when the page is smaller than the sheet, so there is spare paper to trim away. Use a larger sheet, or a smaller page.',
    });
  }
}

function checkPageFitsSheet(
  project: Project,
  sheet: { widthMm: number; heightMm: number },
  issues: CheckIssue[],
): void {
  const box = contentBox(sheet, project.margins);
  const { binding } = project.settings.imposition;
  if (binding !== 'none') return;
  const { columns, rows } = project.settings.nUp;
  const cellWidth = box.widthMm / Math.max(1, columns);
  const cellHeight = box.heightMm / Math.max(1, rows);

  if (project.pageWidthMm > cellWidth + 0.5 || project.pageHeightMm > cellHeight + 0.5) {
    issues.push({
      id: 'page-larger-than-cell',
      severity: 'review',
      title: 'The page is larger than the space it has on the sheet',
      detail: `Pages will be scaled down to fit ${roundTo(cellWidth, 1)} × ${roundTo(
        cellHeight,
        1,
      )} mm. If you wanted them at true size, use bigger paper or smaller margins.`,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Applying fixes
 * ------------------------------------------------------------------ */

/** Mutates a draft project in place. Paired with `store.update`. */
export function applyFix(draft: Project, action: FixAction, addBlankPage: () => void): void {
  switch (action.kind) {
    case 'pad-to-multiple-of-four': {
      const remainder = draft.pages.length % 4;
      const needed = draft.pages.length < 4 ? 4 - draft.pages.length : remainder === 0 ? 0 : 4 - remainder;
      for (let i = 0; i < needed; i += 1) addBlankPage();
      break;
    }
    case 'grow-margins':
      draft.margins = {
        topMm: action.margins.topMm,
        rightMm: action.margins.rightMm,
        bottomMm: action.margins.bottomMm,
        leftMm: action.margins.leftMm,
      };
      break;
    case 'disable-crop-marks':
      draft.settings.marks.cropMarks = false;
      break;
    case 'switch-to-manual-duplex':
      draft.settings.imposition.duplex = 'manual-duplex';
      break;
    case 'switch-to-single-sided':
      draft.settings.imposition.duplex = 'single-sided';
      break;
    case 'select-page':
      // Handled by the caller — nothing to change in the document.
      break;
  }
}

/** Does the layout need the paper trimmed after printing? */
export function summariseFinishing(project: Project): string[] {
  const notes: string[] = [];
  const result = imposeProject(project);
  if (result.requiresTrimming) notes.push('This layout needs trimming after printing.');
  if (result.requiresManualReload) notes.push('This layout needs the paper reloaded halfway through.');
  if (project.settings.marks.bleedMm > 0) notes.push('Trim to the crop marks to remove the bleed.');
  const sheet = resolveSheet(
    { widthMm: project.paper.widthMm, heightMm: project.paper.heightMm },
    project.paper.orientation,
  );
  if (result.pagesPerSide > 1) {
    notes.push(
      `${result.pagesPerSide} pages fit on each ${roundTo(sheet.widthMm, 0)} × ${roundTo(
        sheet.heightMm,
        0,
      )} mm side.`,
    );
  }
  return notes;
}
