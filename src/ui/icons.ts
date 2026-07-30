import { svg } from './dom.ts';

/**
 * Line-art icon set.
 *
 * Drawn inline rather than loaded as a font or sprite sheet: no extra request,
 * no flash of missing glyphs offline, and each icon inherits `currentColor`.
 *
 * Icons are always `aria-hidden` and accompanied by text or an `aria-label` —
 * an icon is never the only way to understand a control.
 */

export type IconName =
  | 'bolt' | 'photo' | 'frame' | 'zine' | 'booklet' | 'book' | 'poster' | 'grid'
  | 'card' | 'label' | 'portfolio' | 'custom' | 'folder'
  | 'plus' | 'trash' | 'copy' | 'undo' | 'redo' | 'lock' | 'unlock'
  | 'print' | 'download' | 'upload' | 'settings' | 'help' | 'close' | 'check'
  | 'alert' | 'info' | 'pin' | 'eye' | 'layers' | 'text' | 'shape' | 'crop'
  | 'rotate' | 'align-left' | 'align-center' | 'align-right' | 'zoom-in'
  | 'zoom-out' | 'pages' | 'sheets' | 'reading' | 'duplex' | 'ruler' | 'ink'
  | 'sparkle' | 'grip' | 'chevron-left' | 'chevron-right' | 'home';

