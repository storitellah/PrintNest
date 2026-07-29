import { beforeEach, describe, expect, it } from 'vitest';
import { runChecks, applyFix, summariseFinishing } from '../src/core/checker.ts';
import { buildContactSheetPages } from '../src/core/contactSheet.ts';
import { estimateInk, inkFilter, inkHeavyPages, inkSavingFactor, pageCoverage } from '../src/core/ink.ts';
import { autoPlaceImages, detectMissingPages, groupByOrientation, suggestGrid } from '../src/core/layoutAssistant.ts';
import { POSTER_PRESETS, planPoster, posterSizeForGrid, tilesNeeded } from '../src/core/poster.ts';
import {
  cloneProject,
  createImageElement,
  createPage,
  createProject,
  createTextElement,
  duplicateProject,
  isBooklet,
  pageLabel,
  projectSheet,
  usedAssetIds,
} from '../src/core/project.ts';
import { BUILT_IN_PROFILES } from '../src/core/printerProfiles.ts';
import { calculateCorrection, clampCorrection } from '../src/core/testPage.ts';
import { buildSteps, defaultSetup, describeSetup, interpretTest } from '../src/core/duplex.ts';
import { countEmptyFrames, fillEmptyFrames, getTemplate, listTemplates, projectFromTemplate } from '../src/core/templates.ts';
import { safeFileName } from '../src/core/projectFile.ts';
import { uniformMargins } from '../src/core/paper.ts';
import type { AssetMeta, Project } from '../src/core/types.ts';

function asset(id: string, widthPx: number, heightPx: number): AssetMeta {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    bytes: 1000,
    widthPx,
    heightPx,
    addedAt: Date.UTC(2024, 0, 1),
  };
}

describe('project creation', () => {
  it('sets up each kind with a sensible paper and page size', () => {
    const zine = createProject({ kind: 'zine' });
    expect(zine.paper.orientation).toBe('landscape');
    expect(zine.settings.imposition.binding).toBe('mini-zine-8');
    // A quarter of an A4 landscape sheet.
    expect(zine.pageWidthMm).toBeCloseTo(297 / 4, 4);
    expect(zine.pageHeightMm).toBeCloseTo(210 / 2, 4);
    expect(zine.pages).toHaveLength(8);

    const booklet = createProject({ kind: 'booklet' });
    expect(booklet.settings.imposition.binding).toBe('saddle-stitch');
    expect(booklet.pageWidthMm).toBeCloseTo(148.5, 4);
    expect(booklet.settings.imposition.duplex).toBe('manual-duplex');

    const quick = createProject({ kind: 'quick' });
    expect(quick.pageWidthMm).toBe(210);
    expect(quick.pages).toHaveLength(1);
  });

  it('marks the first and last page of a bound project as covers', () => {
    const booklet = createProject({ kind: 'booklet' });
    expect(booklet.pages[0]!.role).toBe('cover');
    expect(booklet.pages[booklet.pages.length - 1]!.role).toBe('back-cover');
    expect(pageLabel(booklet, 0)).toBe('Front cover');
    expect(pageLabel(booklet, 1)).toBe('Page 2');
  });

  it('gives every project and page a distinct id', () => {
    const a = createProject({ kind: 'quick' });
    const b = createProject({ kind: 'quick' });
    expect(a.id).not.toBe(b.id);
    const zine = createProject({ kind: 'zine' });
    expect(new Set(zine.pages.map((page) => page.id)).size).toBe(zine.pages.length);
  });

  it('resolves the sheet through the orientation', () => {
    expect(projectSheet(createProject({ kind: 'booklet' }))).toEqual({
      widthMm: 297,
      heightMm: 210,
    });
  });

  it('recognises bound projects', () => {
    expect(isBooklet(createProject({ kind: 'booklet' }))).toBe(true);
    expect(isBooklet(createProject({ kind: 'quick' }))).toBe(false);
  });
});

