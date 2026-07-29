import {
  applySetupToProfile,
  buildDuplexTestSheet,
  buildSteps,
  defaultSetup,
  describeSetup,
  flipEdgeLabel,
  interpretTest,
} from '../../core/duplex.ts';
import type { DuplexDiagram, DuplexSetup, TestAnswer } from '../../core/duplex.ts';
import { imposeProject } from '../../core/imposition.ts';
import { projectSheet } from '../../core/project.ts';
import { getProfile, loadProfiles, saveProfile } from '../../core/printerProfiles.ts';
import type { PrinterProfile } from '../../core/printerProfiles.ts';
import { store } from '../../core/store.ts';
import { preparePrintJob, printStandalone } from '../../render/printRoot.ts';
import { el, setChildren, svg } from '../dom.ts';
import { icon } from '../icons.ts';
import { toast, toastError } from '../toast.ts';
import { openDialog } from './dialog.ts';

/**
 * The manual duplex assistant.
 *
 * A wizard rather than a settings page, because the order matters: print one
 * side, pause, reload correctly, print the other. Getting the reload wrong is
 * what ruins the run, so the reload step gets an animated diagram of the exact
 * motion, and there is a one-sheet test that removes the guesswork entirely.
 */

type Stage = 'intro' | 'fronts' | 'reload' | 'backs' | 'done' | 'test' | 'test-answer';

