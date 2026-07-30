import { describe, expect, it } from 'vitest';
import { imposeProject } from '../src/core/imposition.ts';
import {
  createImageElement,
  createPageNumberElement,
  createProject,
  createShapeElement,
  createTextElement,
} from '../src/core/project.ts';
import { projectFromTemplate, getTemplate } from '../src/core/templates.ts';
import { renderCropMarks, renderPage } from '../src/render/pageRender.ts';
import { renderSheet } from '../src/render/sheetRender.ts';
import { alignOffset, justifySpacing, wrapText } from '../src/render/textLayout.ts';
import type { Project } from '../src/core/types.ts';

/**
 * Rendering tests.
 *
 * The renderer's contract is that a page is laid out at true physical size in
 * millimetres, because that is what makes "what you see is what prints" hold.
 * These tests assert the millimetre values that end up in the DOM, which is
 * the property everything downstream depends on.
 */

function mmValue(value: string | null): number {
  return Number.parseFloat((value ?? '0').replace('mm', ''));
}

describe('renderPage geometry', () => {
  it('sizes the page in real millimetres', () => {
    const project = createProject({ kind: 'quick' });
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(node.style.width).toBe('210mm');
    expect(node.style.height).toBe('297mm');
  });

  it('positions elements in millimetres', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createTextElement('hello', { xMm: 12.5, yMm: 34, widthMm: 100, heightMm: 20 }),
    );
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    const element = node.querySelector<HTMLElement>('.pn-el')!;
    expect(mmValue(element.style.left)).toBeCloseTo(12.5, 4);
    expect(mmValue(element.style.top)).toBeCloseTo(34, 4);
    expect(mmValue(element.style.width)).toBeCloseTo(100, 4);
  });

  it('never renders user text as markup', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createTextElement('<img src=x onerror="alert(1)">', {
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 20,
      }),
    );
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toContain('<img src=x');
  });

  it('draws an unfilled photo frame as a placeholder', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createImageElement('', { xMm: 10, yMm: 10, widthMm: 50, heightMm: 50 }),
    );
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(node.querySelector('.pn-el--placeholder')).not.toBeNull();
    expect(node.querySelector('img')).toBeNull();
  });

  it('marks an image whose file has gone missing', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createImageElement('gone', { xMm: 10, yMm: 10, widthMm: 50, heightMm: 50 }),
    );
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(node.querySelector('.pn-el--missing')).not.toBeNull();
  });

  it('skips hidden elements entirely', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createTextElement('visible', { xMm: 0, yMm: 0, widthMm: 50, heightMm: 10 }),
      createTextElement('hidden', { xMm: 0, yMm: 20, widthMm: 50, heightMm: 10 }, { hidden: true }),
    );
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(node.querySelectorAll('.pn-el')).toHaveLength(1);
  });

  it('applies element rotation as a transform', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createShapeElement('rect', { xMm: 0, yMm: 0, widthMm: 50, heightMm: 50 }, { rotation: 45 }),
    );
    const node = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(node.querySelector<HTMLElement>('.pn-el')!.style.transform).toBe('rotate(45deg)');
  });

  it('resolves page numbers and skips covers', () => {
    const project = createProject({ kind: 'booklet', pageCount: 4 });
    for (const page of project.pages) {
      page.elements.push(
        createPageNumberElement({ xMm: 10, yMm: 200, widthMm: 100, heightMm: 6 }, {
          format: 'Page {n} of {total}',
        }),
      );
    }
    const inner = renderPage({ project, page: project.pages[1]!, pageIndex: 1 });
    expect(inner.textContent).toContain('Page 2 of 4');

    // The cover carries the element but must not print a number on it.
    const cover = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(cover.querySelector<HTMLElement>('.pn-el--page-number')!.style.display).toBe('none');
  });

  it('honours an explicit skip list', () => {
    const project = createProject({ kind: 'quick', pageCount: 3 });
    project.pages[1]!.elements.push(
      createPageNumberElement({ xMm: 0, yMm: 0, widthMm: 50, heightMm: 6 }, { skipPages: [1] }),
    );
    const node = renderPage({ project, page: project.pages[1]!, pageIndex: 1 });
    expect(node.querySelector<HTMLElement>('.pn-el--page-number')!.style.display).toBe('none');
  });

  it('adds overlays only when asked, and marks them decorative', () => {
    const project = createProject({ kind: 'quick' });
    const plain = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(plain.querySelector('.pn-page__overlay')).toBeNull();

    const withOverlays = renderPage({
      project,
      page: project.pages[0]!,
      pageIndex: 0,
      overlays: { margins: true, safeArea: true, bleed: false, grid: true, gridSizeMm: 5 },
    });
    const overlay = withOverlays.querySelector('.pn-page__overlay')!;
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.querySelector('.pn-overlay--margins')).not.toBeNull();
    expect(overlay.querySelector('.pn-overlay--grid')).not.toBeNull();
    expect(overlay.querySelector('.pn-overlay--bleed')).toBeNull();
  });

  it('drops backgrounds in ink-saving mode', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.backgroundColor = '#171717';
    const normal = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(normal.style.backgroundColor).not.toBe('');

    project.settings.ink = {
      enabled: true,
      greyscale: true,
      removeBackgrounds: true,
      imageDensity: 1,
      draftPreviews: false,
    };
    const saving = renderPage({ project, page: project.pages[0]!, pageIndex: 0 });
    expect(saving.style.filter).toContain('grayscale');
    // rgb(255, 255, 255) is how jsdom normalises #FFFFFF.
    expect(saving.style.backgroundColor.replace(/\s/g, '')).toBe('rgb(255,255,255)');
  });

  it('stamps "Made at home" on the last page only, when enabled', () => {
    const project = createProject({ kind: 'quick', pageCount: 2 });
    project.settings.madeAtHomeStamp = true;
    expect(
      renderPage({ project, page: project.pages[0]!, pageIndex: 0 }).querySelector('.pn-stamp'),
    ).toBeNull();
    expect(
      renderPage({ project, page: project.pages[1]!, pageIndex: 1 }).querySelector('.pn-stamp'),
    ).not.toBeNull();
  });
});