describe('duplicating', () => {
  it('produces an independent copy with fresh identity', () => {
    const original = createProject({ kind: 'zine', name: 'My zine' });
    original.pages[0]!.elements.push(
      createTextElement('hello', { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }),
    );

    const copy = duplicateProject(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('My zine copy');
    expect(copy.pinned).toBe(false);
    expect(copy.pages[0]!.id).not.toBe(original.pages[0]!.id);
    expect(copy.pages[0]!.elements[0]!.id).not.toBe(original.pages[0]!.elements[0]!.id);

    // Editing the copy must not touch the original.
    copy.pages[0]!.elements[0]!.xMm = 99;
    expect(original.pages[0]!.elements[0]!.xMm).toBe(0);
  });

  it('clones deeply', () => {
    const original = createProject({ kind: 'quick' });
    const clone = cloneProject(original);
    clone.margins.topMm = 999;
    expect(original.margins.topMm).not.toBe(999);
  });
});

describe('asset bookkeeping', () => {
  it('counts assets that are placed and assets that are only imported', () => {
    const project = createProject({ kind: 'quick' });
    project.assets.push(asset('a', 100, 100), asset('b', 100, 100));
    project.pages[0]!.elements.push(
      createImageElement('a', { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }),
    );
    const used = usedAssetIds(project);
    // Both survive a save: 'b' is in the tray, waiting to be placed.
    expect(used.has('a')).toBe(true);
    expect(used.has('b')).toBe(true);
  });

  it('keeps the poster’s chosen image', () => {
    const project = createProject({ kind: 'poster' });
    project.settings.poster.assetId = 'poster-image';
    expect(usedAssetIds(project).has('poster-image')).toBe(true);
  });
});

describe('templates', () => {
  it('loads every shipped template', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(19);
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
  });

  it('builds a working project from each one', () => {
    for (const template of listTemplates()) {
      const project = projectFromTemplate(template);
      expect(project.pages.length).toBeGreaterThan(0);
      expect(project.pageWidthMm).toBeGreaterThan(0);
      expect(project.pageHeightMm).toBeGreaterThan(0);
      expect(project.templateId).toBe(template.id);
      for (const page of project.pages) {
        for (const element of page.elements) {
          expect(Number.isFinite(element.xMm)).toBe(true);
          expect(element.widthMm).toBeGreaterThan(0);
        }
      }
    }
  });

  it('expands repeated pages', () => {
    const template = getTemplate('childrens-book')!;
    const project = projectFromTemplate(template);
    // One cover, fourteen interior spreads, one back cover.
    expect(project.pages).toHaveLength(16);
    expect(project.pages[0]!.role).toBe('cover');
    expect(project.pages[15]!.role).toBe('back-cover');
  });

  it('fills empty photo frames in order', () => {
    const project = projectFromTemplate(getTemplate('photography-zine')!);
    const before = countEmptyFrames(project);
    expect(before).toBeGreaterThan(0);

    const filled = fillEmptyFrames(project, ['x', 'y']);
    expect(filled).toBe(2);
    expect(countEmptyFrames(project)).toBe(before - 2);
  });

  it('stops cleanly when there are more frames than pictures', () => {
    const project = projectFromTemplate(getTemplate('photography-zine')!);
    expect(fillEmptyFrames(project, ['only-one'])).toBe(1);
  });
});