const PATHS: Record<IconName, string[]> = {
  bolt: ['M13 2 4 13h6l-1 9 9-11h-6z'],
  photo: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M8.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  frame: ['M4 4h16v16H4z', 'M8 8h8v8H8z'],
  zine: ['M4 5h16v14H4z', 'M12 5v14', 'M8 5v14M16 5v14'],
  booklet: ['M12 5c-2-1.4-4.5-2-8-2v15c3.5 0 6 .6 8 2 2-1.4 4.5-2 8-2V3c-3.5 0-6 .6-8 2z', 'M12 5v15'],
  book: ['M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3z', 'M5 18a3 3 0 0 1 3-3h11'],
  poster: ['M3 4h8v8H3zM13 4h8v8h-8zM3 14h8v8H3zM13 14h8v8h-8z'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  card: ['M2 6h20v12H2z', 'M2 10h20', 'M6 14h5'],
  label: ['M3 5h11l6 7-6 7H3z', 'M17 12h.01'],
  portfolio: ['M3 7h18v13H3z', 'M9 7V4h6v3', 'M3 12h18'],
  custom: ['M4 4h16v16H4z', 'M4 10h16M10 4v16'],
  folder: ['M3 6h6l2 3h10v10H3z'],
  plus: ['M12 5v14M5 12h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14', 'M10 11v6M14 11v6'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  undo: ['M9 7 4 12l5 5', 'M4 12h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 7l5 5-5 5', 'M20 12H10a6 6 0 0 0 0 12h3'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  print: ['M7 9V3h10v6', 'M5 9h14a2 2 0 0 1 2 2v6h-4', 'M7 17H3v-6', 'M7 14h10v7H7z'],
  download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  upload: ['M12 21V9', 'M7 13l5-5 5 5', 'M4 4h16'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14h-.3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.5 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z',
  ],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6', 'M12 17h.01'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M4 12.5 9.5 18 20 6.5'],
  alert: ['M12 3 2 21h20z', 'M12 10v5M12 18h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6M12 7.5h.01'],
  pin: ['M12 3v9', 'M8 12h8l1 4H7z', 'M12 16v5'],
  eye: ['M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  layers: ['M12 3 2 8l10 5 10-5z', 'M2 13l10 5 10-5', 'M2 18l10 5 10-5'],
  text: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
  shape: ['M4 4h9v9H4z', 'M15 15a5 5 0 1 0 0-.1z'],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M2 6h14a2 2 0 0 1 2 2v14'],
  rotate: ['M20 12a8 8 0 1 1-2.4-5.7', 'M20 3v6h-6'],
  'align-left': ['M4 6h16M4 12h10M4 18h13'],
  'align-center': ['M4 6h16M7 12h10M6 18h12'],
  'align-right': ['M4 6h16M10 12h10M7 18h13'],
  'zoom-in': ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.5-4.5', 'M11 8v6M8 11h6'],
  'zoom-out': ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.5-4.5', 'M8 11h6'],
  pages: ['M5 3h9l5 5v13H5z', 'M14 3v5h5'],
  sheets: ['M3 5h18v14H3z', 'M12 5v14'],
  reading: ['M12 6c-2-1.4-4.5-2-8-2v14c3.5 0 6 .6 8 2 2-1.4 4.5-2 8-2V4c-3.5 0-6 .6-8 2z'],
  duplex: ['M4 4h9v16H4z', 'M15 8h5v12h-9', 'M17 4l3 2-3 2'],
  ruler: ['M3 9h18v6H3z', 'M7 9v3M11 9v4M15 9v3M19 9v4'],
  ink: ['M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z'],
  grip: ['M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01'],
  'chevron-left': ['M14 5 8 12l6 7'],
  'chevron-right': ['M10 5l6 7-6 7'],
  home: ['M4 11 12 4l8 7', 'M6 10v10h12V10'],
};

export interface IconOptions {
  size?: number;
  class?: string;
  /** Give the icon an accessible name when it stands alone. */
  label?: string;
}

export function icon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const size = options.size ?? 20;
  const paths = PATHS[name] ?? PATHS.info;

  const node = svg('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: options.class ?? '',
  });

  if (options.label) {
    node.setAttribute('role', 'img');
    const title = svg('title');
    title.textContent = options.label;
    node.append(title);
  } else {
    node.setAttribute('aria-hidden', 'true');
  }

  for (const d of paths) node.append(svg('path', { d }));
  return node;
}

/**
 * The PrintNest mark: a folded sheet nested inside a warm frame — a nest for
 * printed things.
 */
export function brandMark(size = 32): SVGSVGElement {
  const node = svg('svg', {
    viewBox: '0 0 32 32',
    width: size,
    height: size,
    fill: 'none',
    role: 'img',
  });
  const title = svg('title');
  title.textContent = 'PrintNest';
  node.append(title);

  node.append(
    svg('rect', { x: '1.5', y: '1.5', width: '29', height: '29', rx: '8', fill: '#F4A340' }),
    // The nest: a soft curve cradling the sheets.
    svg('path', {
      d: 'M5.5 20c0 4.4 4.7 7 10.5 7s10.5-2.6 10.5-7',
      stroke: '#4A2F08',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      fill: 'none',
    }),
    // Back sheet.
    svg('path', { d: 'M11 6h8l3 3v12h-11z', fill: '#FBF8F2' }),
    svg('path', { d: 'M19 6v3h3', stroke: '#F4A340', 'stroke-width': '1.2', fill: 'none' }),
    // Folded front sheet.
    svg('path', { d: 'M9 10h7l2.5 2.5V22H9z', fill: '#FFFFFF', stroke: '#4A2F08', 'stroke-width': '1.2' }),
    svg('path', { d: 'M12.5 10v12', stroke: '#4A2F08', 'stroke-width': '1', 'stroke-dasharray': '2 1.6' }),
  );

  return node;
}

/**
 * Empty-state illustrations. Loose, hand-drawn shapes rather than clip art, so
 * an empty screen still feels like part of a studio.
 */
export type EmptyArt = 'no-projects' | 'no-files' | 'no-pages' | 'all-clear' | 'no-results';

export function emptyArt(kind: EmptyArt): SVGSVGElement {
  const node = svg('svg', {
    viewBox: '0 0 160 130',
    class: 'pn-empty__art',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });

  switch (kind) {
    case 'no-projects':
      node.append(
        svg('path', { d: 'M30 40h48l10 10v56H30z' }),
        svg('path', { d: 'M78 40v10h10' }),
        svg('path', { d: 'M46 66h30M46 78h30M46 90h18' }),
        svg('path', { d: 'M104 34l8 22 22 8-22 8-8 22-8-22-22-8 22-8z', 'stroke-dasharray': '3 4' }),
      );
      break;
    case 'no-files':
      node.append(
        svg('path', { d: 'M26 96V44a6 6 0 0 1 6-6h30l8 10h58a6 6 0 0 1 6 6v42a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6z' }),
        svg('path', { d: 'M80 56v28M66 70h28', 'stroke-dasharray': '4 5' }),
      );
      break;
    case 'no-pages':
      node.append(
        svg('path', { d: 'M40 26h56v78H40z', 'stroke-dasharray': '5 5' }),
        svg('path', { d: 'M68 26v78' }),
        svg('path', { d: 'M100 40h20v58h-20', 'stroke-dasharray': '5 5' }),
      );
      break;
    case 'all-clear':
      node.append(
        svg('circle', { cx: '80', cy: '65', r: '34' }),
        svg('path', { d: 'M64 66l11 12 22-26' }),
        svg('path', { d: 'M124 30l4 10 10 4-10 4-4 10-4-10-10-4 10-4z', 'stroke-dasharray': '2 3' }),
      );
      break;
    case 'no-results':
      node.append(
        svg('circle', { cx: '70', cy: '58', r: '28' }),
        svg('path', { d: 'M90 78l24 24' }),
        svg('path', { d: 'M60 58h20', 'stroke-dasharray': '4 4' }),
      );
      break;
  }

  return node;
}
