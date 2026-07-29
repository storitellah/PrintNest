import { newId, newProjectId } from './ids.ts';
import { getPaperSize, resolveSheet, uniformMargins } from './paper.ts';
import type { Margins, Orientation } from './paper.ts';
import { safeColor, sanitizeLine, sanitizeText } from './sanitize.ts';
import type {
  ImageElement,
  Page,
  PageElement,
  PageNumberElement,
  Project,
  ProjectKind,
  ProjectSettings,
  ShapeElement,
  TextElement,
} from './types.ts';

/**
 * Project and element factories, plus the defaults each project kind starts
 * from. Every object the rest of the app creates comes through here, so a new
 * field only needs a default in one place.
 */

export const INK_BLACK = '#171717';
export const PAPER_WHITE = '#FFFFFF';

export function defaultSettings(): ProjectSettings {
  return {
    imposition: {
      binding: 'none',
      signatureSize: 0,
      duplex: 'single-sided',
      flipEdge: 'long',
      readingDirection: 'ltr',
      gutterMm: 0,
      creepMm: 0,
      foldMarks: true,
    },
    nUp: { columns: 1, rows: 1, gapMm: 4, cutMarks: false },
    poster: {
      targetWidthMm: 594,
      targetHeightMm: 841,
      overlapMm: 10,
      columns: 2,
      rows: 2,
      autoGrid: true,
      cutMarks: true,
      alignmentMarks: true,
      pageLabels: true,
      assemblyMap: true,
      assetId: null,
    },
    contactSheet: {
      columns: 4,
      rows: 5,
      gapMm: 4,
      showFileNames: true,
      showNumbers: true,
      showCaptions: false,
      showDates: false,
      showPageNumbers: true,
      captionSizePt: 6,
      backgroundColor: PAPER_WHITE,
      borderMm: 0,
      borderColor: '#D9D5CE',
      headerText: '',
      fit: 'fit',
    },
    ink: {
      enabled: false,
      greyscale: false,
      removeBackgrounds: false,
      imageDensity: 1,
      draftPreviews: false,
    },
    marks: {
      bleedMm: 0,
      cropMarks: false,
      cropMarkLengthMm: 4,
      safeAreaMm: 5,
      registrationMarks: false,
    },
    copies: 1,
    unit: 'mm',
    printerProfileId: null,
    scaleCorrection: 1,
    madeAtHomeStamp: false,
  };
}

export function createPage(overrides: Partial<Page> = {}): Page {
  return {
    id: newId('page'),
    name: '',
    backgroundColor: PAPER_WHITE,
    elements: [],
    intentionallyBlank: false,
    role: 'content',
    ...overrides,
  };
}

export function createImageElement(
  assetId: string,
  rect: { xMm: number; yMm: number; widthMm: number; heightMm: number },
  overrides: Partial<ImageElement> = {},
): ImageElement {
  return {
    id: newId('el'),
    type: 'image',
    ...rect,
    rotation: 0,
    locked: false,
    hidden: false,
    opacity: 1,
    assetId,
    fit: 'fit',
    scale: 1,
    offsetXMm: 0,
    offsetYMm: 0,
    imageRotation: 0,
    flipH: false,
    flipV: false,
    crop: null,
    borderMm: 0,
    borderColor: INK_BLACK,
    cornerRadiusMm: 0,
    matteColor: null,
    caption: '',
    ...overrides,
  };
}

export function createTextElement(
  text: string,
  rect: { xMm: number; yMm: number; widthMm: number; heightMm: number },
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id: newId('el'),
    type: 'text',
    ...rect,
    rotation: 0,
    locked: false,
    hidden: false,
    opacity: 1,
    text: sanitizeText(text),
    font: 'serif',
    sizePt: 11,
    lineHeight: 1.45,
    letterSpacing: 0,
    align: 'left',
    color: INK_BLACK,
    bold: false,
    italic: false,
    uppercase: false,
    columns: 1,
    columnGapMm: 6,
    backgroundColor: null,
    paddingMm: 0,
    ...overrides,
  };
}