describe('the pre-flight checker', () => {
  function bookletWithContent(pageCount: number): Project {
    const project = createProject({ kind: 'booklet', pageCount });
    project.assets.push(asset('a', 2400, 3000));
    for (const page of project.pages) {
      page.elements.push(
        createImageElement('a', { xMm: 20, yMm: 20, widthMm: 100, heightMm: 120 }),
      );
    }
    return project;
  }

  it('passes a well-formed booklet', () => {
    const report = runChecks({ project: bookletWithContent(8), profile: null });
    expect(report.verdict).toBe('ready');
    expect(report.issues).toHaveLength(0);
    expect(report.headline).toBe('Ready to print');
  });

  it('blocks printing when there is no content at all', () => {
    const report = runChecks({ project: createProject({ kind: 'quick' }), profile: null });
    expect(report.verdict).toBe('action');
    expect(report.issues.some((issue) => issue.id === 'no-content')).toBe(true);
  });

  it('flags a booklet page count that is not a multiple of four', () => {
    const report = runChecks({ project: bookletWithContent(6), profile: null });
    const issue = report.issues.find((entry) => entry.id === 'booklet-not-multiple-of-four');
    expect(issue).toBeDefined();
    expect(issue!.fix?.action.kind).toBe('pad-to-multiple-of-four');
  });

  it('blocks a booklet that is shorter than one folded sheet', () => {
    const report = runChecks({ project: bookletWithContent(2), profile: null });
    expect(report.verdict).toBe('action');
    expect(report.issues.some((issue) => issue.id === 'booklet-too-short')).toBe(true);
  });

  it('flags low-resolution images', () => {
    const project = createProject({ kind: 'quick' });
    project.assets.push(asset('tiny', 100, 100));
    project.pages[0]!.elements.push(
      createImageElement('tiny', { xMm: 10, yMm: 10, widthMm: 180, heightMm: 180 }),
    );
    const report = runChecks({ project, profile: null });
    expect(report.issues.some((issue) => issue.id === 'low-resolution')).toBe(true);
  });

  it('flags margins the selected printer cannot reach', () => {
    const project = bookletWithContent(8);
    project.margins = uniformMargins(1);
    const brother = BUILT_IN_PROFILES.find((entry) => entry.id === 'brother-dcp-t420w')!;
    const report = runChecks({ project, profile: brother });
    const issue = report.issues.find((entry) => entry.id === 'margins-too-small');
    expect(issue).toBeDefined();
    // The DCP-T420W has no borderless mode, so this is not merely advisory.
    expect(issue!.severity).toBe('action');
    expect(issue!.fix?.action.kind).toBe('grow-margins');
  });

  it('blocks automatic duplex on a printer that has none', () => {
    const project = bookletWithContent(8);
    project.settings.imposition.duplex = 'auto-duplex';
    const brother = BUILT_IN_PROFILES.find((entry) => entry.id === 'brother-dcp-t420w')!;
    const report = runChecks({ project, profile: brother });
    const issue = report.issues.find((entry) => entry.id === 'no-auto-duplex');
    expect(issue?.severity).toBe('action');
    expect(issue?.fix?.action.kind).toBe('switch-to-manual-duplex');
  });

  it('blocks a single-sided booklet', () => {
    const project = bookletWithContent(8);
    project.settings.imposition.duplex = 'single-sided';
    const report = runChecks({ project, profile: null });
    expect(report.issues.some((issue) => issue.id === 'booklet-single-sided')).toBe(true);
  });

  it('notices empty pages but not deliberately blank ones', () => {
    const project = bookletWithContent(8);
    project.pages[3]!.elements = [];
    expect(
      runChecks({ project, profile: null }).issues.some((issue) => issue.id === 'blank-pages'),
    ).toBe(true);

    project.pages[3]!.intentionallyBlank = true;
    expect(
      runChecks({ project, profile: null }).issues.some((issue) => issue.id === 'blank-pages'),
    ).toBe(false);
  });

  it('notices crop marks that will not fit in the margin', () => {
    const project = bookletWithContent(8);
    project.margins = uniformMargins(1);
    project.settings.marks.cropMarks = true;
    const report = runChecks({ project, profile: null });
    expect(report.issues.some((issue) => issue.id === 'crop-marks-clipped')).toBe(true);
  });

  it('notices empty photo frames', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createImageElement('', { xMm: 10, yMm: 10, widthMm: 50, heightMm: 50 }),
      createTextElement('hi', { xMm: 10, yMm: 70, widthMm: 50, heightMm: 10 }),
    );
    const report = runChecks({ project, profile: null });
    expect(report.issues.some((issue) => issue.id === 'empty-frames')).toBe(true);
  });

  it('reports the sheet count alongside the verdict', () => {
    const report = runChecks({ project: bookletWithContent(8), profile: null });
    expect(report.sheetCount).toBe(4); // 2 sheets, 2 sides each
    expect(report.pageCount).toBe(8);
    expect(report.requiresTrimming).toBe(true);
  });
});