describe('renderSheet', () => {
  function bookletProject(): Project {
    const project = createProject({ kind: 'booklet', pageCount: 8 });
    // The preset adds a binding margin; these tests are about the underlying
    // placement, and the gutter has its own coverage in the imposition suite.
    project.settings.imposition.gutterMm = 0;
    project.pages.forEach((page, index) => {
      page.elements.push(
        createTextElement(`Page ${index + 1}`, { xMm: 10, yMm: 10, widthMm: 100, heightMm: 20 }),
      );
    });
    return project;
  }

  it('lays the sheet out at the paper size', () => {
    const project = bookletProject();
    const result = imposeProject(project);
    const node = renderSheet({
      project,
      sheet: result.sheets[0]!,
      result,
      showGuides: true,
    });
    expect(node.style.width).toBe('297mm');
    expect(node.style.height).toBe('210mm');
  });

  it('places two pages side by side on a booklet sheet', () => {
    const project = bookletProject();
    const result = imposeProject(project);
    const node = renderSheet({ project, sheet: result.sheets[0]!, result, showGuides: false });
    const slots = node.querySelectorAll<HTMLElement>('.pn-slot');
    expect(slots).toHaveLength(2);
    expect(mmValue(slots[0]!.style.left)).toBeCloseTo(0, 3);
    expect(mmValue(slots[1]!.style.left)).toBeCloseTo(148.5, 3);
  });

  it('renders the canonical booklet order onto the paper', () => {
    const project = bookletProject();
    const result = imposeProject(project);
    const front = renderSheet({ project, sheet: result.sheets[0]!, result, showGuides: false });
    const back = renderSheet({ project, sheet: result.sheets[1]!, result, showGuides: false });

    const pagesOf = (node: HTMLElement): string[] =>
      Array.from(node.querySelectorAll('.pn-slot .pn-page'), (page) =>
        (page.textContent ?? '').trim(),
      );

    expect(pagesOf(front)).toEqual(['Page 8', 'Page 1']);
    expect(pagesOf(back)).toEqual(['Page 2', 'Page 7']);
  });

  it('draws fold guides when asked and omits them when not', () => {
    const project = bookletProject();
    const result = imposeProject(project);
    const withGuides = renderSheet({ project, sheet: result.sheets[0]!, result, showGuides: true });
    expect(withGuides.querySelector('.pn-guides')).not.toBeNull();

    const without = renderSheet({ project, sheet: result.sheets[0]!, result, showGuides: false });
    expect(without.querySelector('.pn-guides')).toBeNull();
  });

  it('marks blank slots in the preview but not in the print output', () => {
    // Five pages pad to eight, so three slots have no page behind them.
    const project = createProject({ kind: 'booklet', pageCount: 5 });
    project.pages[0]!.elements.push(
      createTextElement('one', { xMm: 5, yMm: 5, widthMm: 50, heightMm: 10 }),
    );
    const result = imposeProject(project);

    const countBlanks = (markBlanks: boolean): number =>
      result.sheets.reduce(
        (total, sheet) =>
          total +
          renderSheet({ project, sheet, result, showGuides: false, markBlanks }).querySelectorAll(
            '.pn-slot--blank',
          ).length,
        0,
      );

    expect(countBlanks(true)).toBe(3);
    expect(countBlanks(false)).toBe(0);
  });

  it('rotates the mini zine top row', () => {
    const project = createProject({ kind: 'zine' });
    project.pages.forEach((page, index) =>
      page.elements.push(
        createTextElement(`${index + 1}`, { xMm: 2, yMm: 2, widthMm: 40, heightMm: 10 }),
      ),
    );
    const result = imposeProject(project);
    const node = renderSheet({ project, sheet: result.sheets[0]!, result, showGuides: true });
    const pages = node.querySelectorAll<HTMLElement>('.pn-slot .pn-page');
    expect(pages).toHaveLength(8);
    // The first four cells are the upside-down row.
    for (let i = 0; i < 4; i += 1) {
      expect(pages[i]!.style.transform).toContain('rotate(180deg)');
    }
    for (let i = 4; i < 8; i += 1) {
      expect(pages[i]!.style.transform ?? '').not.toContain('rotate(180deg)');
    }
  });
});

