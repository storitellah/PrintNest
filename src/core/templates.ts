import booksTemplates from '../../templates/books.json';
import photoTemplates from '../../templates/photo.json';
import stationeryTemplates from '../../templates/stationery.json';
import zineTemplates from '../../templates/zines.json';
import { newId } from './ids.ts';
import { getPaperSize, halfSheet, quarterSheet, resolveSheet, uniformMargins } from './paper.ts';
import type { Orientation } from './paper.ts';
import {
  createImageElement,
  createPage,
  createPageNumberElement,
  createProject,
  createShapeElement,
  createTextElement,
  defaultSettings,
} from './project.ts';
import { safeColor, sanitizeLine, sanitizeText, stripUnsafeKeys } from './sanitize.ts';
import type { Page, PageElement, Project, ProjectKind, ProjectSettings } from './types.ts';

/**
 * The template library.
 *
 * Templates live as JSON in `/templates`, in a deliberately compact schema:
 * a rectangle is `[x, y, width, height]` in millimetres of the finished page,
 * and every other field is optional with the same defaults the editor uses.
 * Keeping them as data rather than code means a user can copy a template file,
 * edit it, and drop it back in without touching TypeScript.
 *
 * Templates are validated on load exactly like an imported project — they are
 * ordinary JSON, and treating them as trusted would be an unnecessary
 * exception in the security model.
 */

export interface TemplateElementJson {
  type: 'text' | 'image' | 'shape' | 'page-number';
  rect: [number, number, number, number];
  [key: string]: unknown;
}

export interface TemplatePageJson {
  role?: Page['role'];
  backgroundColor?: string;
  elements?: TemplateElementJson[];
  /** Copy the elements of an earlier page in this template. */
  repeatOf?: number;
  /** How many copies `repeatOf` produces. Defaults to 1. */
  count?: number;
}

