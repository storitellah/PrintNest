import { applyFix, runChecks } from '../../core/checker.ts';
import type { CheckIssue, CheckReport } from '../../core/checker.ts';
import { buildSteps, defaultSetup } from '../../core/duplex.ts';
import { imposeProject } from '../../core/imposition.ts';
import { projectSheet } from '../../core/project.ts';
import { getProfile, loadProfiles } from '../../core/printerProfiles.ts';
import type { PrinterProfile } from '../../core/printerProfiles.ts';
import { store } from '../../core/store.ts';
import { describeSheet, getPaperSize } from '../../core/paper.ts';
import { preparePrintJob } from '../../render/printRoot.ts';
import { animate, checkbox, el, numberField, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import { addPage } from '../panels/pagesPanel.ts';
import { toast, toastError } from '../toast.ts';
import { openDialog } from './dialog.ts';
import type { DialogHandle } from './dialog.ts';
import { openDuplexAssistant } from './duplexDialog.ts';

/**
 * The print flow.
 *
 * Three steps, always in the same order:
 *   1. the checklist — what might go wrong
 *   2. the summary   — what will actually come out of the printer
 *   3. the dialog    — the operating system's own print dialog
 *
 * Step 3 is where PrintNest's control ends, so step 2 is deliberately explicit
 * about the settings the user still has to confirm there. A web page cannot
 * choose a printer, set the paper size, or turn off "fit to page" — pretending
 * otherwise would produce silently wrong prints.
 */

export async function openPrintDialog(): Promise<void> {
  const project = store.project;
  if (!project) return;

  const profiles = await loadProfiles();
  const profile = getProfile(profiles, project.settings.printerProfileId);
  const report = runChecks({ project, profile });

  const body = el('div');
  const handle = openDialog({
    title: 'Print',
    subtitle: project.name,
    body,
    wide: true,
  });

  renderStep(handle, body, report, profile);
}

function renderStep(
  handle: DialogHandle,
  body: HTMLElement,
  report: CheckReport,
  profile: PrinterProfile | null,
): void {
  const project = store.project!;
  const sheet = projectSheet(project);
  const result = imposeProject(project);
  const paper = getPaperSize(project.paper.sizeId);
  const manualDuplex = project.settings.imposition.duplex === 'manual-duplex';

  setChildren(
    body,
    verdictBanner(report),
    checklist(report, handle, body, profile),
    el('h3', { text: 'What will print', style: { margin: '1.5rem 0 0.5rem' } }),
    summaryTable([
      ['Paper', `${paper?.name ?? 'Custom'} ${project.paper.orientation} · ${describeSheet(sheet)}`],
      ['Sheets', `${result.sheets.length} side${result.sheets.length === 1 ? '' : 's'} of paper`],
      ['Pages', `${project.pages.length} page${project.pages.length === 1 ? '' : 's'}${
        result.addedBlanks > 0 ? ` (+${result.addedBlanks} blank added by the layout)` : ''
      }`],
      ['Layout', describeBinding()],
      ['Sides', describeDuplex()],
      ['Copies', String(project.settings.copies)],
      profile ? ['Printer profile', `${profile.brand} ${profile.model}`] : null,
    ]),

    dialogSettingsNote(paper?.name ?? describeSheet(sheet)),

    el(
      'div',
      { style: { marginTop: '1rem' } },
      numberField({
        label: 'Copies',
        value: project.settings.copies,
        min: 1,
        max: 99,
        step: 1,
        hint: 'Set the same number in the print dialog — the browser cannot set it for you.',
        onInput: (value) =>
          store.update((draft) => void (draft.settings.copies = Math.round(value)), { label: 'copies' }),
      }),
      checkbox({
        label: 'Print fold and cut guides on the paper',
        note: 'Helpful the first few times; turn it off for the final copy.',
        checked: project.settings.imposition.foldMarks,
        onChange: (checked) =>
          store.update((draft) => void (draft.settings.imposition.foldMarks = checked), {
            label: 'fold-marks',
          }),
      }),
    ),

    result.instructions.length > 0
      ? el(
          'div',
          { class: 'pn-note pn-note--info', style: { marginTop: '1rem' } },
          icon('info', { size: 18, class: 'pn-note__icon' }),
          el(
            'div',
            {},
            el('strong', { text: 'After printing' }),
            el(
              'ol',
              { style: { margin: '0.5rem 0 0 1.1rem', lineHeight: '1.6' } },
              ...result.instructions.map((instruction) => el('li', { text: instruction })),
            ),
          ),
        )
      : null,
  );

  const printLabel = manualDuplex ? 'Start manual duplex' : 'Open the print dialog';

  handle.setFooter([
    el('button', { type: 'button', class: 'pn-btn', text: 'Cancel', onclick: () => handle.close() }),
    el(
      'button',
      {
        type: 'button',
        class: 'pn-btn pn-btn--print',
        disabled: report.verdict === 'action',
        title:
          report.verdict === 'action'
            ? 'Resolve the items marked “Action required” first.'
            : undefined,
        onclick: () => {
          if (manualDuplex) {
            handle.close();
            void openDuplexAssistant();
            return;
          }
          void sendToPrinter(handle);
        },
      },
      icon('print', { size: 18 }),
      printLabel,
    ),
  ]);

  function describeBinding(): string {
    switch (project.settings.imposition.binding) {
      case 'saddle-stitch':
        return `Folded booklet, ${result.pagesPerSide} pages per side`;
      case 'perfect-bound':
        return 'Cut-and-stack, 2 pages per side';
      case 'mini-zine-8':
        return 'Eight-page mini zine, one sheet';
      case 'accordion':
        return 'Accordion fold';
      case 'gatefold':
        return 'Gatefold';
      default:
        return project.settings.nUp.columns * project.settings.nUp.rows > 1
          ? `${project.settings.nUp.columns} × ${project.settings.nUp.rows} per sheet`
          : 'One page per sheet';
    }
  }

  function describeDuplex(): string {
    switch (project.settings.imposition.duplex) {
      case 'auto-duplex':
        return 'Both sides — automatic. Turn duplex on in the print dialog.';
      case 'manual-duplex':
        return 'Both sides — manual, in two passes with a reload in between.';
      default:
        return 'One side only';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function verdictBanner(report: CheckReport): HTMLElement {
  const tone =
    report.verdict === 'ready' ? 'success' : report.verdict === 'review' ? 'warn' : 'error';
  return el(
    'div',
    { class: `pn-note pn-note--${tone}`, role: report.verdict === 'action' ? 'alert' : 'status' },
    icon(report.verdict === 'ready' ? 'check' : 'alert', { size: 20, class: 'pn-note__icon' }),
    el(
      'div',
      {},
      el('strong', { text: report.headline }),
      el('div', {
        style: { marginTop: '2px', fontSize: '0.8125rem' },
        text:
          report.verdict === 'ready'
            ? 'Every check passed. Nothing is likely to surprise you.'
            : report.verdict === 'review'
              ? `${report.issues.length} thing${report.issues.length === 1 ? '' : 's'} worth a look before you use the paper.`
              : 'Fix the items below — printing now would waste paper.',
      }),
    ),
  );
}

function checklist(
  report: CheckReport,
  handle: DialogHandle,
  body: HTMLElement,
  profile: PrinterProfile | null,
): HTMLElement {
  if (report.issues.length === 0) return el('div');

  const container = el('div', { class: 'pn-checklist', style: { marginTop: '1rem' } });
  // Action-required first: they are what blocks printing.
  const ordered = [...report.issues].sort((a, b) => severityRank(b) - severityRank(a));

  for (const issue of ordered) {
    container.append(
      el(
        'div',
        { class: `pn-issue pn-issue--${issue.severity}` },
        icon(issue.severity === 'action' ? 'alert' : 'info', { size: 18, class: 'pn-issue__icon' }),
        el(
          'div',
          { class: 'pn-issue__body' },
          el('div', { class: 'pn-issue__title', text: issue.title }),
          el('div', { class: 'pn-issue__detail', text: issue.detail }),
          issue.fix
            ? el(
                'div',
                { class: 'pn-issue__actions' },
                el('button', {
                  type: 'button',
                  class: 'pn-btn pn-btn--sm',
                  text: issue.fix.label,
                  onclick: () => {
                    if (issue.fix!.action.kind === 'select-page') {
                      store.selectPage(issue.fix!.action.pageIndex);
                      handle.close();
                      return;
                    }
                    store.update((draft) => applyFix(draft, issue.fix!.action, () => addPageDraft(draft)), {
                      label: `fix-${issue.id}`,
                    });
                    const next = runChecks({ project: store.project!, profile });
                    renderStep(handle, body, next, profile);
                    toast({ title: 'Fixed', detail: issue.title, kind: 'success' });
                  },
                }),
              )
            : null,
        ),
      ),
    );
  }

  return container;
}

function severityRank(issue: CheckIssue): number {
  return issue.severity === 'action' ? 2 : issue.severity === 'review' ? 1 : 0;
}

/** Add a blank page directly to a draft, for the checklist's one-click fix. */
function addPageDraft(draft: { pages: unknown[] }): void {
  void draft;
  addPage(true);
}

function summaryTable(rows: ([string, string] | null)[]): HTMLElement {
  const table = el('dl', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, auto) 1fr',
      gap: '0.5rem 1rem',
      margin: '0',
      fontSize: '0.875rem',
    },
  });
  for (const row of rows) {
    if (!row) continue;
    table.append(
      el('dt', { text: row[0], style: { color: 'var(--pn-text-muted)', margin: '0' } }),
      el('dd', { text: row[1], style: { margin: '0' } }),
    );
  }
  return table;
}

/**
 * The settings PrintNest cannot control. Being explicit here is the single
 * biggest thing that stops a first print coming out wrong.
 */
function dialogSettingsNote(paperName: string): HTMLElement {
  return el(
    'div',
    { class: 'pn-note pn-note--warn', style: { marginTop: '1rem' } },
    icon('alert', { size: 18, class: 'pn-note__icon' }),
    el(
      'div',
      {},
      el('strong', { text: 'Check these in your printer’s dialog' }),
      el(
        'ul',
        { style: { margin: '0.5rem 0 0 1.1rem', lineHeight: '1.65' } },
        el('li', { text: `Paper size: ${paperName}` }),
        el('li', { text: 'Scale: 100 % or “Default” — not “Fit to page”, which shrinks everything' }),
        el('li', { text: 'Margins: None' }),
        el('li', { text: 'Background graphics: on, if your pages use background colours' }),
        el('li', { text: 'Headers and footers: off' }),
      ),
      el('p', {
        style: { marginTop: '0.5rem', fontSize: '0.8125rem' },
        text: 'A web page cannot set these for you — they belong to your browser and operating system.',
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

async function sendToPrinter(handle: DialogHandle): Promise<void> {
  const project = store.project;
  if (!project) return;

  try {
    const job = await preparePrintJob({
      project,
      showGuides: project.settings.imposition.foldMarks,
      onFinished: () => {
        const canvas = document.getElementById('pn-canvas');
        if (canvas) animate(canvas, 'pn-anim-celebrate', 700);
        toast({
          title: 'Sent to your printer',
          detail: 'If the pages came out wrong, the calibration page under Help will find out why.',
          kind: 'success',
        });
      },
    });
    handle.close();
    job.print();
  } catch (error) {
    toastError(error, 'The print job could not be prepared.');
  }
}

/** Shown in the manual duplex assistant's opening step. */
export function duplexOverview(profile: PrinterProfile | null): HTMLElement {
  const project = store.project!;
  const result = imposeProject(project);
  const setup = defaultSetup(profile);
  const steps = buildSteps(setup, result.sheets.length);

  return el(
    'ol',
    { class: 'pn-help-steps' },
    ...steps.map((step) =>
      el(
        'li',
        { class: 'pn-help-step' },
        el(
          'div',
          {},
          el('div', { class: 'pn-help-step__title', text: step.title }),
          el('div', { class: 'pn-help-step__body', text: step.detail }),
        ),
      ),
    ),
  );
}
