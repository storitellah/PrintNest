/**
 * Input hardening.
 *
 * Everything a user imports is untrusted: an SVG is a document that can carry
 * scripts and network references, a `.printnest` file is JSON that can carry
 * a `__proto__` key, and a project name is a string that will be interpolated
 * into the interface. This module is the single place all of that is cleaned.
 *
 * The rule elsewhere in the codebase: **never** assign untrusted text through
 * `innerHTML`. Use `textContent`, or `escapeHtml` when building a string is
 * genuinely unavoidable.
 */

/** Escape the five characters that matter in an HTML context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Clean a user-entered string: strip control characters, normalise newlines and
 * cap the length. Applied to project names, captions and imported text.
 */
export function sanitizeText(value: unknown, maxLength = 20_000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    // Control characters except tab and newline.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxLength);
}

/** A single-line variant for names and labels. */
export function sanitizeLine(value: unknown, maxLength = 200): string {
  return sanitizeText(value, maxLength).replace(/\n+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Safe object parsing
 * ------------------------------------------------------------------ */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * `JSON.parse` with a reviver that drops prototype-polluting keys.
 *
 * `JSON.parse` itself does not walk the prototype chain, but the parsed object
 * is then merged into defaults all over the loader — and a surviving
 * `__proto__` key is what turns that merge into a pollution bug.
 */
export function safeJsonParse<T = unknown>(text: string): T {
  return JSON.parse(text, function reviver(key, value) {
    if (FORBIDDEN_KEYS.has(key)) return undefined;
    return value;
  }) as T;
}

/** Recursively strip dangerous keys from an already-parsed value. */
export function stripUnsafeKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeKeys(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = stripUnsafeKeys(item);
    }
    // Re-materialise as a normal object so downstream `instanceof`/spread work.
    return { ...out } as T;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Colour validation
 * ------------------------------------------------------------------ */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const NAMED_COLORS = new Set([
  'transparent',
  'white',
  'black',
  'red',
  'green',
  'blue',
  'grey',
  'gray',
  'currentcolor',
]);

/**
 * Only allow colour values that cannot smuggle a `url()` or an expression
 * into a style attribute.
 */
export function safeColor(value: unknown, fallback = '#171717'): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (HEX_COLOR.test(text) || RGB_COLOR.test(text) || NAMED_COLORS.has(text.toLowerCase())) {
    return text;
  }
  return fallback;
}

/* ------------------------------------------------------------------ *
 * SVG sanitisation
 * ------------------------------------------------------------------ */

const SVG_ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask',
  'marker', 'switch', 'style',
]);

const SVG_FORBIDDEN_ATTRIBUTE_PREFIXES = ['on'];

const SVG_FORBIDDEN_ATTRIBUTES = new Set([
  'href', 'xlink:href', 'xlink:show', 'xlink:actuate',
  'formaction', 'action', 'srcset', 'src', 'data',
]);

/** Attributes that carry a URL and must not point off-document. */
const URL_ATTRIBUTES = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'style']);

