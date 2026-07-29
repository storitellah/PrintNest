import type { Margins, Orientation } from './paper.ts';
import type { LengthUnit } from './units.ts';

/**
 * The PrintNest document model.
 *
 * Everything a project needs is plain JSON-serialisable data — no class
 * instances, no functions, no DOM references. That is what makes autosave,
 * undo/redo, `.printnest` export and the test suite all trivial: they are the
 * same structural clone.
 *
 * Binary assets (image bytes, PDF bytes) live outside the project, in the
 * IndexedDB asset store, keyed by `assetId`.
 */

export const PROJECT_FILE_VERSION = 1;

export type ProjectKind =
  | 'quick'
  | 'photo'
  | 'artwork'
  | 'zine'
  | 'booklet'
  | 'book'
  | 'poster'
  | 'contact-sheet'
  | 'photo-grid'
  | 'cards'
  | 'labels'
  | 'portfolio'
  | 'custom';

export type ImageFit = 'fit' | 'fill' | 'stretch' | 'actual' | 'custom';

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export type FontFamilyId = 'sans' | 'serif' | 'mono';

export interface Rect {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

interface ElementBase extends Rect {
  id: string;
  /** Degrees, clockwise, about the element centre. */
  rotation: number;
  locked: boolean;
  hidden: boolean;
  /** 0–1. */
  opacity: number;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: string;
  fit: ImageFit;
  /** Only meaningful when `fit === 'custom'`; 1 = 100 %. */
  scale: number;
  /** Pan inside the frame, in mm, relative to centred. */
  offsetXMm: number;
  offsetYMm: number;
  /** Extra rotation applied to the image inside its frame, in 90° steps. */
  imageRotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Normalised crop window (0–1) applied before fitting. */
  crop: { x: number; y: number; width: number; height: number } | null;
  borderMm: number;
  borderColor: string;
  cornerRadiusMm: number;
  /** Rendered under the frame; used by gallery-margin presets. */
  matteColor: string | null;
  caption: string;
}

export interface TextElement extends ElementBase {
  type: 'text';
  /** Plain text. Never HTML — the renderer always escapes it. */
  text: string;
  font: FontFamilyId;
  sizePt: number;
  lineHeight: number;
  /** Extra tracking in em units. */
  letterSpacing: number;
  align: TextAlign;
  color: string;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  columns: number;
  columnGapMm: number;
  backgroundColor: string | null;
  paddingMm: number;
}

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fill: string | null;
  stroke: string | null;
  strokeMm: number;
  cornerRadiusMm: number;
}

/** A page number that resolves at render time. */
export interface PageNumberElement extends ElementBase {
  type: 'page-number';
  font: FontFamilyId;
  sizePt: number;
  color: string;
  align: TextAlign;
  /** `{n}` is replaced with the page number, `{total}` with the page count. */
  format: string;
  /** Do not draw on these page indices (0-based) — usually the covers. */
  skipPages: number[];
  startAt: number;
}

export type PageElement = ImageElement | TextElement | ShapeElement | PageNumberElement;

export interface Page {
  id: string;
  /** Shown in the page list; falls back to "Page n". */
  name: string;
  backgroundColor: string;
  elements: PageElement[];
  /** Marked intentionally blank — silences the "accidental blank page" check. */
  intentionallyBlank: boolean;
  /** Cover pages are excluded from page numbering by default. */
  role: 'content' | 'cover' | 'back-cover' | 'inside-cover';
}

export interface AssetMeta {
  id: string;
  name: string;
  /** Validated MIME type. */
  type: string;
  bytes: number;
  /** Intrinsic pixel size for rasters; the viewBox size for SVG. */
  widthPx: number;
  heightPx: number;
  addedAt: number;
  /** Set for pages extracted from an imported PDF. */
  source?: { kind: 'pdf'; pdfAssetId: string; pageIndex: number };
}

export type BindingStyle =
  | 'none'
  | 'saddle-stitch'
  | 'perfect-bound'
  | 'accordion'
  | 'gatefold'
  | 'mini-zine-8';

export type DuplexMode = 'single-sided' | 'auto-duplex' | 'manual-duplex';

