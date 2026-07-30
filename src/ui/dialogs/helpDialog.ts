import { el, setChildren, svg } from '../dom.ts';
import { icon } from '../icons.ts';
import { openDialog } from './dialog.ts';
import { duplexDiagramGallery } from './duplexDialog.ts';

/**
 * The help section.
 *
 * Short, illustrated guides rather than prose. Each one answers a single
 * question someone actually asks while standing at a printer, and every guide
 * has a diagram, because "flip on the long edge" is far clearer drawn than
 * described.
 *
 * All content is bundled with the application, so help works offline.
 */

export interface Guide {
  id: string;
  title: string;
  blurb: string;
  art: () => SVGElement;
  steps: { title: string; body: string }[];
  notes?: string[];
}

const paperOutline = (extra?: SVGElement[]): SVGElement =>
  svg(
    'svg',
    {
      viewBox: '0 0 200 120',
      class: 'pn-help-card__art',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    svg('rect', { x: '52', y: '14', width: '96', height: '92', rx: '3' }),
    ...(extra ?? []),
  );

export const GUIDES: Guide[] = [
  {
    id: 'mini-zine',
    title: 'How to print a mini zine',
    blurb: 'Eight pages from one sheet of A4, three folds and one cut.',
    art: () =>
      paperOutline([
        svg('path', { d: 'M100 14v92', 'stroke-dasharray': '5 4' }),
        svg('path', { d: 'M52 60h96', 'stroke-dasharray': '5 4' }),
        svg('path', { d: 'M76 60h48', stroke: '#C94A4A', 'stroke-width': '3' }),
      ]),
    steps: [
      { title: 'Choose Zine Maker', body: 'Pick the eight-page mini zine. PrintNest sets A4 landscape and the quarter-page size for you.' },
      { title: 'Add your pages', body: 'Page 1 is the cover and page 8 is the back. Drop pictures in and type over the placeholder text.' },
      { title: 'Print one side only', body: 'A mini zine uses just one side of the sheet. Leave duplex off.' },
      { title: 'Fold in half, three times', body: 'Short way first, then long way, then long way again. Crease each fold firmly.' },
      { title: 'Cut the centre slit', body: 'Open the sheet flat. Cut only the middle section along the centre line — the red line on the printed guide.' },
      { title: 'Push and fold', body: 'Fold the long way again, push the two ends towards each other so the slit opens into a diamond, then flatten the pages around.' },
    ],
    notes: ['Check the Print sheets view before printing — page 1 should sit at the bottom right, upside-down pages along the top.'],
  },
  {
    id: 'booklet',
    title: 'How to print a booklet',
    blurb: 'A5 pages from A4 paper, folded and stapled down the middle.',
    art: () =>
      paperOutline([
        svg('path', { d: 'M100 14v92', 'stroke-dasharray': '5 4' }),
        svg('circle', { cx: '100', cy: '44', r: '2.5', fill: 'currentColor' }),
        svg('circle', { cx: '100', cy: '76', r: '2.5', fill: 'currentColor' }),
      ]),
    steps: [
      { title: 'Use Booklet Maker', body: 'Paper is A4 landscape; each page is half of it. Two pages print on each side.' },
      { title: 'Keep the page count in fours', body: 'A folded sheet always holds four pages. PrintNest adds blanks if you are short, and the checklist offers to do it for you.' },
      { title: 'Set a binding margin', body: '5–8 mm of extra space at the spine stops text disappearing into the fold.' },
      { title: 'Print with manual duplex', body: 'PrintNest prints the fronts, waits, then prints the backs in the right order.' },
      { title: 'Fold the whole stack at once', body: 'Do not fold sheet by sheet — stack them in printed order first, then fold the lot together.' },
      { title: 'Staple on the fold', body: 'Two staples, about a third in from each end. A long-arm stapler helps but is not essential — staple flat, then fold.' },
    ],
  },
  {
    id: 'manual-duplex',
    title: 'How to use manual duplex',
    blurb: 'Printing both sides when your printer cannot turn the paper itself.',
    art: () =>
      paperOutline([
        svg('path', { d: 'M30 60a22 46 0 0 1 22-46', 'stroke-dasharray': '4 4' }),
        svg('path', { d: 'M52 14l-6 3M52 14l1 6' }),
      ]),
    steps: [
      { title: 'Let PrintNest drive', body: 'Choose manual duplex in the layout settings and use the assistant. Do not tick two-sided in the printer driver as well — it would flip the pages twice.' },
      { title: 'Print the fronts', body: 'Wait until every sheet is out and the ink is dry before touching the stack.' },
      { title: 'Do not shuffle the stack', body: 'Lift it out in one piece. The order is what makes the second pass land correctly.' },
      { title: 'Flip the way the diagram shows', body: 'Long edge is like turning a page; short edge is like flipping a calendar.' },
      { title: 'Reload and print the backs', body: 'PrintNest reverses the second pass automatically if your printer stacks pages face up.' },
    ],
    notes: [
      'If you are unsure, run the one-sheet test. It takes a minute and PrintNest remembers the answer for that printer.',
    ],
  },
  {
    id: 'reload-paper',
    title: 'How to reload paper',
    blurb: 'The four things that can vary, and how to work out yours.',
    art: () =>
      paperOutline([
        svg('path', { d: 'M100 106V30M100 30l-8 9M100 30l8 9' }),
      ]),
    steps: [
      { title: 'Which way up', body: 'Front-loading trays usually want the printed side down. Rear feeds usually want it up.' },
      { title: 'Which edge first', body: 'Normally the top edge of the page goes in first — the same edge that came out last.' },
      { title: 'Whether to rotate', body: 'Only needed when the flip edge and the feed direction disagree. The assistant works this out for you.' },
      { title: 'Test with one sheet', body: 'Mark an arrow on a sheet with a pencil, print anything on it, and watch where the arrow ends up.' },
    ],
  },
  {
    id: 'borderless',
    title: 'How to print borderless',
    blurb: 'Edge-to-edge colour, and what to do when your printer will not.',
    art: () => paperOutline([svg('rect', { x: '52', y: '14', width: '96', height: '92', fill: 'currentColor', opacity: '0.15', stroke: 'none' })]),
    steps: [
      { title: 'Check your printer supports it', body: 'Many home printers, including the Brother DCP-T420W, have no borderless mode at all. The printer profile tells you.' },
      { title: 'Turn it on in the driver', body: 'Borderless is a printer setting, not a web page setting. PrintNest cannot switch it on for you.' },
      { title: 'Add bleed', body: 'Set 3 mm of bleed so full-page images run past the trim line, and let images overhang the page edge.' },
      { title: 'Or print oversized and trim', body: 'Put an A5 page on A4 paper, turn on crop marks, and cut. This works on every printer and gives a cleaner edge than most borderless modes.' },
    ],
  },
  {
    id: 'choose-paper',
    title: 'How to choose paper',
    blurb: 'What to use for zines, photographs and everyday prints.',
    art: () =>
      paperOutline([
        svg('rect', { x: '40', y: '26', width: '96', height: '92', rx: '3', opacity: '0.5' }),
        svg('rect', { x: '28', y: '38', width: '96', height: '92', rx: '3', opacity: '0.25' }),
      ]),
    steps: [
      { title: 'Everyday and zines', body: '80–100 gsm plain paper. Cheap, folds well, and takes a crease without cracking.' },
      { title: 'Booklet covers', body: '120–160 gsm. Heavier than that and the fold will crack unless you score it first.' },
      { title: 'Photographs', body: 'Glossy or lustre photo paper, and set the paper type in the driver — it changes how much ink is laid down.' },
      { title: 'Artwork', body: 'Matte or fine-art inkjet paper at 200 gsm or more. Check your printer takes that thickness through the tray you plan to use.' },
    ],
    notes: ['Thick paper usually needs the rear feed. Feeding card through a front tray is the most common cause of jams.'],
  },
  {
    id: 'avoid-low-quality',
    title: 'How to avoid low-quality prints',
    blurb: 'Why a picture that looks fine on screen prints soft.',
    art: () =>
      paperOutline([
        svg('rect', { x: '66', y: '32', width: '68', height: '46', rx: '2' }),
        svg('path', { d: 'M66 78l18-18 12 12 10-10 28 24' }),
      ]),
    steps: [
      { title: 'Watch the resolution badge', body: 'Select any picture and PrintNest shows its effective dots per inch at the printed size.' },
      { title: 'Aim for 300, accept 150', body: '300 dpi is photographic. 200 looks clean. Below 150 you will see pixels.' },
      { title: 'Screenshots are low resolution', body: 'A screenshot is typically 72–96 dpi, so it prints well only at about a third of its screen size.' },
      { title: 'Cropping costs pixels', body: 'Cropping to a quarter of the frame quarters the resolution. The badge accounts for this.' },
      { title: 'Print smaller rather than upscaling', body: 'Enlarging a small file cannot invent detail. A smaller print will always look sharper.' },
    ],
  },
  {
    id: 'reduce-ink',
    title: 'How to reduce ink use',
    blurb: 'Making a run of zines affordable.',
    art: () => paperOutline([svg('path', { d: 'M100 34s16 20 16 31a16 16 0 0 1-32 0c0-11 16-31 16-31z' })]),
    steps: [
      { title: 'Turn on ink-saving mode', body: 'Greyscale, lighter images and no background fills. The estimate updates as you change things.' },
      { title: 'Drop background colours', body: 'A full-page tint is by far the most expensive thing you can print.' },
      { title: 'Use draft quality for proofs', body: 'Set it in the print dialog. Save the good setting for the final copy.' },
      { title: 'Leave white space', body: 'It costs nothing, and it usually looks better.' },
    ],
    notes: [
      'PrintNest reports ink use as low, medium or high. It cannot measure real consumption — that depends on your driver, paper and cartridge.',
    ],
  },
  {
    id: 'photographs',
    title: 'How to print photographs',
    blurb: 'True-to-size photographic prints at home.',
    art: () =>
      paperOutline([
        svg('rect', { x: '66', y: '28', width: '68', height: '50', rx: '2' }),
        svg('circle', { cx: '86', cy: '44', r: '5' }),
        svg('path', { d: 'M66 78l20-20 14 14 12-10 22 16' }),
        svg('path', { d: 'M66 90h68', 'stroke-dasharray': '4 4' }),
      ]),
    steps: [
      { title: 'Choose Photo Print', body: 'Pick the finished size — 4×6, 5×7, 8×10 and the rest are in the paper list.' },
      { title: 'Keep the aspect ratio', body: 'PrintNest preserves proportions by default. Use Fill only when you are happy to crop.' },
      { title: 'Set the paper type in the driver', body: 'This matters more than the quality setting. Glossy paper on a plain-paper setting will look flat and smudge.' },
      { title: 'Print at 100 %', body: 'Turn off "fit to page", or the print will come out a few per cent small.' },
      { title: 'Let it dry', body: 'Inkjet photo prints stay tacky for a few minutes. Stacking them too early leaves marks.' },
    ],
  },
  {
    id: 'poster',
    title: 'How to tile a poster',
    blurb: 'One big image across several sheets.',
    art: () =>
      svg(
        'svg',
        {
          viewBox: '0 0 200 120',
          class: 'pn-help-card__art',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
          'aria-hidden': 'true',
        },
        svg('rect', { x: '54', y: '16', width: '44', height: '40' }),
        svg('rect', { x: '102', y: '16', width: '44', height: '40' }),
        svg('rect', { x: '54', y: '60', width: '44', height: '40' }),
        svg('rect', { x: '102', y: '60', width: '44', height: '40' }),
      ),
    steps: [
      { title: 'Choose Poster Printer and add one image', body: 'Tiling works from a single picture rather than a page layout.' },
      { title: 'Pick a grid or a finished size', body: 'Either choose "4 sheets — 2 × 2", or type the size you want and let PrintNest work out the sheets.' },
      { title: 'Set an overlap', body: '10 mm is a good default. It gives you room to line the sheets up rather than needing a perfect butt joint.' },
      { title: 'Print every sheet, then lay them out', body: 'Each sheet carries a grid code. Print the assembly map and follow it before sticking anything down.' },
      { title: 'Trim, overlap, tape from behind', body: 'Cut the top and left edge of each sheet to its guide line and lay it over its neighbour’s overlap band.' },
    ],
  },
  {
    id: 'fold-and-bind',
    title: 'How to fold and bind a zine',
    blurb: 'Crisp folds and a spine that holds.',
    art: () =>
      paperOutline([
        svg('path', { d: 'M100 14v92', 'stroke-dasharray': '5 4' }),
        svg('path', { d: 'M148 60c-16 10-32 12-48 12', 'stroke-dasharray': '3 4' }),
      ]),
    steps: [
      { title: 'Score before you fold thick paper', body: 'Run an empty ballpoint along a ruler on the fold line. Card folded without scoring cracks along the crease.' },
      { title: 'Fold with a bone folder or a ruler', body: 'Anything smooth and flat. Press from the middle out to each end.' },
      { title: 'Stack, then fold', body: 'For a booklet, nest the sheets in printed order and fold the whole stack in one go.' },
      { title: 'Staple along the fold', body: 'Two staples, a third in from each end. Open the stapler flat and staple from the outside onto a soft surface such as a mouse mat.' },
      { title: 'Trim the outer edge', body: 'The inner pages stick out slightly on a thick booklet. Trim the fore edge with a guillotine or a sharp knife and a steel rule.' },
    ],
  },
  {
    id: 'calibrate',
    title: 'How to calibrate printer margins',
    blurb: 'Find out what your printer really does with the page.',
    art: () =>
      paperOutline([
        svg('path', { d: 'M62 30h76M62 26v8M138 26v8' }),
        svg('path', { d: 'M62 50h76', 'stroke-dasharray': '3 3' }),
      ]),
    steps: [
      { title: 'Print the calibration page', body: 'Find it in Printer setup. Use plain paper and print at 100 %.' },
      { title: 'Measure the 100 mm line', body: 'With a ruler, between the two end marks. Type what you measured back into PrintNest.' },
      { title: 'Apply the correction', body: 'If the line is short, your printer is scaling the page. PrintNest compensates from then on.' },
      { title: 'Read the edge rulers', body: 'The rulers along the top and left show exactly where printing starts. Put those numbers into the printer profile as minimum margins.' },
      { title: 'Check the borderless band', body: 'If the coloured band does not reach the paper edge, borderless is not on — or not available.' },
    ],
    notes: [
      'A correction larger than about 3 % almost always means "fit to page" is still enabled. Turn it off and print the test again before applying it.',
    ],
  },
];

export function openHelpDialog(guideId?: string): void {
  const body = el('div');
  const handle = openDialog({
    title: 'Help',
    subtitle: 'Short guides for getting good prints at home',
    body,
    wide: true,
  });

  const showIndex = (): void => {
    handle.setTitle('Help', 'Short guides for getting good prints at home');
    setChildren(
      body,
      el(
        'div',
        { class: 'pn-help-grid' },
        ...GUIDES.map((guide) =>
          el(
            'button',
            {
              type: 'button',
              class: 'pn-help-card',
              onclick: () => showGuide(guide),
            },
            guide.art(),
            el('span', { class: 'pn-help-card__title', text: guide.title }),
            el('span', { class: 'pn-help-card__blurb', text: guide.blurb }),
          ),
        ),
      ),
      el('h3', { text: 'Paper-flip diagrams', style: { margin: '2rem 0 0.75rem' } }),
      el('p', {
        class: 'pn-field__hint',
        style: { marginBottom: '1rem' },
        text: 'The motions the manual duplex assistant refers to.',
      }),
      duplexDiagramGallery(),
    );
    handle.setFooter([
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Close',
        onclick: () => handle.close(),
      }),
    ]);
  };

  const showGuide = (guide: Guide): void => {
    handle.setTitle(guide.title, guide.blurb);
    setChildren(
      body,
      el('div', { style: { maxWidth: '160px', marginBottom: '1.5rem' } }, guide.art()),
      el(
        'ol',
        { class: 'pn-help-steps' },
        ...guide.steps.map((step) =>
          el(
            'li',
            { class: 'pn-help-step' },
            el(
              'div',
              {},
              el('div', { class: 'pn-help-step__title', text: step.title }),
              el('div', { class: 'pn-help-step__body', text: step.body }),
            ),
          ),
        ),
      ),
      ...(guide.notes ?? []).map((note) =>
        el(
          'div',
          { class: 'pn-note pn-note--info', style: { marginTop: '1.5rem' } },
          icon('info', { size: 18, class: 'pn-note__icon' }),
          el('div', { text: note }),
        ),
      ),
    );
    handle.setFooter([
      el('button', { type: 'button', class: 'pn-btn', text: 'All guides', onclick: showIndex }),
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Close',
        onclick: () => handle.close(),
      }),
    ]);
  };

  const requested = guideId ? GUIDES.find((guide) => guide.id === guideId) : undefined;
  if (requested) showGuide(requested);
  else showIndex();
}