export async function openDuplexAssistant(): Promise<void> {
  const project = store.project;
  if (!project) return;

  const profiles = await loadProfiles();
  let profile = getProfile(profiles, project.settings.printerProfileId);
  // Whether the paper is wider than it is tall decides what "flip on the long
  // edge" physically means, so every instruction below is derived from it.
  const paper = projectSheet(project);
  const sheetIsLandscape = paper.widthMm > paper.heightMm;
  let setup = defaultSetup(profile);
  let stage: Stage = 'intro';

  const body = el('div');
  const handle = openDialog({
    title: 'Manual duplex',
    subtitle: 'Printing both sides, one pass at a time',
    body,
    wide: true,
  });

  const render = (): void => {
    switch (stage) {
      case 'intro':
        renderIntro();
        break;
      case 'fronts':
        renderPass('fronts');
        break;
      case 'reload':
        renderReload();
        break;
      case 'backs':
        renderPass('backs');
        break;
      case 'done':
        renderDone();
        break;
      case 'test':
        renderTest();
        break;
      case 'test-answer':
        renderTestAnswer();
        break;
    }
  };

  function renderIntro(): void {
    const result = imposeProject(project!);
    const sheets = result.sheets.filter((sheet) => sheet.side !== 'back').length;

    handle.setTitle('Manual duplex', 'Printing both sides, one pass at a time');
    setChildren(
      body,
      el('p', {
        style: { lineHeight: '1.6' },
        text: `This project needs ${sheets} sheet${sheets === 1 ? '' : 's'} of paper printed on both sides. PrintNest will send the front sides first, wait while you turn the stack over, then send the backs in the right order.`,
      }),
      profile
        ? el(
            'div',
            { class: 'pn-note pn-note--info', style: { marginTop: '1rem' } },
            icon('info', { size: 18, class: 'pn-note__icon' }),
            el(
              'div',
              {},
              el('strong', { text: `${profile.brand} ${profile.model}` }),
              el('div', {
                style: { marginTop: '2px', fontSize: '0.8125rem' },
                text:
                  profile.duplexFlip === 'unknown'
                    ? 'PrintNest does not know how this printer flips paper yet. The one-sheet test below takes a minute and saves the guesswork every time after this.'
                    : `Remembered from last time: ${describeSetup(setup)}.`,
              }),
            ),
          )
        : el(
            'div',
            { class: 'pn-note', style: { marginTop: '1rem' } },
            icon('info', { size: 18, class: 'pn-note__icon' }),
            el('div', {
              text: 'No printer profile is selected, so PrintNest is using the most common settings. Pick a profile in Settings to have your answers remembered.',
            }),
          ),
      el('h3', { text: 'The steps', style: { margin: '1.5rem 0 0.75rem' } }),
      stepList(setup, imposeProject(project!).sheets.length),
    );

    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn',
        text: 'Run the one-sheet test first',
        onclick: () => {
          stage = 'test';
          render();
        },
      }),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn pn-btn--print',
          onclick: () => {
            stage = 'fronts';
            render();
          },
        },
        icon('print', { size: 18 }),
        'Print the front sides',
      ),
    ]);
  }

  function renderPass(pass: 'fronts' | 'backs'): void {
    handle.setTitle(
      pass === 'fronts' ? 'Pass 1 of 2 — front sides' : 'Pass 2 of 2 — back sides',
      pass === 'fronts' ? 'Send the odd sides to the printer' : 'Send the even sides to the printer',
    );

    body.replaceChildren(
      el(
        'div',
        { class: 'pn-duplex' },
        diagram(pass === 'fronts' ? 'print-fronts' : 'print-backs'),
        el(
          'div',
          {},
          el('p', {
            style: { lineHeight: '1.6' },
            text:
              pass === 'fronts'
                ? 'The print dialog will open now. Check the paper size and set the scale to 100 %, then print. Come back here once the pages are out.'
                : `The print dialog will open with the back sides${setup.reverseSecondPass ? ', already reversed to match your reloaded stack' : ''}. Use the same settings as the first pass.`,
          }),
          el(
            'div',
            { class: 'pn-note pn-note--warn', style: { marginTop: '1rem' } },
            icon('alert', { size: 18, class: 'pn-note__icon' }),
            el('div', {
              text: 'Do not tick “two-sided” or “duplex” in the print dialog — PrintNest is handling both sides itself, and the driver would flip them again.',
            }),
          ),
        ),
      ),
    );

    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn',
        text: 'Back',
        onclick: () => {
          stage = pass === 'fronts' ? 'intro' : 'reload';
          render();
        },
      }),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn pn-btn--print',
          onclick: () => void send(pass),
        },
        icon('print', { size: 18 }),
        'Open the print dialog',
      ),
    ]);
  }

  async function send(pass: 'fronts' | 'backs'): Promise<void> {
    try {
      const job = await preparePrintJob({
        project: project!,
        pass,
        reverseBacks: setup.reverseSecondPass,
        showGuides: project!.settings.imposition.foldMarks,
        onFinished: () => {
          stage = pass === 'fronts' ? 'reload' : 'done';
          render();
        },
      });
      job.print();
    } catch (error) {
      toastError(error, 'The print job could not be prepared.');
    }
  }

  function renderReload(): void {
    handle.setTitle('Turn the stack over', 'The step that decides whether this works');

    const motion = setup.flipMotion;

    // The choice is offered as a motion, not as driver jargon: "long edge"
    // means opposite things on portrait and landscape paper, and the user is
    // holding the paper, not reading the driver manual.
    const options: { label: string; note: string; apply: () => void; active: boolean }[] = [
      {
        label: 'Turn it left to right',
        note: 'Like turning a page in a book. The top edge stays at the top.',
        apply: () => {
          setup = { ...setup, flipMotion: 'left-right', feedEdge: 'top-first' };
        },
        active: motion === 'left-right',
      },
      {
        label: 'Turn it top to bottom',
        note: 'Like flipping a calendar. The top edge ends up at the bottom.',
        apply: () => {
          setup = { ...setup, flipMotion: 'top-bottom', feedEdge: 'bottom-first' };
        },
        active: motion === 'top-bottom',
      },
    ];

    body.replaceChildren(
      el(
        'div',
        { class: 'pn-duplex' },
        diagram(motion === 'left-right' ? 'flip-long-edge' : 'flip-short-edge'),
        el(
          'div',
          {},
          el('h3', { text: 'How to turn the stack', style: { marginBottom: '0.5rem' } }),
          el('p', {
            class: 'pn-field__hint',
            style: { marginBottom: '0.5rem' },
            text: `Your paper is ${sheetIsLandscape ? 'landscape' : 'portrait'}, so this is what a printer driver would call a ${flipEdgeLabel(motion, sheetIsLandscape)}-edge flip.`,
          }),
          el(
            'div',
            { class: 'pn-segment', role: 'radiogroup', 'aria-label': 'Flip direction' },
            ...options.map((option) =>
              el('button', {
                type: 'button',
                class: 'pn-segment__option',
                role: 'radio',
                'aria-checked': String(option.active),
                text: option.label,
                onclick: () => {
                  option.apply();
                  render();
                },
              }),
            ),
          ),
          el('p', {
            class: 'pn-field__hint',
            style: { marginTop: '0.5rem' },
            text: options.find((option) => option.active)?.note ?? '',
          }),
        ),
      ),

      el(
        'div',
        { class: 'pn-duplex', style: { marginTop: '1.5rem' } },
        diagram(setup.reloadFace === 'up' ? 'face-up' : 'face-down'),
        el(
          'div',
          {},
          el('h3', { text: 'Which way up', style: { marginBottom: '0.5rem' } }),
          el(
            'div',
            { class: 'pn-segment', role: 'radiogroup', 'aria-label': 'Reload direction' },
            el('button', {
              type: 'button',
              class: 'pn-segment__option',
              role: 'radio',
              'aria-checked': String(setup.reloadFace === 'down'),
              text: 'Printed side down',
              onclick: () => {
                setup = { ...setup, reloadFace: 'down' };
                render();
              },
            }),
            el('button', {
              type: 'button',
              class: 'pn-segment__option',
              role: 'radio',
              'aria-checked': String(setup.reloadFace === 'up'),
              text: 'Printed side up',
              onclick: () => {
                setup = { ...setup, reloadFace: 'up' };
                render();
              },
            }),
          ),
          el('p', {
            class: 'pn-field__hint',
            style: { marginTop: '0.5rem' },
            text: 'Most front-loading home printers want the printed side down. Rear-feed printers usually want it up.',
          }),
        ),
      ),

      el(
        'div',
        { class: 'pn-duplex', style: { marginTop: '1.5rem' } },
        diagram(setup.feedEdge === 'top-first' ? 'top-edge-first' : 'bottom-edge-first'),
        el(
          'div',
          {},
          el('h3', { text: 'Which edge goes in first', style: { marginBottom: '0.5rem' } }),
          el(
            'div',
            { class: 'pn-segment', role: 'radiogroup', 'aria-label': 'Feed edge' },
            el('button', {
              type: 'button',
              class: 'pn-segment__option',
              role: 'radio',
              'aria-checked': String(setup.feedEdge === 'top-first'),
              text: 'Top edge first',
              onclick: () => {
                setup = { ...setup, feedEdge: 'top-first' };
                render();
              },
            }),
            el('button', {
              type: 'button',
              class: 'pn-segment__option',
              role: 'radio',
              'aria-checked': String(setup.feedEdge === 'bottom-first'),
              text: 'Bottom edge first',
              onclick: () => {
                setup = { ...setup, feedEdge: 'bottom-first' };
                render();
              },
            }),
          ),
        ),
      ),

      el(
        'div',
        { class: 'pn-note pn-note--info', style: { marginTop: '1.5rem' } },
        icon('info', { size: 18, class: 'pn-note__icon' }),
        el('div', { text: `Summary: ${describeSetup(setup)}.` }),
      ),
    );

    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn',
        text: 'Not sure — run the test',
        onclick: () => {
          stage = 'test';
          render();
        },
      }),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn pn-btn--print',
          onclick: () => {
            stage = 'backs';
            render();
          },
        },
        'Paper reloaded — print the backs',
      ),
    ]);
  }

  function renderDone(): void {
    const result = imposeProject(project!);
    handle.setTitle('Both sides printed', 'What to do with the stack');

    setChildren(
      body,
      el(
        'div',
        { class: 'pn-note pn-note--success' },
        icon('check', { size: 20, class: 'pn-note__icon' }),
        el('div', { text: 'That is both passes done. Give the ink a minute before folding.' }),
      ),
      result.instructions.length > 0
        ? el(
            'ol',
            { class: 'pn-help-steps', style: { marginTop: '1.5rem' } },
            ...result.instructions.map((instruction) =>
              el(
                'li',
                { class: 'pn-help-step' },
                el('div', { class: 'pn-help-step__body', text: instruction }),
              ),
            ),
          )
        : null,
      profile
        ? el(
            'div',
            { style: { marginTop: '1.5rem' } },
            el(
              'button',
              {
                type: 'button',
                class: 'pn-btn',
                onclick: () => void remember(),
              },
              'Remember these settings for this printer',
            ),
          )
        : null,
    );

    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Done',
        onclick: () => handle.close(),
      }),
    ]);
  }

  /* ---- The one-sheet test ---------------------------------------- */

  function renderTest(): void {
    handle.setTitle('One-sheet duplex test', 'Find out exactly how your printer flips paper');

    body.replaceChildren(
      el(
        'ol',
        { class: 'pn-help-steps' },
        step('Print the test sheet', 'One sheet with a big FRONT · TOP mark. Use plain paper.'),
        step('Take it out and turn it over', `Use the turn you were going to use: ${describeSetup(setup)}.`),
        step('Print the second side', 'PrintNest sends a BACK · TOP mark.'),
        step('Compare the two sides', 'Look at where the word TOP sits on each side, then answer the question.'),
      ),
      el(
        'div',
        { style: { display: 'flex', gap: '0.5rem', marginTop: '1.5rem', flexWrap: 'wrap' } },
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--print',
            onclick: () => void printTestSide('front'),
          },
          icon('print', { size: 16 }),
          'Print side one',
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn',
            onclick: () => void printTestSide('back'),
          },
          icon('print', { size: 16 }),
          'Print side two',
        ),
      ),
    );

    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn',
        text: 'Back',
        onclick: () => {
          stage = 'intro';
          render();
        },
      }),
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'I have both sides printed',
        onclick: () => {
          stage = 'test-answer';
          render();
        },
      }),
    ]);
  }

  async function printTestSide(side: 'front' | 'back'): Promise<void> {
    const sheet = projectSheet(project!);
    try {
      await printStandalone(() => [buildDuplexTestSheet(side, sheet)], sheet);
    } catch (error) {
      toastError(error, 'The test sheet could not be printed.');
    }
  }

  function renderTestAnswer(): void {
    handle.setTitle('What did the second side look like?', 'Hold the sheet the same way up as the first side');

    const answers: { value: TestAnswer; label: string; note: string }[] = [
      {
        value: 'same-way-up',
        label: 'BACK · TOP is at the top, same as the front',
        note: 'The flip was right.',
      },
      {
        value: 'upside-down',
        label: 'BACK · TOP is at the bottom — the back is upside down',
        note: 'The flip edge was wrong.',
      },
      {
        value: 'other-side',
        label: 'The second print landed on the blank side, not the back',
        note: 'The stack went in the wrong way up.',
      },
      { value: 'not-sure', label: 'I am not sure', note: 'Print the test again and look closely.' },
    ];

    body.replaceChildren(
      el(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        ...answers.map((answer) =>
          el(
            'button',
            {
              type: 'button',
              class: 'pn-card pn-card--raised',
              style: { textAlign: 'left', cursor: 'pointer' },
              onclick: () => {
                const outcome = interpretTest(answer.value, setup);
                setup = { ...setup, ...outcome.setup };
                toast({
                  title: outcome.confident ? 'Settings updated' : 'No change made',
                  detail: outcome.summary,
                  kind: outcome.confident ? 'success' : 'info',
                });
                if (outcome.confident) void remember();
                stage = 'reload';
                render();
              },
            },
            el('strong', { text: answer.label }),
            el('div', {
              style: { marginTop: '4px', fontSize: '0.8125rem', color: 'var(--pn-text-muted)' },
              text: answer.note,
            }),
          ),
        ),
      ),
    );

    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn',
        text: 'Back',
        onclick: () => {
          stage = 'test';
          render();
        },
      }),
    ]);
  }

  async function remember(): Promise<void> {
    if (!profile) {
      toast({
        title: 'No printer profile selected',
        detail: 'Choose one in Settings and PrintNest can remember this for next time.',
        kind: 'info',
      });
      return;
    }
    try {
      const updated = applySetupToProfile(profile, setup);
      await saveProfile(updated);
      profile = updated;
      // Keep the document's own flip setting in step with the profile.
      store.update((draft) => void (draft.settings.imposition.flipMotion = setup.flipMotion), {
        label: 'flip-motion',
      });
      toast({ title: `Saved for ${updated.brand} ${updated.model}`, kind: 'success' });
    } catch (error) {
      toastError(error, 'The printer profile could not be saved.');
    }
  }

  render();
}

