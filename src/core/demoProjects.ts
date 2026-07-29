import { createPage, createProject, createShapeElement, createTextElement } from './project.ts';
import { uniformMargins } from './paper.ts';
import type { Project } from './types.ts';

/**
 * Sample projects.
 *
 * Real, complete projects a user can open, print and take apart to see how
 * something was put together. They contain no images, deliberately: a demo
 * that ships photographs would bloat the bundle and could not be honestly
 * licensed, and the interesting part of each one is the layout and the
 * imposition rather than the pictures.
 *
 * Each is built in code rather than stored as JSON because they exercise the
 * same factory functions the editor uses — so a change to the model that
 * broke them would break the app too, and the tests would say so.
 */

export interface DemoProject {
  id: string;
  name: string;
  description: string;
  /** What this one is worth looking at for. */
  teaches: string;
  build: () => Project;
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'demo-mini-zine',
    name: 'Eight-page mini zine — “One Sheet”',
    description:
      'A complete eight-page zine about making zines, on a single sheet of A4. Print it, fold it, and you have both an object and an instruction manual.',
    teaches:
      'Open the Print sheets view: page 1 sits at the bottom right and the top row is upside down. That is the imposition doing its job.',
    build: () => {
      const project = createProject({
        kind: 'zine',
        name: 'One Sheet',
        pageCount: 8,
      });
      project.description = 'A mini zine about making mini zines.';

      const pages: { title?: string; body: string; role?: 'cover' | 'back-cover' }[] = [
        { title: 'One Sheet', body: 'Eight pages.\nThree folds.\nOne cut.', role: 'cover' },
        {
          title: 'Start here',
          body: 'A mini zine is the smallest complete thing you can publish. It costs one sheet of paper and about four minutes.',
        },
        {
          title: 'Fold 1',
          body: 'Fold the sheet in half the short way. Press the crease down firmly with your thumbnail, then open it out again.',
        },
        {
          title: 'Fold 2 and 3',
          body: 'Fold in half the long way. Open out. Fold the long way once more. Open the sheet flat — you should see eight rectangles.',
        },
        {
          title: 'The cut',
          body: 'Cut along the centre line, but only the middle section — between the two folds you made the long way. This is the red line on the guide.',
        },
        {
          title: 'The push',
          body: 'Fold the sheet the long way again. Hold both ends and push them towards each other. The slit opens into a diamond.',
        },
        {
          title: 'Flatten',
          body: 'Press the pages around so the cover ends up on the outside. Crease everything down. That is a zine.',
        },
        {
          body: 'Made at home\nwith PrintNest\n\nstoritellah.com',
          role: 'back-cover',
        },
      ];

      project.pages = pages.map((entry, index) => {
        const page = createPage({ role: entry.role ?? 'content' });
        const isCover = entry.role === 'cover';
        const isBack = entry.role === 'back-cover';

        if (entry.title) {
          page.elements.push(
            createTextElement(
              entry.title,
              { xMm: 7, yMm: isCover ? 26 : 12, widthMm: 60, heightMm: isCover ? 24 : 12 },
              {
                font: 'serif',
                sizePt: isCover ? 20 : 11,
                align: isCover ? 'center' : 'left',
                lineHeight: 1.15,
              },
            ),
          );
          if (isCover) {
            page.elements.push(
              createShapeElement('line', { xMm: 22, yMm: 54, widthMm: 30, heightMm: 1 }, {
                stroke: '#F4A340',
                strokeMm: 0.8,
              }),
            );
          } else {
            page.elements.push(
              createShapeElement('line', { xMm: 7, yMm: 26, widthMm: 18, heightMm: 0.4 }, {
                stroke: '#F4A340',
                strokeMm: 0.6,
              }),
            );
          }
        }

        page.elements.push(
          createTextElement(
            entry.body,
            {
              xMm: 7,
              // Everything stays inside the 6 mm safe area of a 74.25 × 105 mm
              // page, so the demo passes its own pre-flight check.
              yMm: isCover ? 58 : isBack ? 56 : 32,
              widthMm: 60,
              heightMm: isCover ? 34 : 40,
            },
            {
              font: isCover || isBack ? 'sans' : 'serif',
              sizePt: isCover ? 9 : 8.5,
              align: isCover || isBack ? 'center' : 'left',
              lineHeight: 1.55,
              color: isBack ? '#6B6B6B' : '#171717',
            },
          ),
        );

        // A quiet page number on the interior pages.
        if (!isCover && !isBack) {
          page.elements.push(
            createTextElement(
              String(index + 1),
              { xMm: 7, yMm: 92, widthMm: 60, heightMm: 5 },
              { font: 'sans', sizePt: 6, align: 'center', color: '#8C877D' },
            ),
          );
        }

        return page;
      });

      return project;
    },
  },

  {
    id: 'demo-booklet',
    name: 'A5 booklet — “Twelve Pages”',
    description:
      'A twelve-page saddle-stitched booklet with a cover, a colophon and running page numbers. Three sheets of A4, printed on both sides.',
    teaches:
      'This is the manual duplex workflow end to end. Print it once and the assistant will have learned how your printer turns paper over.',
    build: () => {
      const project = createProject({ kind: 'booklet', name: 'Twelve Pages', pageCount: 12 });
      project.description = 'A booklet about booklets.';
      project.settings.imposition.gutterMm = 7;

      const content: { title?: string; body: string }[] = [
        { title: 'Twelve Pages', body: 'A booklet, folded and stapled at home.' },
        { title: 'Why twelve', body: 'A folded sheet always holds four pages, so booklets come in fours: 4, 8, 12, 16. Twelve is three sheets — enough to feel like a book, short enough to staple through.' },
        { title: 'The fold', body: 'Print all three sheets, keep them in order, stack them, and fold the whole stack in one go. Folding sheet by sheet and nesting them afterwards never lines up.' },
        { title: 'The staple', body: 'Two staples on the fold, roughly a third in from each end. Open the stapler flat and staple onto something soft — a mouse mat works — then fold.' },
        { title: 'The gutter', body: 'This booklet has a 7 mm binding margin. Without it, the inner edge of your text disappears into the fold and the booklet is uncomfortable to read.' },
        { title: 'Creep', body: 'On a thick booklet the inner pages stick out further than the outer ones. PrintNest can shift them towards the spine to compensate; then you trim the outer edge flush.' },
        { title: 'The order', body: 'Page 1 does not print first. It shares a sheet with page 12, because that is what a folded sheet does. The Print sheets view shows the real order.' },
        { title: 'Both sides', body: 'PrintNest prints the fronts, waits, tells you exactly how to turn the stack over, then prints the backs in the right order.' },
        { title: 'Paper', body: '80–100 gsm for the inside. If you want a heavier cover, print it separately on 120–160 gsm and wrap it round.' },
        { title: 'Trimming', body: 'A guillotine gives a cleaner edge than scissors, but a sharp knife and a steel rule are enough. Cut through a few sheets at a time.' },
        { title: 'Then what', body: 'Make another one. The second is always better, and now you know how long it takes.' },
        { body: 'Made at home with PrintNest\n\nstoritellah.com' },
      ];

      project.pages = content.map((entry, index) => {
        const isCover = index === 0;
        const isBack = index === content.length - 1;
        const page = createPage({
          role: isCover ? 'cover' : isBack ? 'back-cover' : 'content',
        });

        if (entry.title) {
          page.elements.push(
            createTextElement(
              entry.title,
              { xMm: 20, yMm: isCover ? 70 : 24, widthMm: 108, heightMm: isCover ? 34 : 14 },
              {
                font: 'serif',
                sizePt: isCover ? 28 : 14,
                lineHeight: 1.15,
                align: isCover ? 'center' : 'left',
              },
            ),
          );
        }

        page.elements.push(
          createTextElement(
            entry.body,
            {
              xMm: 20,
              yMm: isCover ? 110 : isBack ? 100 : 44,
              widthMm: 108,
              // The back cover carries two lines, not a page of text; sizing it
              // like the interior would push it past the safe area.
              heightMm: isCover ? 20 : isBack ? 30 : 120,
            },
            {
              font: isCover || isBack ? 'sans' : 'serif',
              sizePt: isCover ? 10 : 10.5,
              align: isCover || isBack ? 'center' : 'left',
              lineHeight: 1.6,
              color: isCover || isBack ? '#6B6B6B' : '#171717',
            },
          ),
        );

        if (!isCover && !isBack) {
          page.elements.push(
            createTextElement(
              String(index + 1),
              { xMm: 20, yMm: 190, widthMm: 108, heightMm: 6 },
              { font: 'sans', sizePt: 8, align: 'center', color: '#8C877D' },
            ),
          );
        }

        return page;
      });

      return project;
    },
  },

  {
    id: 'demo-poster',
    name: 'Four-sheet test poster',
    description:
      'A poster made of four A4 sheets, with alignment bands and grid codes. Print it to check that your tiling, overlap and taping all line up before you commit a real image to it.',
    teaches:
      'Assembling a tiled poster from something with obvious straight lines makes any misalignment immediately visible.',
    build: () => {
      const project = createProject({ kind: 'poster', name: 'Four-sheet test poster' });
      project.description = 'A calibration target for poster tiling.';
      project.settings.poster = {
        ...project.settings.poster,
        autoGrid: false,
        columns: 2,
        rows: 2,
        overlapMm: 10,
        targetWidthMm: 380,
        targetHeightMm: 534,
      };

      // Without a tiled image the poster prints its guides only, which is
      // exactly what makes this a useful alignment test.
      const page = createPage();
      page.elements.push(
        createTextElement(
          'Four-sheet test poster',
          { xMm: 15, yMm: 20, widthMm: 180, heightMm: 16 },
          { font: 'serif', sizePt: 20 },
        ),
        createTextElement(
          'Add an image in the Poster settings, then print all four sheets and assemble them following the map. ' +
            'Straight lines across a joint show up any misalignment immediately.',
          { xMm: 15, yMm: 42, widthMm: 180, heightMm: 40 },
          { font: 'sans', sizePt: 10, lineHeight: 1.6, color: '#6B6B6B' },
        ),
      );
      project.pages = [page];
      return project;
    },
  },

  {
    id: 'demo-photo-set',
    name: 'Photo print set — 4×6, 5×7 and 8×10',
    description:
      'Three pages set up at true photographic sizes, ready for you to drop your own pictures in. Nothing is scaled: what prints is the size on the label.',
    teaches:
      'Select a picture after adding one and watch the resolution badge. It shows the effective dots per inch at the printed size.',
    build: () => {
      const project = createProject({ kind: 'photo', name: 'Photo print set', pageCount: 3 });
      project.description = 'True-to-size photographic prints.';
      project.margins = uniformMargins(8);
      // One print per sheet: the point of this demo is true size, and two to a
      // page would scale them down.
      project.settings.nUp = { columns: 1, rows: 1, gapMm: 0, cutMarks: false };
      // An 8 × 10 inch print leaves only 3.4 mm each side of A4. That is
      // intentional here, so the safe area is set to match rather than
      // warning about a layout that is doing exactly what it should.
      project.settings.marks.safeAreaMm = 3;

      const sizes: [string, number, number][] = [
        ['4 × 6 inches', 101.6, 152.4],
        ['5 × 7 inches', 127, 177.8],
        ['8 × 10 inches', 203.2, 254],
      ];

      project.pages = sizes.map(([label, widthMm, heightMm]) => {
        const page = createPage();
        const x = (210 - widthMm) / 2;
        const y = (297 - heightMm) / 2;

        page.elements.push(
          // A dashed frame at the exact print size, and a label outside it.
          createShapeElement('rect', { xMm: x, yMm: y, widthMm, heightMm }, {
            fill: null,
            stroke: '#D9D5CE',
            strokeMm: 0.4,
          }),
          createTextElement(
            `${label} — ${Math.round(widthMm)} × ${Math.round(heightMm)} mm`,
            { xMm: x, yMm: Math.max(6, y - 8), widthMm, heightMm: 6 },
            { font: 'sans', sizePt: 8, color: '#8C877D' },
          ),
          createTextElement(
            'Drop a photograph onto this page and it will land here at true size.',
            { xMm: x + 8, yMm: y + heightMm / 2 - 6, widthMm: widthMm - 16, heightMm: 12 },
            { font: 'sans', sizePt: 8, align: 'center', color: '#B4AFA5', lineHeight: 1.5 },
          ),
        );
        return page;
      });

      return project;
    },
  },
];

export function getDemoProject(id: string): DemoProject | undefined {
  return DEMO_PROJECTS.find((demo) => demo.id === id);
}