/** The privacy statement, shown from the footer. */
export function openPrivacyDialog(): void {
  const handle = openDialog({
    title: 'Privacy',
    subtitle: 'What PrintNest does with your work: nothing but show it to you',
    body: el(
      'div',
      { style: { lineHeight: '1.7' } },
      paragraph(
        'Every image, PDF and piece of text you bring into PrintNest is read by your own browser and stays on your own device. There is no upload, no account, and no server that could receive your files even if it wanted to.',
      ),
      heading('Where your projects live'),
      paragraph(
        'Projects are saved in your browser’s local database (IndexedDB), which belongs to this site on this device only. Clearing your browser’s site data will delete them, so export a .printnest file for anything you want to keep.',
      ),
      heading('Printing'),
      paragraph(
        'When you print, PrintNest builds the pages and hands them to your browser, which passes them to your operating system’s printing service — the same route every other application uses. That is how AirPrint, Mopria, Wi-Fi, USB and network printers all work. PrintNest never talks to your printer directly and never learns which printer you chose.',
      ),
      heading('Analytics'),
      paragraph(
        'There are none. No trackers, no telemetry, no third-party scripts. Nothing about your files, their names, your printer or your projects is measured or transmitted.',
      ),
      heading('The network'),
      paragraph(
        'The application itself is downloaded once from the web and then cached for offline use. After that, PrintNest makes no network requests at all — you can put the device in aeroplane mode and it will keep working.',
      ),
      heading('Fonts and other resources'),
      paragraph(
        'PrintNest uses the fonts already on your device rather than loading them from a font service, so nothing about your usage leaks through a font request.',
      ),
    ),
    footer: [
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Close',
        onclick: () => handle.close(),
      }),
    ],
  });
}