/* ------------------------------------------------------------------ *
 * Diagrams
 * ------------------------------------------------------------------ */

function step(title: string, detail: string): HTMLElement {
  return el(
    'li',
    { class: 'pn-help-step' },
    el(
      'div',
      {},
      el('div', { class: 'pn-help-step__title', text: title }),
      el('div', { class: 'pn-help-step__body', text: detail }),
    ),
  );
}

function stepList(setup: DuplexSetup, sheetCount: number): HTMLElement {
  return el(
    'ol',
    { class: 'pn-help-steps' },
    ...buildSteps(setup, sheetCount).map((entry) => step(entry.title, entry.detail)),
  );
}

const DIAGRAM_LABELS: Record<DuplexDiagram, string> = {
  'print-fronts': 'A sheet emerging from the printer, printed side showing.',
  'collect-stack': 'A stack of printed sheets lifted from the output tray.',
  'flip-long-edge': 'A sheet turning over left to right, like a book page.',
  'flip-short-edge': 'A sheet turning over top to bottom, like a calendar.',
  'rotate-180': 'A sheet spinning a half turn on the table.',
  'no-rotate': 'A sheet staying the same way round.',
  'face-up': 'A sheet going into the tray with the printed side upwards.',
  'face-down': 'A sheet going into the tray with the printed side downwards.',
  'top-edge-first': 'A sheet entering the printer top edge first.',
  'bottom-edge-first': 'A sheet entering the printer bottom edge first.',
  'print-backs': 'A sheet emerging with its second side printed.',
  done: 'A finished, folded booklet.',
};