export type ReadingDirection = 'ltr' | 'rtl';

export interface ImpositionSettings {
  binding: BindingStyle;
  /** Pages per signature; 0 means "one signature for the whole book". */
  signatureSize: number;
  duplex: DuplexMode;
  /** Long-edge flip is the common default for manual duplex on most printers. */
  flipEdge: 'long' | 'short';
  readingDirection: ReadingDirection;
  /** Extra space added at the bound edge, in mm. */
  gutterMm: number;
  /** Creep compensation for thick signatures, in mm per sheet. */
  creepMm: number;
  /** Draw fold lines on the imposed sheets. */
  foldMarks: boolean;
}

export interface NUpSettings {
  columns: number;
  rows: number;
  gapMm: number;
  /** Draw a light cut line between cells. */
  cutMarks: boolean;
}

export interface PosterSettings {
  /** Target size of the finished, assembled poster. */
  targetWidthMm: number;
  targetHeightMm: number;
  overlapMm: number;
  columns: number;
  rows: number;
  /** Derive columns/rows from the target size rather than using them directly. */
  autoGrid: boolean;
  cutMarks: boolean;
  alignmentMarks: boolean;
  pageLabels: boolean;
  assemblyMap: boolean;
  /** Which asset is being tiled. */
  assetId: string | null;
}

export interface ContactSheetSettings {
  columns: number;
  rows: number;
  gapMm: number;
  showFileNames: boolean;
  showNumbers: boolean;
  showCaptions: boolean;
  showDates: boolean;
  showPageNumbers: boolean;
  captionSizePt: number;
  backgroundColor: string;
  borderMm: number;
  borderColor: string;
  headerText: string;
  fit: 'fit' | 'fill';
}

export interface InkSettings {
  enabled: boolean;
  greyscale: boolean;
  /** Drop page/element background fills. */
  removeBackgrounds: boolean;
  /** 0–1; multiplies image opacity to lay down less ink. */
  imageDensity: number;
  draftPreviews: boolean;
}

export interface MarkSettings {
  bleedMm: number;
  cropMarks: boolean;
  /** Length of each crop mark arm, in mm. */
  cropMarkLengthMm: number;
  safeAreaMm: number;
  registrationMarks: boolean;
}

export interface ProjectSettings {
  imposition: ImpositionSettings;
  nUp: NUpSettings;
  poster: PosterSettings;
  contactSheet: ContactSheetSettings;
  ink: InkSettings;
  marks: MarkSettings;
  /** Copies requested in the print dialog; also shown in the checklist. */
  copies: number;
  /** Preferred display unit for this project's number fields. */
  unit: LengthUnit;
  /** Printer profile id, or null for "any printer". */
  printerProfileId: string | null;
  /** Scale correction learned from the calibration test page, 1 = none. */
  scaleCorrection: number;
  /** Stamp the "Made at home" mark on the back cover / last page. */
  madeAtHomeStamp: boolean;
}

export interface PaperSettings {
  /** Catalogue id, or `custom`. */
  sizeId: string;
  /** Portrait dimensions — resolved through `orientation` at render time. */
  widthMm: number;
  heightMm: number;
  orientation: Orientation;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  kind: ProjectKind;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /** The sheet that goes through the printer. */
  paper: PaperSettings;
  /**
   * The finished page. For a plain document this equals the paper; for a zine
   * or booklet it is smaller, and imposition places several onto one sheet.
   */
  pageWidthMm: number;
  pageHeightMm: number;
  margins: Margins;
  pages: Page[];
  assets: AssetMeta[];
  settings: ProjectSettings;
  /** Template this project started from, for the "reset to template" action. */
  templateId: string | null;
}

/** A project plus the binary payloads, as written to a `.printnest` file. */
export interface ProjectBundle {
  format: 'printnest-project';
  version: number;
  exportedAt: number;
  application: string;
  project: Project;
  /** assetId → base64 payload. */
  assets: Record<string, { type: string; name: string; data: string }>;
}

export interface RecentProjectEntry {
  id: string;
  name: string;
  kind: ProjectKind;
  updatedAt: number;
  pinned: boolean;
  pageCount: number;
}