function heading(text: string): HTMLElement {
  return el('h3', { text, style: { margin: '1.5rem 0 0.5rem', fontSize: '1rem' } });
}

function paragraph(text: string): HTMLElement {
  return el('p', { text, style: { marginBottom: '0.75rem' } });
}

/** Keyboard shortcut reference. */
export function openShortcutsDialog(): void {
  const shortcuts: [string, string][] = [
    ['Ctrl / ⌘ + P', 'Open the print flow'],
    ['Ctrl / ⌘ + E', 'Export'],
    ['Ctrl / ⌘ + O', 'Import files'],
    ['Ctrl / ⌘ + S', 'Save now'],
    ['Ctrl / ⌘ + Z', 'Undo'],
    ['Ctrl / ⌘ + Shift + Z', 'Redo'],
    ['Ctrl / ⌘ + D', 'Duplicate the selection'],
    ['Ctrl / ⌘ + A', 'Select everything on the page'],
    ['Delete / Backspace', 'Delete the selection'],
    ['Arrow keys', 'Nudge by 1 mm'],
    ['Shift + arrow keys', 'Nudge by 10 mm'],
    ['Alt + ↑ / ↓ on a page', 'Move that page up or down the list'],
    ['Page Up / Page Down', 'Previous or next page'],
    ['1 – 5', 'Switch preview mode'],
    ['+ / −', 'Zoom in and out'],
    ['0', 'Zoom to fit'],
    ['?', 'This list'],
    ['Escape', 'Clear the selection or close a dialog'],
  ];

  const handle = openDialog({
    title: 'Keyboard shortcuts',
    body: el(
      'dl',
      {
        style: {
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '0.5rem 1.5rem',
          margin: '0',
          fontSize: '0.875rem',
        },
      },
      ...shortcuts.flatMap(([keys, description]) => [
        el('dt', {
          text: keys,
          style: { fontFamily: 'var(--pn-font-mono)', margin: '0', whiteSpace: 'nowrap' },
        }),
        el('dd', { text: description, style: { margin: '0', color: 'var(--pn-text-muted)' } }),
      ]),
    ),
    footer: [
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--primary',
        text: 'Close',
        onclick: () => handle.close(),
      }),
    ],
  });
}