/**
 * A small animated illustration of one motion.
 *
 * The animation is CSS-driven and removed entirely under
 * `prefers-reduced-motion`; the arrow and the label carry the same information
 * statically, so the diagram is never the only explanation.
 */
export function diagram(kind: DuplexDiagram): HTMLElement {
  const wrapper = el('div', { class: `pn-diagram pn-diagram--${kind}` });

  const node = svg('svg', {
    viewBox: '0 0 160 120',
    width: '100%',
    height: '100%',
    fill: 'none',
    role: 'img',
  });
  const title = svg('title');
  title.textContent = DIAGRAM_LABELS[kind];
  node.append(title);

  // The printer.
  node.append(
    svg('rect', {
      x: '26',
      y: '68',
      width: '108',
      height: '38',
      rx: '5',
      fill: 'var(--pn-surface-raised)',
      stroke: 'var(--pn-border-strong)',
      'stroke-width': '2',
    }),
    svg('rect', { x: '52', y: '64', width: '56', height: '5', rx: '2', fill: 'var(--pn-border-strong)' }),
  );

  // The sheet — this is what animates.
  const paper = svg('g', { class: 'pn-diagram__paper' });
  paper.append(
    svg('rect', {
      x: '58',
      y: '16',
      width: '44',
      height: '52',
      rx: '2',
      fill: '#ffffff',
      stroke: 'var(--pn-ink)',
      'stroke-width': '1.6',
    }),
    svg('rect', { x: '58', y: '16', width: '44', height: '10', fill: 'var(--pn-blue)' }),
    svg('path', {
      d: 'M66 36h28M66 44h28M66 52h18',
      stroke: 'var(--pn-border-strong)',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
    }),
  );
  node.append(paper);

  // A directional arrow, so the motion reads even when frozen.
  const arrow = arrowFor(kind);
  if (arrow) node.append(arrow);

  wrapper.append(node);
  return wrapper;
}