describe('applying a checklist fix', () => {
  it('pads a booklet to a multiple of four', () => {
    const project = createProject({ kind: 'booklet', pageCount: 6 });
    let added = 0;
    applyFix(project, { kind: 'pad-to-multiple-of-four' }, () => {
      project.pages.push(createPage({ intentionallyBlank: true }));
      added += 1;
    });
    expect(added).toBe(2);
    expect(project.pages.length % 4).toBe(0);
  });

  it('grows the margins to the printer minimum', () => {
    const project = createProject({ kind: 'quick' });
    applyFix(
      project,
      { kind: 'grow-margins', margins: { topMm: 5, rightMm: 5, bottomMm: 6, leftMm: 5 } },
      () => {},
    );
    expect(project.margins.bottomMm).toBe(6);
  });

  it('switches duplex modes', () => {
    const project = createProject({ kind: 'booklet' });
    applyFix(project, { kind: 'switch-to-single-sided' }, () => {});
    expect(project.settings.imposition.duplex).toBe('single-sided');
    applyFix(project, { kind: 'switch-to-manual-duplex' }, () => {});
    expect(project.settings.imposition.duplex).toBe('manual-duplex');
  });

  it('summarises what still has to happen by hand', () => {
    const notes = summariseFinishing(createProject({ kind: 'booklet' }));
    expect(notes.join(' ')).toMatch(/trimming/i);
    expect(notes.join(' ')).toMatch(/reloaded/i);
  });
});