export interface TemplateJson {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: ProjectKind;
  paperId: string;
  orientation: Orientation;
  marginsMm: number;
  pageSize: 'sheet' | 'half' | 'quarter' | { widthMm: number; heightMm: number };
  pageCount: number;
  settings?: DeepPartial<ProjectSettings>;
  pages?: TemplatePageJson[];
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Template extends TemplateJson {
  /** Finished page size, resolved against the paper. */
  pageWidthMm: number;
  pageHeightMm: number;
}

function resolveTemplate(raw: unknown): Template | null {
  const json = stripUnsafeKeys(raw) as Partial<TemplateJson>;
  if (!json || typeof json.id !== 'string' || typeof json.name !== 'string') return null;

  const paper = getPaperSize(json.paperId ?? 'a4') ?? getPaperSize('a4')!;
  const orientation: Orientation = json.orientation === 'landscape' ? 'landscape' : 'portrait';
  const sheet = resolveSheet({ widthMm: paper.widthMm, heightMm: paper.heightMm }, orientation);

  let pageSize: { widthMm: number; heightMm: number };
  if (json.pageSize === 'half') pageSize = halfSheet(sheet);
  else if (json.pageSize === 'quarter') pageSize = quarterSheet(sheet);
  else if (json.pageSize && typeof json.pageSize === 'object') {
    pageSize = {
      widthMm: Number(json.pageSize.widthMm) || sheet.widthMm,
      heightMm: Number(json.pageSize.heightMm) || sheet.heightMm,
    };
  } else pageSize = sheet;

  return {
    id: sanitizeLine(json.id, 60),
    name: sanitizeLine(json.name, 80),
    description: sanitizeLine(json.description, 240),
    category: sanitizeLine(json.category, 60) || 'Templates',
    kind: (json.kind ?? 'custom') as ProjectKind,
    paperId: paper.id,
    orientation,
    marginsMm: Number.isFinite(json.marginsMm) ? Number(json.marginsMm) : 10,
    pageSize: json.pageSize ?? 'sheet',
    pageCount: Math.max(1, Math.round(Number(json.pageCount) || 1)),
    settings: json.settings,
    pages: Array.isArray(json.pages) ? json.pages : [],
    pageWidthMm: pageSize.widthMm,
    pageHeightMm: pageSize.heightMm,
  };
}

const ALL_TEMPLATES: Template[] = [
  ...(zineTemplates as unknown[]),
  ...(booksTemplates as unknown[]),
  ...(photoTemplates as unknown[]),
  ...(stationeryTemplates as unknown[]),
]
  .map(resolveTemplate)
  .filter((template): template is Template => template !== null);

export function listTemplates(): Template[] {
  return ALL_TEMPLATES;
}

export function templatesByCategory(): { category: string; templates: Template[] }[] {
  const groups = new Map<string, Template[]>();
  for (const template of ALL_TEMPLATES) {
    const list = groups.get(template.category) ?? [];
    list.push(template);
    groups.set(template.category, list);
  }
  return Array.from(groups, ([category, templates]) => ({ category, templates }));
}

export function getTemplate(id: string): Template | undefined {
  return ALL_TEMPLATES.find((template) => template.id === id);
}

/* ------------------------------------------------------------------ *
 * Instantiation
 * ------------------------------------------------------------------ */

/** Create a project from a template, expanding repeated pages. */
export function projectFromTemplate(template: Template, name?: string): Project {
  const project = createProject({
    kind: template.kind,
    name: name ?? template.name,
    paperId: template.paperId,
    orientation: template.orientation,
    margins: uniformMargins(template.marginsMm),
    pageCount: 1,
    templateId: template.id,
  });

  project.pageWidthMm = template.pageWidthMm;
  project.pageHeightMm = template.pageHeightMm;
  project.settings = mergeSettings(project.settings, template.settings);
  project.pages = buildTemplatePages(template);

  // Honour the declared page count when the page list is shorter.
  while (project.pages.length < template.pageCount) {
    const last = project.pages[project.pages.length - 1];
    project.pages.splice(
      Math.max(0, project.pages.length - (last?.role === 'back-cover' ? 1 : 0)),
      0,
      createPage(),
    );
  }

  return project;
}

function buildTemplatePages(template: Template): Page[] {
  const source = template.pages ?? [];
  const built: Page[] = [];

  for (const pageJson of source) {
    if (typeof pageJson.repeatOf === 'number') {
      const origin = source[pageJson.repeatOf];
      const copies = Math.max(1, Math.round(pageJson.count ?? 1));
      for (let i = 0; i < copies; i += 1) {
        built.push(
          createPage({
            role: origin?.role ?? 'content',
            backgroundColor: safeColor(origin?.backgroundColor, '#FFFFFF'),
            elements: (origin?.elements ?? [])
              .map((element) => buildElement(element))
              .filter((element): element is PageElement => element !== null),
          }),
        );
      }
      continue;
    }

    built.push(
      createPage({
        role: pageJson.role ?? 'content',
        backgroundColor: safeColor(pageJson.backgroundColor, '#FFFFFF'),
        elements: (pageJson.elements ?? [])
          .map((element) => buildElement(element))
          .filter((element): element is PageElement => element !== null),
      }),
    );
  }

  return built.length > 0 ? built : [createPage()];
}

function buildElement(json: TemplateElementJson): PageElement | null {
  if (!Array.isArray(json.rect) || json.rect.length !== 4) return null;
  const [x, y, width, height] = json.rect.map(Number);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  const rect = { xMm: x!, yMm: y!, widthMm: Math.max(0.5, width!), heightMm: Math.max(0.5, height!) };

  switch (json.type) {
    case 'text':
      return createTextElement(sanitizeText(json.text ?? '', 20_000), rect, {
        font: pickFont(json.font),
        sizePt: numberOr(json.sizePt, 11),
        lineHeight: numberOr(json.lineHeight, 1.45),
        letterSpacing: numberOr(json.letterSpacing, 0),
        align: pickAlign(json.align),
        color: safeColor(json.color, '#171717'),
        bold: json.bold === true,
        italic: json.italic === true,
        uppercase: json.uppercase === true,
        columns: Math.max(1, Math.round(numberOr(json.columns, 1))),
        columnGapMm: numberOr(json.columnGapMm, 6),
      });

    case 'image':
      // Templates ship empty frames: a slot the user drops a picture into.
      return createImageElement(typeof json.assetId === 'string' ? json.assetId : '', rect, {
        fit: json.fit === 'fill' || json.fit === 'stretch' ? json.fit : 'fit',
        borderMm: numberOr(json.borderMm, 0),
        borderColor: safeColor(json.borderColor, '#171717'),
        cornerRadiusMm: numberOr(json.cornerRadiusMm, 0),
      });

    case 'shape': {
      const shape = json.shape === 'ellipse' || json.shape === 'line' ? json.shape : 'rect';
      return createShapeElement(shape, rect, {
        fill: json.fill === null ? null : safeColor(json.fill, '#D9D5CE'),
        stroke: json.stroke === null ? null : safeColor(json.stroke, '#171717'),
        strokeMm: numberOr(json.strokeMm, shape === 'line' ? 0.4 : 0),
        cornerRadiusMm: numberOr(json.cornerRadiusMm, 0),
      });
    }

    case 'page-number':
      return createPageNumberElement(rect, {
        format: sanitizeLine(json.format, 40) || '{n}',
        sizePt: numberOr(json.sizePt, 8),
        align: pickAlign(json.align),
        color: safeColor(json.color, '#6B6B6B'),
      });

    default:
      return null;
  }
}

function mergeSettings(
  base: ProjectSettings,
  overrides: DeepPartial<ProjectSettings> | undefined,
): ProjectSettings {
  if (!overrides) return base;
  const defaults = defaultSettings();
  return {
    ...base,
    ...(overrides as Partial<ProjectSettings>),
    imposition: { ...base.imposition, ...(overrides.imposition ?? {}) },
    nUp: { ...base.nUp, ...(overrides.nUp ?? {}) },
    poster: { ...base.poster, ...(overrides.poster ?? {}) },
    contactSheet: { ...base.contactSheet, ...(overrides.contactSheet ?? {}) },
    ink: { ...base.ink, ...(overrides.ink ?? {}) },
    marks: { ...base.marks, ...(overrides.marks ?? {}) },
    copies: base.copies,
    unit: overrides.unit ?? base.unit ?? defaults.unit,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickFont(value: unknown): 'sans' | 'serif' | 'mono' {
  return value === 'sans' || value === 'mono' ? value : 'serif';
}

function pickAlign(value: unknown): 'left' | 'center' | 'right' | 'justify' {
  return value === 'center' || value === 'right' || value === 'justify' ? value : 'left';
}

/**
 * Fill a project's empty image frames with assets, in order. Called after
 * importing pictures into a template-based project.
 */
export function fillEmptyFrames(project: Project, assetIds: string[]): number {
  let filled = 0;
  let cursor = 0;
  for (const page of project.pages) {
    for (const element of page.elements) {
      if (element.type !== 'image' || element.assetId) continue;
      const assetId = assetIds[cursor];
      if (!assetId) return filled;
      element.assetId = assetId;
      cursor += 1;
      filled += 1;
    }
  }
  return filled;
}

/** How many unfilled frames a project still has. */
export function countEmptyFrames(project: Project): number {
  let count = 0;
  for (const page of project.pages) {
    for (const element of page.elements) {
      if (element.type === 'image' && !element.assetId) count += 1;
    }
  }
  return count;
}

/** Reset a project's pages back to its originating template. */
export function resetToTemplate(project: Project): Page[] {
  const template = project.templateId ? getTemplate(project.templateId) : undefined;
  if (!template) return project.pages;
  return buildTemplatePages(template).map((page) => ({ ...page, id: newId('page') }));
}