function arrowFor(kind: DuplexDiagram): SVGElement | null {
  const stroke = 'var(--pn-orange)';
  switch (kind) {
    case 'flip-long-edge':
      return svg(
        'g',
        {},
        svg('path', {
          d: 'M112 42a26 14 0 0 1-64 0',
          stroke,
          'stroke-width': '2.4',
          fill: 'none',
          'stroke-dasharray': '4 3',
        }),
        svg('path', { d: 'M48 42l-5-5M48 42l5-5', stroke, 'stroke-width': '2.4', 'stroke-linecap': 'round' }),
      );
    case 'flip-short-edge':
      return svg(
        'g',
        {},
        svg('path', {
          d: 'M118 20a14 26 0 0 1 0 48',
          stroke,
          'stroke-width': '2.4',
          fill: 'none',
          'stroke-dasharray': '4 3',
        }),
        svg('path', { d: 'M118 68l-5-5M118 68l5-5', stroke, 'stroke-width': '2.4', 'stroke-linecap': 'round' }),
      );
    case 'rotate-180':
      return svg('path', {
        d: 'M118 30a30 30 0 1 1-10-12',
        stroke,
        'stroke-width': '2.4',
        fill: 'none',
        'stroke-dasharray': '4 3',
      });
    case 'top-edge-first':
    case 'face-down':
    case 'face-up':
      return svg('path', {
        d: 'M136 30v28M136 58l-5-6M136 58l5-6',
        stroke,
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        fill: 'none',
      });
    case 'bottom-edge-first':
      return svg('path', {
        d: 'M136 58V30M136 30l-5 6M136 30l5 6',
        stroke,
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        fill: 'none',
      });
    case 'print-fronts':
    case 'print-backs':
      return svg('path', {
        d: 'M20 44v-20M20 24l-5 6M20 24l5 6',
        stroke,
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        fill: 'none',
      });
    default:
      return null;
  }
}

/** Exported for the help section, which shows the same diagrams. */
export function duplexDiagramGallery(): HTMLElement {
  const kinds: DuplexDiagram[] = [
    'flip-long-edge',
    'flip-short-edge',
    'rotate-180',
    'no-rotate',
    'face-up',
    'face-down',
    'top-edge-first',
    'bottom-edge-first',
  ];
  return el(
    'div',
    { class: 'pn-help-grid' },
    ...kinds.map((kind) =>
      el(
        'div',
        { class: 'pn-help-card' },
        diagram(kind),
        el('div', { class: 'pn-help-card__title', text: DIAGRAM_LABELS[kind] }),
      ),
    ),
  );
}

/** Used by the profile panel to show what PrintNest currently believes. */
export function currentSetupFor(profile: PrinterProfile | null): DuplexSetup {
  return defaultSetup(profile);
}