describe('poster tiling', () => {
  const a4 = { widthMm: 210, heightMm: 297 };

  it('works out how many sheets an edge needs', () => {
    // 190 mm of usable width with a 10 mm overlap contributes 180 mm per extra
    // sheet after the first.
    expect(tilesNeeded(190, 190, 10)).toBe(1);
    expect(tilesNeeded(370, 190, 10)).toBe(2);
    expect(tilesNeeded(550, 190, 10)).toBe(3);
  });

  it('covers the whole poster with no gaps', () => {
    const plan = planPoster({
      posterWidthMm: 500,
      posterHeightMm: 700,
      sheet: a4,
      margins: uniformMargins(10),
      overlapMm: 10,
    });
    const right = Math.max(...plan.tiles.map((tile) => tile.sourceXMm + tile.sourceWidthMm));
    const bottom = Math.max(...plan.tiles.map((tile) => tile.sourceYMm + tile.sourceHeightMm));
    expect(right).toBeCloseTo(plan.posterWidthMm, 4);
    expect(bottom).toBeCloseTo(plan.posterHeightMm, 4);
    expect(plan.tiles).toHaveLength(plan.columns * plan.rows);
  });

  it('overlaps neighbouring tiles by the requested amount', () => {
    const plan = planPoster({
      posterWidthMm: 400,
      posterHeightMm: 400,
      sheet: a4,
      margins: uniformMargins(10),
      overlapMm: 12,
      columns: 2,
      rows: 2,
    });
    const [first, second] = plan.tiles;
    const overlap = first!.sourceXMm + first!.sourceWidthMm - second!.sourceXMm;
    expect(overlap).toBeCloseTo(12, 4);
  });

  it('scales the poster to fit a fixed grid', () => {
    const plan = planPoster({
      posterWidthMm: 2000,
      posterHeightMm: 1000,
      sheet: a4,
      margins: uniformMargins(10),
      overlapMm: 10,
      columns: 2,
      rows: 2,
    });
    expect(plan.columns).toBe(2);
    expect(plan.rows).toBe(2);
    // The 2:1 proportions survive the fit.
    expect(plan.posterWidthMm / plan.posterHeightMm).toBeCloseTo(2, 4);
  });

  it('labels tiles with a readable grid code', () => {
    const plan = planPoster({
      posterWidthMm: 400,
      posterHeightMm: 400,
      sheet: a4,
      margins: uniformMargins(10),
      overlapMm: 10,
      columns: 2,
      rows: 2,
    });
    expect(plan.tiles.map((tile) => tile.code)).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(plan.tiles.map((tile) => tile.number)).toEqual([1, 2, 3, 4]);
  });

  it('marks which edges carry an overlap band', () => {
    const plan = planPoster({
      posterWidthMm: 400,
      posterHeightMm: 400,
      sheet: a4,
      margins: uniformMargins(10),
      overlapMm: 10,
      columns: 2,
      rows: 2,
    });
    expect(plan.tiles[0]!.overlapEdges).toEqual({ top: false, right: true, bottom: true, left: false });
    expect(plan.tiles[3]!.overlapEdges).toEqual({ top: true, right: false, bottom: false, left: true });
  });

  it('handles a single sheet without dividing by zero', () => {
    const plan = planPoster({
      posterWidthMm: 100,
      posterHeightMm: 100,
      sheet: a4,
      margins: uniformMargins(10),
      overlapMm: 10,
    });
    expect(plan.sheetCount).toBe(1);
    expect(plan.tiles[0]!.overlapEdges).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('reports the finished size for each preset', () => {
    for (const preset of POSTER_PRESETS) {
      const size = posterSizeForGrid(preset.columns, preset.rows, a4, uniformMargins(10), 10);
      expect(size.widthMm).toBeGreaterThan(0);
      expect(size.heightMm).toBeGreaterThan(0);
    }
  });
});

describe('contact sheets', () => {
  const assets = Array.from({ length: 26 }, (_, i) => asset(`p${i}`, 1600, 1200));

  it('splits the images across pages', () => {
    const pages = buildContactSheetPages(assets, {
      settings: { ...createProject({ kind: 'contact-sheet' }).settings.contactSheet },
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: uniformMargins(10),
    });
    // 4 × 5 = 20 per page, so 26 images need two pages.
    expect(pages).toHaveLength(2);
  });

  it('places every image inside the printable area', () => {
    const pages = buildContactSheetPages(assets.slice(0, 6), {
      settings: { ...createProject({ kind: 'contact-sheet' }).settings.contactSheet, columns: 3, rows: 2 },
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: uniformMargins(10),
    });
    for (const element of pages[0]!.elements) {
      expect(element.xMm).toBeGreaterThanOrEqual(9.99);
      expect(element.xMm + element.widthMm).toBeLessThanOrEqual(200.01);
    }
  });

  it('preserves each image’s proportions when fitting', () => {
    const pages = buildContactSheetPages([asset('wide', 2000, 1000)], {
      settings: { ...createProject({ kind: 'contact-sheet' }).settings.contactSheet, fit: 'fit', columns: 1, rows: 1 },
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: uniformMargins(10),
    });
    const frame = pages[0]!.elements.find((element) => element.type === 'image')!;
    expect(frame.widthMm / frame.heightMm).toBeCloseTo(2, 2);
  });

  it('adds captions only when asked', () => {
    const base = createProject({ kind: 'contact-sheet' }).settings.contactSheet;
    const withNames = buildContactSheetPages(assets.slice(0, 2), {
      settings: { ...base, showFileNames: true },
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: uniformMargins(10),
    });
    const without = buildContactSheetPages(assets.slice(0, 2), {
      settings: { ...base, showFileNames: false, showNumbers: false, showPageNumbers: false },
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: uniformMargins(10),
    });
    expect(withNames[0]!.elements.length).toBeGreaterThan(without[0]!.elements.length);
  });
});

describe('the layout assistant', () => {
  it('groups images by orientation', () => {
    const grouping = groupByOrientation([
      asset('wide', 2000, 1000),
      asset('tall', 1000, 2000),
      asset('square', 1000, 1000),
    ]);
    expect(grouping.landscape).toHaveLength(1);
    expect(grouping.portrait).toHaveLength(1);
    expect(grouping.square).toHaveLength(1);
  });

  it('suggests a grid that holds the whole set where it can', () => {
    const grid = suggestGrid(
      Array.from({ length: 6 }, (_, i) => asset(`p${i}`, 1500, 1000)),
      190,
      277,
    );
    expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(6);
  });

  it('copes with no images at all', () => {
    expect(suggestGrid([], 100, 100)).toEqual({ columns: 1, rows: 1, coverage: 0 });
  });

  it('places images without cropping them', () => {
    const project = createProject({ kind: 'quick' });
    const images = [asset('a', 2000, 1000), asset('b', 1000, 2000)];
    const placed = autoPlaceImages(project, images, {
      columns: 2,
      rows: 1,
      gapMm: 4,
      fit: 'fit',
    });
    expect(placed).toHaveLength(1);
    const [wide, tall] = placed[0]!.elements;
    expect(wide!.widthMm / wide!.heightMm).toBeCloseTo(2, 2);
    expect(tall!.widthMm / tall!.heightMm).toBeCloseTo(0.5, 2);
    expect(placed[0]!.elements.every((element) => element.fit === 'fit')).toBe(true);
  });

  it('fills the cell exactly when asked to', () => {
    const project = createProject({ kind: 'quick' });
    const placed = autoPlaceImages(project, [asset('a', 2000, 1000)], {
      columns: 1,
      rows: 1,
      gapMm: 0,
      fit: 'fill',
    });
    const element = placed[0]!.elements[0]!;
    expect(element.widthMm).toBeCloseTo(190, 4);
    expect(element.heightMm).toBeCloseTo(277, 4);
  });

  it('spreads a long set over several pages', () => {
    const project = createProject({ kind: 'quick' });
    const images = Array.from({ length: 9 }, (_, i) => asset(`p${i}`, 1000, 1000));
    const placed = autoPlaceImages(project, images, { columns: 2, rows: 2, gapMm: 4, fit: 'fit' });
    expect(placed).toHaveLength(3);
  });

  it('spots a suspicious gap between two full pages', () => {
    const project = createProject({ kind: 'quick', pageCount: 3 });
    project.pages[0]!.elements.push(createTextElement('a', { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }));
    project.pages[2]!.elements.push(createTextElement('c', { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }));
    expect(detectMissingPages(project)).toEqual([1]);

    project.pages[1]!.intentionallyBlank = true;
    expect(detectMissingPages(project)).toEqual([]);
  });
});

describe('ink estimation', () => {
  it('reports low usage for a mostly empty page', () => {
    const project = createProject({ kind: 'quick' });
    project.pages[0]!.elements.push(
      createTextElement('a short line', { xMm: 10, yMm: 10, widthMm: 100, heightMm: 8 }),
    );
    expect(estimateInk(project).level).toBe('low');
  });

  it('reports high usage for a full-bleed photograph', () => {
    const project = createProject({ kind: 'quick' });
    project.assets.push(asset('a', 3000, 4000));
    project.pages[0]!.elements.push(
      createImageElement('a', { xMm: 0, yMm: 0, widthMm: 210, heightMm: 297 }),
    );
    expect(estimateInk(project).level).toBe('high');
  });

  it('counts a dark page background', () => {
    const project = createProject({ kind: 'quick' });
    const assets = new Map<string, AssetMeta>();
    const white = pageCoverage({ ...project.pages[0]!, backgroundColor: '#FFFFFF' }, 1000, assets);
    const black = pageCoverage({ ...project.pages[0]!, backgroundColor: '#000000' }, 1000, assets);
    expect(white).toBeLessThan(black);
    expect(black).toBeCloseTo(1, 2);
  });

  it('lists the heaviest pages', () => {
    const project = createProject({ kind: 'quick', pageCount: 3 });
    project.assets.push(asset('a', 3000, 4000));
    project.pages[1]!.elements.push(
      createImageElement('a', { xMm: 0, yMm: 0, widthMm: 210, heightMm: 297 }),
    );
    expect(inkHeavyPages(project)).toEqual([1]);
  });

  it('predicts a reduction from ink-saving settings', () => {
    const none = inkSavingFactor({
      enabled: true,
      greyscale: false,
      removeBackgrounds: false,
      imageDensity: 1,
      draftPreviews: false,
    });
    const everything = inkSavingFactor({
      enabled: true,
      greyscale: true,
      removeBackgrounds: true,
      imageDensity: 0.5,
      draftPreviews: true,
    });
    expect(none).toBeCloseTo(1, 4);
    expect(everything).toBeLessThan(0.5);
  });

  it('produces a CSS filter only when the mode is on', () => {
    const off = { enabled: false, greyscale: true, removeBackgrounds: false, imageDensity: 0.5, draftPreviews: false };
    expect(inkFilter(off)).toBe('');
    const on = { ...off, enabled: true };
    expect(inkFilter(on)).toContain('grayscale(1)');
    expect(inkFilter(on)).toContain('brightness');
  });
});

describe('calibration', () => {
  it('reports no correction when the print is accurate', () => {
    const result = calculateCorrection(100, 100);
    expect(result.factor).toBe(1);
    expect(result.verdict).toBe('accurate');
  });

  it('compensates for a print that comes out small', () => {
    const result = calculateCorrection(100, 98);
    expect(result.factor).toBeCloseTo(100 / 98, 6);
    expect(result.verdict).toBe('minor');
    expect(result.message).toMatch(/small/);
  });

  it('warns when the error is large enough to mean "fit to page"', () => {
    const result = calculateCorrection(100, 94);
    expect(result.verdict).toBe('significant');
    expect(result.message).toMatch(/fit to page/i);
  });

  it('rejects a nonsensical measurement', () => {
    expect(calculateCorrection(100, 0).factor).toBe(1);
    expect(calculateCorrection(100, Number.NaN).factor).toBe(1);
  });

  it('clamps a correction to a sane range', () => {
    expect(clampCorrection(5)).toBe(1.2);
    expect(clampCorrection(0.1)).toBe(0.8);
    expect(clampCorrection(1.02)).toBe(1.02);
  });
});

describe('the manual duplex assistant', () => {
  it('defaults to the book-page motion', () => {
    expect(defaultSetup(null).flipMotion).toBe('left-right');
  });

  it('reverses the second pass for a face-up printer', () => {
    const faceUp = BUILT_IN_PROFILES.find((profile) => profile.outputFaceUp === true)!;
    expect(defaultSetup(faceUp).reverseSecondPass).toBe(true);
    const faceDown = BUILT_IN_PROFILES.find((profile) => profile.outputFaceUp === false)!;
    expect(defaultSetup(faceDown).reverseSecondPass).toBe(false);
  });

  it('walks through every stage in order', () => {
    const steps = buildSteps(defaultSetup(null), 4);
    expect(steps.map((step) => step.id)).toEqual([
      'print-fronts',
      'collect',
      'flip',
      'rotate',
      'reload',
      'feed',
      'print-backs',
    ]);
    expect(steps.every((step) => step.detail.length > 20)).toBe(true);
  });

  it('leaves the setup alone when the test looks right', () => {
    const setup = defaultSetup(null);
    const outcome = interpretTest('same-way-up', setup);
    expect(outcome.setup).toEqual({});
    expect(outcome.confident).toBe(true);
  });

  it('switches the recorded motion when the back prints a half turn out', () => {
    const setup = defaultSetup(null);
    const outcome = interpretTest('upside-down', setup);
    expect(outcome.setup.flipMotion).toBe('top-bottom');
  });

  it('swaps the reload direction when the second pass hits the blank side', () => {
    const setup = defaultSetup(null);
    const outcome = interpretTest('other-side', setup);
    expect(outcome.setup.reloadFace).not.toBe(setup.reloadFace);
    expect(outcome.setup.reverseSecondPass).not.toBe(setup.reverseSecondPass);
  });

  it('changes nothing when the user is unsure', () => {
    const outcome = interpretTest('not-sure', defaultSetup(null));
    expect(outcome.setup).toEqual({});
    expect(outcome.confident).toBe(false);
  });

  it('describes the setup in plain words', () => {
    const description = describeSetup(defaultSetup(null));
    expect(description).toMatch(/left to right/);
    expect(description).not.toMatch(/long edge|short edge/);
  });
});

describe('printer profiles', () => {
  it('ships a Brother DCP-T420W profile with the practical details', () => {
    const brother = BUILT_IN_PROFILES.find((profile) => profile.id === 'brother-dcp-t420w')!;
    expect(brother.autoDuplex).toBe(false);
    expect(brother.manualDuplex).toBe(true);
    expect(brother.borderlessSizes).toHaveLength(0);
    expect(brother.paperSizes).toContain('a4');
    expect(brother.connections).toEqual(expect.arrayContaining(['Wi-Fi', 'USB']));
    expect(brother.color).toBe(true);
    expect(brother.notes).toMatch(/manual duplex/i);
  });

  it('gives every built-in profile a distinct id and complete fields', () => {
    const ids = BUILT_IN_PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const profile of BUILT_IN_PROFILES) {
      expect(profile.brand.length).toBeGreaterThan(0);
      expect(profile.model.length).toBeGreaterThan(0);
      expect(profile.paperSizes.length).toBeGreaterThan(0);
      expect(profile.qualityOptions).toContain(profile.defaultQuality);
      expect(profile.paperTypes).toContain(profile.defaultPaperType);
      expect(profile.builtIn).toBe(true);
    }
  });

  it('offers a cautious profile for an unknown printer', () => {
    const unknown = BUILT_IN_PROFILES.find((profile) => profile.id === 'unknown-printer')!;
    expect(unknown.duplexFlip).toBe('unknown');
    expect(unknown.minMargins.topMm).toBeGreaterThanOrEqual(5);
  });
});

describe('file naming', () => {
  it('turns a project name into a safe file stem', () => {
    expect(safeFileName('My Zine!')).toBe('my-zine');
    expect(safeFileName('  spaced   out  ')).toBe('spaced-out');
    expect(safeFileName('../../etc/passwd')).toBe('etcpasswd');
    expect(safeFileName('')).toBe('printnest-project');
    expect(safeFileName('!!!')).toBe('printnest-project');
  });

  it('keeps letters from other scripts', () => {
    expect(safeFileName('Journal été')).toBe('journal-été');
  });
});

describe('performance with a long document', () => {
  let book: Project;

  beforeEach(() => {
    book = createProject({ kind: 'book', pageCount: 200 });
    book.assets.push(asset('a', 2000, 3000));
    for (const page of book.pages) {
      page.elements.push(
        createImageElement('a', { xMm: 10, yMm: 10, widthMm: 120, heightMm: 180 }),
        createTextElement('caption', { xMm: 10, yMm: 195, widthMm: 120, heightMm: 8 }),
      );
    }
  });

  it('checks a 200-page book quickly', () => {
    const start = performance.now();
    const report = runChecks({ project: book, profile: null });
    const elapsed = performance.now() - start;
    expect(report.pageCount).toBe(200);
    // Generous, but catches an accidental quadratic.
    expect(elapsed).toBeLessThan(1500);
  });

  it('clones a 200-page book quickly', () => {
    const start = performance.now();
    cloneProject(book);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('estimates ink for a 200-page book quickly', () => {
    const start = performance.now();
    estimateInk(book);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