describe('crop marks', () => {
  it('places the marks outside the trim box by the bleed distance', () => {
    const svg = renderCropMarks({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      trimBoxes: [{ xMm: 20, yMm: 20, widthMm: 170, heightMm: 257 }],
      bleedMm: 3,
      markLengthMm: 4,
      registration: false,
    });
    const lines = svg.querySelectorAll('line');
    // Eight arms per trim box: two at each corner.
    expect(lines).toHaveLength(8);

    const first = lines[0]!;
    // The horizontal arm at the top-left runs from 20-3-4 to 20-3.
    expect(Number(first.getAttribute('x1'))).toBeCloseTo(13, 4);
    expect(Number(first.getAttribute('x2'))).toBeCloseTo(17, 4);
    expect(Number(first.getAttribute('y1'))).toBeCloseTo(20, 4);
  });

  it('adds registration targets when asked', () => {
    const svg = renderCropMarks({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      trimBoxes: [{ xMm: 10, yMm: 10, widthMm: 190, heightMm: 277 }],
      bleedMm: 0,
      markLengthMm: 4,
      registration: true,
    });
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
  });
});

describe('text wrapping', () => {
  // A stand-in font where every character is exactly 10 units wide.
  const measure = (value: string): number => value.length * 10;

  it('breaks on word boundaries', () => {
    // Each character is 10 units wide, so 100 units is exactly ten characters.
    expect(wrapText('one two three four', 100, measure).lines).toEqual([
      'one two',
      'three four',
    ]);
    expect(wrapText('one two three four', 70, measure).lines).toEqual([
      'one two',
      'three',
      'four',
    ]);
  });

  it('never produces a line wider than the limit', () => {
    const { lines } = wrapText('the quick brown fox jumps over the lazy dog', 80, measure);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(80);
  });

  it('keeps explicit line breaks', () => {
    const { lines } = wrapText('a\nb', 1000, measure);
    expect(lines).toEqual(['a', 'b']);
  });

  it('keeps blank lines between paragraphs', () => {
    const { lines } = wrapText('a\n\nb', 1000, measure);
    expect(lines).toEqual(['a', '', 'b']);
  });

  it('breaks a word that is longer than the line', () => {
    const { lines } = wrapText('supercalifragilistic', 50, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(50);
  });

  it('reports the width of the longest line', () => {
    const { maxLineWidth } = wrapText('one two three', 100, measure);
    expect(maxLineWidth).toBe(measure('one two'));
  });

  it('handles an empty string', () => {
    expect(wrapText('', 100, measure).lines).toEqual(['']);
  });

  it('computes alignment offsets', () => {
    expect(alignOffset('left', 50, 100)).toBe(0);
    expect(alignOffset('center', 50, 100)).toBe(25);
    expect(alignOffset('right', 50, 100)).toBe(50);
    expect(alignOffset('justify', 50, 100)).toBe(0);
  });

  it('spreads justification across the gaps, but never on the last line', () => {
    expect(justifySpacing('a b c', 60, 100, false)).toBeCloseTo(20, 6);
    expect(justifySpacing('a b c', 60, 100, true)).toBe(0);
    expect(justifySpacing('single', 60, 100, false)).toBe(0);
  });
});

describe('template rendering', () => {
  it('renders every template without throwing', () => {
    for (const id of ['mini-zine-8', 'photography-zine', 'childrens-book', 'postcard', 'sticker-sheet']) {
      const template = getTemplate(id)!;
      const project = projectFromTemplate(template);
      for (let index = 0; index < project.pages.length; index += 1) {
        const node = renderPage({ project, page: project.pages[index]!, pageIndex: index });
        expect(node.style.width).toMatch(/mm$/);
      }
    }
  });

  it('imposes every template without losing a page', () => {
    for (const id of ['mini-zine-8', 'photography-zine', 'greeting-card', 'business-card-sheet']) {
      const project = projectFromTemplate(getTemplate(id)!);
      const result = imposeProject(project);
      const placed = new Set(
        result.sheets.flatMap((sheet) =>
          sheet.slots.map((slot) => slot.pageIndex).filter((index): index is number => index !== null),
        ),
      );
      expect(placed.size).toBe(project.pages.length);
    }
  });
});