export function createShapeElement(
  shape: ShapeElement['shape'],
  rect: { xMm: number; yMm: number; widthMm: number; heightMm: number },
  overrides: Partial<ShapeElement> = {},
): ShapeElement {
  return {
    id: newId('el'),
    type: 'shape',
    ...rect,
    rotation: 0,
    locked: false,
    hidden: false,
    opacity: 1,
    shape,
    fill: shape === 'line' ? null : '#D9D5CE',
    stroke: shape === 'line' ? INK_BLACK : null,
    strokeMm: shape === 'line' ? 0.4 : 0,
    cornerRadiusMm: 0,
    ...overrides,
  };
}

export function createPageNumberElement(
  rect: { xMm: number; yMm: number; widthMm: number; heightMm: number },
  overrides: Partial<PageNumberElement> = {},
): PageNumberElement {
  return {
    id: newId('el'),
    type: 'page-number',
    ...rect,
    rotation: 0,
    locked: false,
    hidden: false,
    opacity: 1,
    font: 'sans',
    sizePt: 8,
    color: '#6B6B6B',
    align: 'center',
    format: '{n}',
    skipPages: [],
    startAt: 1,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * Project presets
 * ------------------------------------------------------------------ */

export interface KindPreset {
  kind: ProjectKind;
  title: string;
  blurb: string;
  /** Emoji-free line art id, resolved by the icon module. */
  icon: string;
  paperId: string;
  orientation: Orientation;
  marginsMm: number;
  /** Applied over `defaultSettings()`. */
  settings: (base: ProjectSettings) => ProjectSettings;
  /** Finished page size; defaults to the sheet when omitted. */
  pageSize?: (sheet: { widthMm: number; heightMm: number }) => {
    widthMm: number;
    heightMm: number;
  };
  initialPages: number;
}

const half = (sheet: { widthMm: number; heightMm: number }) => ({
  widthMm: sheet.widthMm / 2,
  heightMm: sheet.heightMm,
});

const quarter = (sheet: { widthMm: number; heightMm: number }) => ({
  widthMm: sheet.widthMm / 4,
  heightMm: sheet.heightMm / 2,
});

export const KIND_PRESETS: KindPreset[] = [
  {
    kind: 'quick',
    title: 'Quick Print',
    blurb: 'Drop in files and print them properly scaled, right now.',
    icon: 'bolt',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 10,
    settings: (base) => base,
    initialPages: 1,
  },
  {
    kind: 'photo',
    title: 'Photo Print',
    blurb: 'True-to-size photographs at 4×6, 5×7, 8×10 and more.',
    icon: 'photo',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 8,
    settings: (base) => ({
      ...base,
      nUp: { ...base.nUp, columns: 1, rows: 2, gapMm: 6, cutMarks: true },
    }),
    initialPages: 1,
  },
  {
    kind: 'artwork',
    title: 'Artwork Print',
    blurb: 'Gallery margins, borders, captions and edition details.',
    icon: 'frame',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 15,
    settings: (base) => ({ ...base, marks: { ...base.marks, safeAreaMm: 10 } }),
    initialPages: 1,
  },
  {
    kind: 'zine',
    title: 'Zine Maker',
    blurb: 'Mini zines, folded booklets and accordion strips.',
    icon: 'zine',
    paperId: 'a4',
    orientation: 'landscape',
    marginsMm: 0,
    settings: (base) => ({
      ...base,
      imposition: { ...base.imposition, binding: 'mini-zine-8', foldMarks: true },
    }),
    pageSize: quarter,
    initialPages: 8,
  },
  {
    kind: 'booklet',
    title: 'Booklet Maker',
    blurb: 'Saddle-stitched A5 booklets from A4 paper.',
    icon: 'booklet',
    paperId: 'a4',
    orientation: 'landscape',
    marginsMm: 0,
    settings: (base) => ({
      ...base,
      imposition: {
        ...base.imposition,
        binding: 'saddle-stitch',
        duplex: 'manual-duplex',
        signatureSize: 0,
        gutterMm: 6,
      },
    }),
    pageSize: half,
    initialPages: 8,
  },
  {
    kind: 'book',
    title: 'Book Printer',
    blurb: 'Longer books in signatures, with covers and numbering.',
    icon: 'book',
    paperId: 'a4',
    orientation: 'landscape',
    marginsMm: 0,
    settings: (base) => ({
      ...base,
      imposition: {
        ...base.imposition,
        binding: 'saddle-stitch',
        duplex: 'manual-duplex',
        signatureSize: 16,
        gutterMm: 8,
        creepMm: 0.3,
      },
    }),
    pageSize: half,
    initialPages: 16,
  },
  {
    kind: 'poster',
    title: 'Poster Printer',
    blurb: 'Tile one big image across several sheets and tape it up.',
    icon: 'poster',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 5,
    settings: (base) => base,
    initialPages: 1,
  },
  {
    kind: 'contact-sheet',
    title: 'Contact Sheet',
    blurb: 'Proof sheets with file names, numbers and dates.',
    icon: 'grid',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 10,
    settings: (base) => base,
    initialPages: 1,
  },
  {
    kind: 'photo-grid',
    title: 'Photo Grid',
    blurb: 'Even grids of photographs, ready to cut apart.',
    icon: 'grid',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 10,
    settings: (base) => ({
      ...base,
      contactSheet: {
        ...base.contactSheet,
        columns: 2,
        rows: 3,
        showFileNames: false,
        showNumbers: false,
        showPageNumbers: false,
        fit: 'fill',
      },
    }),
    initialPages: 1,
  },
  {
    kind: 'cards',
    title: 'Cards and Invitations',
    blurb: 'Folded cards and postcards, several to a sheet.',
    icon: 'card',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 8,
    settings: (base) => ({
      ...base,
      nUp: { columns: 2, rows: 2, gapMm: 0, cutMarks: true },
      imposition: { ...base.imposition, duplex: 'manual-duplex' },
    }),
    pageSize: (sheet) => ({ widthMm: sheet.widthMm / 2 - 8, heightMm: sheet.heightMm / 2 - 8 }),
    initialPages: 4,
  },
  {
    kind: 'labels',
    title: 'Labels and Stickers',
    blurb: 'Repeating label grids with cut guides.',
    icon: 'label',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 10,
    settings: (base) => ({
      ...base,
      nUp: { columns: 3, rows: 8, gapMm: 2, cutMarks: true },
    }),
    pageSize: (sheet) => ({ widthMm: (sheet.widthMm - 24) / 3, heightMm: (sheet.heightMm - 24) / 8 }),
    initialPages: 24,
  },
  {
    kind: 'portfolio',
    title: 'Portfolio Print',
    blurb: 'One work per page, with titles and captions.',
    icon: 'portfolio',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 18,
    settings: (base) => base,
    initialPages: 4,
  },
  {
    kind: 'custom',
    title: 'Custom Layout',
    blurb: 'A blank page at any size. Build it your way.',
    icon: 'custom',
    paperId: 'a4',
    orientation: 'portrait',
    marginsMm: 10,
    settings: (base) => base,
    initialPages: 1,
  },
];

export function presetFor(kind: ProjectKind): KindPreset {
  return KIND_PRESETS.find((preset) => preset.kind === kind) ?? KIND_PRESETS[0]!;
}

export interface CreateProjectOptions {
  kind: ProjectKind;
  name?: string;
  paperId?: string;
  orientation?: Orientation;
  margins?: Margins;
  pageCount?: number;
  templateId?: string | null;
}

export function createProject(options: CreateProjectOptions): Project {
  const preset = presetFor(options.kind);
  const paperId = options.paperId ?? preset.paperId;
  const paper = getPaperSize(paperId) ?? getPaperSize('a4')!;
  const orientation = options.orientation ?? preset.orientation;
  const sheet = resolveSheet({ widthMm: paper.widthMm, heightMm: paper.heightMm }, orientation);
  const pageSize = preset.pageSize ? preset.pageSize(sheet) : sheet;
  const pageCount = Math.max(1, options.pageCount ?? preset.initialPages);
  const now = Date.now();

  return {
    id: newProjectId(),
    name: sanitizeLine(options.name || preset.title, 120),
    description: '',
    kind: options.kind,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    paper: {
      sizeId: paper.id,
      widthMm: paper.widthMm,
      heightMm: paper.heightMm,
      orientation,
    },
    pageWidthMm: pageSize.widthMm,
    pageHeightMm: pageSize.heightMm,
    margins: options.margins ?? uniformMargins(preset.marginsMm),
    pages: Array.from({ length: pageCount }, (_, index) =>
      createPage({
        role:
          options.kind === 'zine' || options.kind === 'booklet' || options.kind === 'book'
            ? index === 0
              ? 'cover'
              : index === pageCount - 1
                ? 'back-cover'
                : 'content'
            : 'content',
      }),
    ),
    assets: [],
    settings: preset.settings(defaultSettings()),
    templateId: options.templateId ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Project queries and small mutations
 * ------------------------------------------------------------------ */

export function projectSheet(project: Project) {
  return resolveSheet(
    { widthMm: project.paper.widthMm, heightMm: project.paper.heightMm },
    project.paper.orientation,
  );
}

export function pageLabel(project: Project, index: number): string {
  const page = project.pages[index];
  if (!page) return `Page ${index + 1}`;
  if (page.name) return page.name;
  switch (page.role) {
    case 'cover':
      return 'Front cover';
    case 'inside-cover':
      return 'Inside cover';
    case 'back-cover':
      return 'Back cover';
    default:
      return `Page ${index + 1}`;
  }
}

export function findElement(project: Project, elementId: string):
  | { page: Page; pageIndex: number; element: PageElement; elementIndex: number }
  | null {
  for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex += 1) {
    const page = project.pages[pageIndex]!;
    const elementIndex = page.elements.findIndex((element) => element.id === elementId);
    if (elementIndex >= 0) {
      return { page, pageIndex, element: page.elements[elementIndex]!, elementIndex };
    }
  }
  return null;
}

export function usedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const page of project.pages) {
    for (const element of page.elements) {
      if (element.type === 'image') ids.add(element.assetId);
    }
  }
  // Assets in the tray but not yet placed must survive a save too.
  for (const asset of project.assets) ids.add(asset.id);
  if (project.settings.poster.assetId) ids.add(project.settings.poster.assetId);
  return ids;
}

export function isBooklet(project: Project): boolean {
  const { binding } = project.settings.imposition;
  return binding === 'saddle-stitch' || binding === 'perfect-bound';
}

/** Deep clone through JSON — the model is intentionally plain data. */
export function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

export function duplicateProject(project: Project, name?: string): Project {
  const copy = cloneProject(project);
  copy.id = newProjectId();
  copy.name = sanitizeLine(name || `${project.name} copy`, 120);
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.pinned = false;
  // Fresh ids so the two projects never share page or element identity.
  for (const page of copy.pages) {
    page.id = newId('page');
    for (const element of page.elements) element.id = newId('el');
  }
  return copy;
}

/**
 * Normalise an untrusted project object — an imported `.printnest` file, or a
 * document written by an older version. Missing fields get defaults, colours
 * and strings are sanitised, and geometry is forced finite.
 */
export function normalizeProject(input: unknown): Project {
  const raw = (input ?? {}) as Partial<Project>;
  const base = createProject({ kind: isProjectKind(raw.kind) ? raw.kind : 'custom' });
  const defaults = defaultSettings();
  const rawSettings = (raw.settings ?? {}) as Partial<ProjectSettings>;

  const project: Project = {
    ...base,
    id: typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    name: sanitizeLine(raw.name, 120) || base.name,
    description: sanitizeText(raw.description, 2000),
    createdAt: finite(raw.createdAt, base.createdAt),
    updatedAt: finite(raw.updatedAt, Date.now()),
    pinned: Boolean(raw.pinned),
    paper: {
      sizeId: sanitizeLine(raw.paper?.sizeId, 40) || base.paper.sizeId,
      widthMm: positive(raw.paper?.widthMm, base.paper.widthMm),
      heightMm: positive(raw.paper?.heightMm, base.paper.heightMm),
      orientation: raw.paper?.orientation === 'landscape' ? 'landscape' : 'portrait',
    },
    pageWidthMm: positive(raw.pageWidthMm, base.pageWidthMm),
    pageHeightMm: positive(raw.pageHeightMm, base.pageHeightMm),
    margins: {
      topMm: nonNegative(raw.margins?.topMm, base.margins.topMm),
      rightMm: nonNegative(raw.margins?.rightMm, base.margins.rightMm),
      bottomMm: nonNegative(raw.margins?.bottomMm, base.margins.bottomMm),
      leftMm: nonNegative(raw.margins?.leftMm, base.margins.leftMm),
    },
    pages: Array.isArray(raw.pages) && raw.pages.length > 0
      ? raw.pages.map((page) => normalizePage(page))
      : base.pages,
    assets: Array.isArray(raw.assets)
      ? raw.assets.filter((asset): asset is Project['assets'][number] =>
          Boolean(asset && typeof (asset as { id?: unknown }).id === 'string'),
        )
      : [],
    settings: {
      ...defaults,
      ...rawSettings,
      imposition: { ...defaults.imposition, ...(rawSettings.imposition ?? {}) },
      nUp: { ...defaults.nUp, ...(rawSettings.nUp ?? {}) },
      poster: { ...defaults.poster, ...(rawSettings.poster ?? {}) },
      contactSheet: { ...defaults.contactSheet, ...(rawSettings.contactSheet ?? {}) },
      ink: { ...defaults.ink, ...(rawSettings.ink ?? {}) },
      marks: { ...defaults.marks, ...(rawSettings.marks ?? {}) },
      copies: Math.max(1, Math.min(999, Math.round(finite(rawSettings.copies, 1)))),
      scaleCorrection: clampRange(finite(rawSettings.scaleCorrection, 1), 0.8, 1.2),
    },
    templateId: typeof raw.templateId === 'string' ? sanitizeLine(raw.templateId, 60) : null,
  };

  return project;
}

function normalizePage(input: unknown): Page {
  const raw = (input ?? {}) as Partial<Page>;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('page'),
    name: sanitizeLine(raw.name, 80),
    backgroundColor: safeColor(raw.backgroundColor, PAPER_WHITE),
    intentionallyBlank: Boolean(raw.intentionallyBlank),
    role:
      raw.role === 'cover' || raw.role === 'back-cover' || raw.role === 'inside-cover'
        ? raw.role
        : 'content',
    elements: Array.isArray(raw.elements)
      ? raw.elements
          .map((element) => normalizeElement(element))
          .filter((element): element is PageElement => element !== null)
      : [],
  };
}