const DANGEROUS_URL = /(?:javascript|data|vbscript|file|blob)\s*:/i;
const EXTERNAL_URL = /url\(\s*['"]?\s*(?:https?:|\/\/|data:)/i;

export interface SvgSanitizeResult {
  svg: string;
  /** What was removed, so the interface can tell the user honestly. */
  removed: string[];
  /** Intrinsic size taken from width/height or viewBox. */
  widthPx: number;
  heightPx: number;
}

/**
 * Parse an SVG, strip everything executable or network-reaching, and
 * re-serialise it.
 *
 * Removed: `<script>`, `<foreignObject>`, `<image>`, `<animate*>`, `<a>`,
 * every `on*` handler, every external or `javascript:` URL, and anything not
 * on the allow-list above. Internal `href="#id"` references — which gradients
 * and `<use>` legitimately need — are preserved.
 */
export function sanitizeSvg(source: string): SvgSanitizeResult {
  const removed: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, 'image/svg+xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('This SVG file could not be read. It may be damaged.');
  }

  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') {
    throw new Error('This file does not contain an SVG image.');
  }

  const walk = (node: Element): void => {
    // Iterate over a snapshot: the loop removes nodes as it goes.
    for (const child of Array.from(node.children)) {
      const name = child.localName;
      if (!SVG_ALLOWED_ELEMENTS.has(name)) {
        removed.push(`<${name}>`);
        child.remove();
        continue;
      }
      if (name === 'style') {
        // Inline CSS can pull in remote resources through url().
        const css = child.textContent ?? '';
        if (EXTERNAL_URL.test(css) || DANGEROUS_URL.test(css) || /@import/i.test(css)) {
          removed.push('<style> with external references');
          child.remove();
          continue;
        }
      }
      for (const attr of Array.from(child.attributes)) {
        if (!isAttributeSafe(attr.name, attr.value)) {
          removed.push(`${name}[${attr.name}]`);
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };

  for (const attr of Array.from(root.attributes)) {
    if (!isAttributeSafe(attr.name, attr.value)) {
      removed.push(`svg[${attr.name}]`);
      root.removeAttribute(attr.name);
    }
  }
  walk(root);

  const { widthPx, heightPx } = readSvgSize(root);
  // Lock the sanitised document to its own dimensions so downstream layout is
  // deterministic even when the original relied on CSS.
  root.setAttribute('width', String(widthPx));
  root.setAttribute('height', String(heightPx));

  return {
    svg: new XMLSerializer().serializeToString(root),
    removed: Array.from(new Set(removed)),
    widthPx,
    heightPx,
  };
}

function isAttributeSafe(rawName: string, value: string): boolean {
  const name = rawName.toLowerCase();
  if (SVG_FORBIDDEN_ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  if (SVG_FORBIDDEN_ATTRIBUTES.has(name)) {
    // Same-document fragment references are the one safe use of href.
    return name.endsWith('href') && value.trim().startsWith('#');
  }
  if (DANGEROUS_URL.test(value)) return false;
  if (URL_ATTRIBUTES.has(name) && EXTERNAL_URL.test(value)) return false;
  if (name === 'style' && /expression\s*\(|behaviou?r\s*:/i.test(value)) return false;
  return true;
}

function readSvgSize(root: Element): { widthPx: number; heightPx: number } {
  const parseSize = (raw: string | null): number => {
    if (!raw) return 0;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  let widthPx = parseSize(root.getAttribute('width'));
  let heightPx = parseSize(root.getAttribute('height'));
  if (!widthPx || !heightPx) {
    const viewBox = root.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        widthPx = widthPx || parts[2]!;
        heightPx = heightPx || parts[3]!;
      }
    }
  }
  return {
    widthPx: widthPx > 0 ? widthPx : 300,
    heightPx: heightPx > 0 ? heightPx : 300,
  };
}

/**
 * Convert Markdown to plain text blocks.
 *
 * PrintNest deliberately does **not** render Markdown as HTML — that would be
 * an injection surface for no real benefit, since the layout engine positions
 * text blocks itself. Structure is preserved as paragraph breaks and simple
 * heading emphasis instead.
 */
export function markdownToBlocks(markdown: string): { text: string; heading: boolean }[] {
  const clean = sanitizeText(markdown, 500_000);
  const blocks: { text: string; heading: boolean }[] = [];
  for (const chunk of clean.split(/\n{2,}/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const headingMatch = /^(#{1,6})\s+(.*)$/s.exec(trimmed);
    if (headingMatch) {
      blocks.push({ text: headingMatch[2]!.trim(), heading: true });
      continue;
    }
    blocks.push({
      text: trimmed
        .replace(/^[>\s]+/gm, '')
        .replace(/^[-*+]\s+/gm, '• ')
        .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'),
      heading: false,
    });
  }
  return blocks;
}