function normalizeElement(input: unknown): PageElement | null {
  const raw = (input ?? {}) as Partial<PageElement> & { type?: string };
  const rect = {
    xMm: finite(raw.xMm, 0),
    yMm: finite(raw.yMm, 0),
    widthMm: positive(raw.widthMm, 20),
    heightMm: positive(raw.heightMm, 20),
  };
  const common = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('el'),
    rotation: finite(raw.rotation, 0) % 360,
    locked: Boolean(raw.locked),
    hidden: Boolean(raw.hidden),
    opacity: clampRange(finite(raw.opacity, 1), 0, 1),
  };

  switch (raw.type) {
    case 'image': {
      const image = raw as Partial<ImageElement>;
      if (typeof image.assetId !== 'string' || !image.assetId) return null;
      return {
        ...createImageElement(image.assetId, rect),
        ...common,
        ...rect,
        fit: (['fit', 'fill', 'stretch', 'actual', 'custom'] as const).includes(
          image.fit as never,
        )
          ? image.fit!
          : 'fit',
        scale: clampRange(finite(image.scale, 1), 0.01, 20),
        offsetXMm: finite(image.offsetXMm, 0),
        offsetYMm: finite(image.offsetYMm, 0),
        imageRotation: ([0, 90, 180, 270] as const).includes(image.imageRotation as never)
          ? image.imageRotation!
          : 0,
        flipH: Boolean(image.flipH),
        flipV: Boolean(image.flipV),
        crop: normalizeCrop(image.crop),
        borderMm: nonNegative(image.borderMm, 0),
        borderColor: safeColor(image.borderColor, INK_BLACK),
        cornerRadiusMm: nonNegative(image.cornerRadiusMm, 0),
        matteColor: image.matteColor ? safeColor(image.matteColor, PAPER_WHITE) : null,
        caption: sanitizeText(image.caption, 600),
      };
    }
    case 'text': {
      const text = raw as Partial<TextElement>;
      return {
        ...createTextElement(sanitizeText(text.text, 40_000), rect),
        ...common,
        ...rect,
        font: text.font === 'sans' || text.font === 'mono' ? text.font : 'serif',
        sizePt: clampRange(finite(text.sizePt, 11), 3, 400),
        lineHeight: clampRange(finite(text.lineHeight, 1.45), 0.7, 4),
        letterSpacing: clampRange(finite(text.letterSpacing, 0), -0.2, 1),
        align: (['left', 'center', 'right', 'justify'] as const).includes(text.align as never)
          ? text.align!
          : 'left',
        color: safeColor(text.color, INK_BLACK),
        bold: Boolean(text.bold),
        italic: Boolean(text.italic),
        uppercase: Boolean(text.uppercase),
        columns: Math.max(1, Math.min(6, Math.round(finite(text.columns, 1)))),
        columnGapMm: nonNegative(text.columnGapMm, 6),
        backgroundColor: text.backgroundColor ? safeColor(text.backgroundColor, null!) : null,
        paddingMm: nonNegative(text.paddingMm, 0),
      };
    }
    case 'shape': {
      const shape = raw as Partial<ShapeElement>;
      const kind: ShapeElement['shape'] =
        shape.shape === 'ellipse' || shape.shape === 'line' ? shape.shape : 'rect';
      return {
        ...createShapeElement(kind, rect),
        ...common,
        ...rect,
        fill: shape.fill ? safeColor(shape.fill, '#D9D5CE') : null,
        stroke: shape.stroke ? safeColor(shape.stroke, INK_BLACK) : null,
        strokeMm: nonNegative(shape.strokeMm, 0),
        cornerRadiusMm: nonNegative(shape.cornerRadiusMm, 0),
      };
    }
    case 'page-number': {
      const number = raw as Partial<PageNumberElement>;
      return {
        ...createPageNumberElement(rect),
        ...common,
        ...rect,
        font: number.font === 'serif' || number.font === 'mono' ? number.font : 'sans',
        sizePt: clampRange(finite(number.sizePt, 8), 4, 72),
        color: safeColor(number.color, '#6B6B6B'),
        align: (['left', 'center', 'right'] as const).includes(number.align as never)
          ? number.align!
          : 'center',
        format: sanitizeLine(number.format, 40) || '{n}',
        skipPages: Array.isArray(number.skipPages)
          ? number.skipPages.filter((n): n is number => Number.isInteger(n))
          : [],
        startAt: Math.round(finite(number.startAt, 1)),
      };
    }
    default:
      return null;
  }
}

function normalizeCrop(crop: unknown): ImageElement['crop'] {
  if (!crop || typeof crop !== 'object') return null;
  const value = crop as Record<string, unknown>;
  const x = clampRange(finite(value.x, 0), 0, 1);
  const y = clampRange(finite(value.y, 0), 0, 1);
  const width = clampRange(finite(value.width, 1), 0.01, 1 - x);
  const height = clampRange(finite(value.height, 1), 0.01, 1 - y);
  if (x === 0 && y === 0 && width === 1 && height === 1) return null;
  return { x, y, width, height };
}

function isProjectKind(value: unknown): value is ProjectKind {
  return typeof value === 'string' && KIND_PRESETS.some((preset) => preset.kind === value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return n > 0 ? n : fallback;
}

function nonNegative(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return n >= 0 ? n : fallback;
}

function clampRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
