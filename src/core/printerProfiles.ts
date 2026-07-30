import { getMeta, setMeta } from './db.ts';
import { newId } from './ids.ts';
import { safeColor, sanitizeLine, stripUnsafeKeys } from './sanitize.ts';
import type { Margins } from './paper.ts';
import type { FlipMotion } from './types.ts';

/**
 * Printer profiles.
 *
 * A browser cannot interrogate a printer — the print dialog belongs to the
 * operating system and deliberately does not expose capabilities to web pages.
 * So PrintNest keeps a small editable description of the user's printer and
 * uses it for *advice*: margin warnings, duplex workflow, paper size checks.
 *
 * Every field is user-editable, because drivers, firmware and regional model
 * variants differ, and a starter profile that cannot be corrected is worse
 * than no profile at all.
 */

export type PrinterTechnology = 'inkjet' | 'ink-tank' | 'laser' | 'dye-sublimation' | 'thermal';

export interface PrinterProfile {
  id: string;
  brand: string;
  model: string;
  technology: PrinterTechnology;
  color: boolean;
  /** Catalogue paper ids the printer can take. */
  paperSizes: string[];
  maxPaperSizeId: string;
  /** Paper ids the printer can print edge to edge. Empty means none. */
  borderlessSizes: string[];
  autoDuplex: boolean;
  manualDuplex: boolean;
  /** Smallest margin the hardware can reach, per edge. */
  minMargins: Margins;
  rearFeed: boolean;
  mainTray: boolean;
  photoPaper: boolean;
  connections: string[];
  defaultQuality: string;
  qualityOptions: string[];
  defaultPaperType: string;
  paperTypes: string[];
  /**
   * Learned in the manual duplex assistant: which way the user turns the stack
   * over for this printer. Stored as the motion rather than a driver's edge
   * name, for the same reason the document does.
   */
  duplexFlip: FlipMotion | 'unknown';
  /** Does the printer stack pages face up (so backs print in reverse)? */
  outputFaceUp: boolean | null;
  /** Scale correction measured with the calibration page, 1 = accurate. */
  scaleCorrection: number;
  notes: string;
  builtIn: boolean;
}

function margins(top: number, right: number, bottom: number, left: number): Margins {
  return { topMm: top, rightMm: right, bottomMm: bottom, leftMm: left };
}

const A_SERIES_SMALL = ['a4', 'a5', 'a6', 'letter', 'legal', 'executive', 'photo-4x6', 'photo-5x7', 'photo-6x8'];

export const BUILT_IN_PROFILES: PrinterProfile[] = [
  {
    id: 'brother-dcp-t420w',
    brand: 'Brother',
    model: 'DCP-T420W',
    technology: 'ink-tank',
    color: true,
    paperSizes: [...A_SERIES_SMALL, 'b5', 'postcard', 'business-card'],
    maxPaperSizeId: 'legal',
    // The DCP-T420W has no borderless mode: it always keeps an unprintable
    // edge, so borderless work needs printing oversized and trimming.
    borderlessSizes: [],
    autoDuplex: false,
    manualDuplex: true,
    // Brother's published unprintable area for this family: 3 mm on each side,
    // with a larger foot at the bottom on plain paper.
    minMargins: margins(3, 3, 3, 3),
    rearFeed: false,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB'],
    defaultQuality: 'Normal',
    qualityOptions: ['Fast', 'Normal', 'Best'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Inkjet Paper', 'Brother BP71 Photo', 'Other Glossy'],
    duplexFlip: 'left-right',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes:
      'Ink tank printer with no automatic duplex — use the manual duplex assistant. ' +
      'Keep at least 5 mm of margin on plain paper; the bottom edge is the tightest. ' +
      'Borderless printing is not available, so print oversized and trim for edge-to-edge work.',
    builtIn: true,
  },
  {
    id: 'brother-ink-tank-generic',
    brand: 'Brother',
    model: 'Ink Tank series (generic)',
    technology: 'ink-tank',
    color: true,
    paperSizes: [...A_SERIES_SMALL, 'b5', 'postcard'],
    maxPaperSizeId: 'legal',
    borderlessSizes: ['photo-4x6', 'photo-5x7'],
    autoDuplex: false,
    manualDuplex: true,
    minMargins: margins(3, 3, 3, 3),
    rearFeed: false,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB'],
    defaultQuality: 'Normal',
    qualityOptions: ['Fast', 'Normal', 'Best'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Inkjet Paper', 'Glossy Photo'],
    duplexFlip: 'left-right',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes: 'Check your exact model — borderless support varies across the range.',
    builtIn: true,
  },
  {
    id: 'epson-ecotank-generic',
    brand: 'Epson',
    model: 'EcoTank series (generic)',
    technology: 'ink-tank',
    color: true,
    paperSizes: [...A_SERIES_SMALL, 'b5', 'postcard', 'square-150'],
    maxPaperSizeId: 'legal',
    borderlessSizes: ['a4', 'photo-4x6', 'photo-5x7', 'photo-8x10', 'letter'],
    autoDuplex: true,
    manualDuplex: true,
    minMargins: margins(3, 3, 3, 3),
    rearFeed: true,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB', 'Wi-Fi Direct'],
    defaultQuality: 'Standard',
    qualityOptions: ['Draft', 'Standard', 'High', 'Best Photo'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Matte', 'Premium Glossy', 'Photo Paper Glossy'],
    duplexFlip: 'left-right',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes: 'Most EcoTank models print borderless on photo sizes and A4.',
    builtIn: true,
  },
  {
    id: 'canon-pixma-generic',
    brand: 'Canon',
    model: 'PIXMA series (generic)',
    technology: 'inkjet',
    color: true,
    paperSizes: [...A_SERIES_SMALL, 'b5', 'postcard', 'square-150'],
    maxPaperSizeId: 'legal',
    borderlessSizes: ['a4', 'a5', 'photo-4x6', 'photo-5x7', 'photo-8x10', 'letter', 'square-150'],
    autoDuplex: true,
    manualDuplex: true,
    minMargins: margins(3, 3.4, 5, 3.4),
    rearFeed: true,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB', 'AirPrint', 'Mopria'],
    defaultQuality: 'Standard',
    qualityOptions: ['Draft', 'Standard', 'High'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Matte Photo', 'Photo Paper Plus Glossy II', 'Photo Paper Pro'],
    duplexFlip: 'left-right',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes: 'PIXMA models keep a larger bottom margin on plain paper than on photo paper.',
    builtIn: true,
  },
  {
    id: 'hp-smart-tank-generic',
    brand: 'HP',
    model: 'Smart Tank series (generic)',
    technology: 'ink-tank',
    color: true,
    paperSizes: [...A_SERIES_SMALL, 'b5', 'postcard'],
    maxPaperSizeId: 'legal',
    borderlessSizes: ['photo-4x6', 'photo-5x7'],
    autoDuplex: true,
    manualDuplex: true,
    minMargins: margins(3, 3.2, 3, 3.2),
    rearFeed: false,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB', 'AirPrint', 'Mopria'],
    defaultQuality: 'Normal',
    qualityOptions: ['Draft', 'Normal', 'Best'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'HP Advanced Photo', 'Matte Brochure'],
    duplexFlip: 'left-right',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes: '',
    builtIn: true,
  },
  {
    id: 'generic-laser-mono',
    brand: 'Generic',
    model: 'Monochrome laser',
    technology: 'laser',
    color: false,
    paperSizes: ['a4', 'a5', 'letter', 'legal', 'executive', 'b5'],
    maxPaperSizeId: 'legal',
    borderlessSizes: [],
    autoDuplex: true,
    manualDuplex: true,
    minMargins: margins(4.2, 4.2, 4.2, 4.2),
    rearFeed: false,
    mainTray: true,
    photoPaper: false,
    connections: ['USB', 'Local network'],
    defaultQuality: 'Normal',
    qualityOptions: ['Draft', 'Normal', 'Fine'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Recycled', 'Thick'],
    duplexFlip: 'left-right',
    outputFaceUp: false,
    scaleCorrection: 1,
    notes: 'Laser printers cannot print borderless and dislike glossy photo paper.',
    builtIn: true,
  },
  {
    id: 'generic-color-laser',
    brand: 'Generic',
    model: 'Colour laser',
    technology: 'laser',
    color: true,
    paperSizes: ['a4', 'a5', 'a3', 'letter', 'legal', 'tabloid', 'b5'],
    maxPaperSizeId: 'a3',
    borderlessSizes: [],
    autoDuplex: true,
    manualDuplex: true,
    minMargins: margins(4.2, 4.2, 4.2, 4.2),
    rearFeed: true,
    mainTray: true,
    photoPaper: false,
    connections: ['USB', 'Local network', 'Wi-Fi'],
    defaultQuality: 'Normal',
    qualityOptions: ['Draft', 'Normal', 'Fine'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Heavy', 'Labels', 'Card Stock'],
    duplexFlip: 'left-right',
    outputFaceUp: false,
    scaleCorrection: 1,
    notes: '',
    builtIn: true,
  },
  {
    id: 'generic-photo-printer',
    brand: 'Generic',
    model: 'Dedicated photo printer',
    technology: 'inkjet',
    color: true,
    paperSizes: ['photo-4x6', 'photo-5x7', 'photo-6x8', 'photo-8x10', 'photo-8x12', 'a4', 'a3'],
    maxPaperSizeId: 'a3',
    borderlessSizes: ['photo-4x6', 'photo-5x7', 'photo-6x8', 'photo-8x10', 'photo-8x12', 'a4', 'a3'],
    autoDuplex: false,
    manualDuplex: false,
    minMargins: margins(0, 0, 0, 0),
    rearFeed: true,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB', 'AirPrint'],
    defaultQuality: 'High',
    qualityOptions: ['Standard', 'High', 'Maximum'],
    defaultPaperType: 'Glossy Photo',
    paperTypes: ['Glossy Photo', 'Lustre', 'Matte Fine Art', 'Baryta'],
    duplexFlip: 'left-right',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes: 'Single-sided by design — duplex options are hidden for this profile.',
    builtIn: true,
  },
  {
    id: 'generic-portable',
    brand: 'Generic',
    model: 'Portable printer',
    technology: 'thermal',
    color: false,
    paperSizes: ['a4', 'letter'],
    maxPaperSizeId: 'a4',
    borderlessSizes: [],
    autoDuplex: false,
    manualDuplex: true,
    minMargins: margins(5, 5, 5, 5),
    rearFeed: true,
    mainTray: false,
    photoPaper: false,
    connections: ['Bluetooth', 'Wi-Fi', 'USB'],
    defaultQuality: 'Normal',
    qualityOptions: ['Draft', 'Normal'],
    defaultPaperType: 'Thermal',
    paperTypes: ['Thermal', 'Plain Paper'],
    duplexFlip: 'top-bottom',
    outputFaceUp: true,
    scaleCorrection: 1,
    notes: 'Feed one sheet at a time; manual duplex needs careful re-alignment.',
    builtIn: true,
  },
  {
    id: 'unknown-printer',
    brand: 'Any printer',
    model: 'I am not sure yet',
    technology: 'inkjet',
    color: true,
    paperSizes: ['a4', 'a5', 'a6', 'letter', 'legal', 'photo-4x6'],
    maxPaperSizeId: 'a4',
    borderlessSizes: [],
    autoDuplex: false,
    manualDuplex: true,
    minMargins: margins(5, 5, 5, 5),
    rearFeed: false,
    mainTray: true,
    photoPaper: true,
    connections: ['Wi-Fi', 'USB'],
    defaultQuality: 'Normal',
    qualityOptions: ['Draft', 'Normal', 'Best'],
    defaultPaperType: 'Plain Paper',
    paperTypes: ['Plain Paper', 'Photo Paper'],
    duplexFlip: 'unknown',
    outputFaceUp: null,
    scaleCorrection: 1,
    notes:
      'A cautious profile with generous margins. Run the calibration page to find your ' +
      'printer’s real limits, then edit this profile.',
    builtIn: true,
  },
];

const PROFILES_KEY = 'printer-profiles';

let cache: PrinterProfile[] | null = null;

/** Built-in profiles merged with the user's edits and custom entries. */
export async function loadProfiles(): Promise<PrinterProfile[]> {
  if (cache) return cache;
  let stored: PrinterProfile[] = [];
  try {
    stored = (await getMeta<PrinterProfile[]>(PROFILES_KEY)) ?? [];
  } catch {
    stored = [];
  }
  const byId = new Map(BUILT_IN_PROFILES.map((profile) => [profile.id, profile]));
  for (const raw of stored) {
    const profile = normalizeProfile(raw);
    if (!profile) continue;
    const existing = byId.get(profile.id);
    byId.set(profile.id, existing ? { ...existing, ...profile, builtIn: existing.builtIn } : profile);
  }
  cache = Array.from(byId.values());
  return cache;
}

export async function saveProfile(profile: PrinterProfile): Promise<PrinterProfile[]> {
  const profiles = await loadProfiles();
  const index = profiles.findIndex((entry) => entry.id === profile.id);
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  cache = profiles;
  // Persist only what differs from the shipped defaults plus every custom one.
  const toStore = profiles.filter(
    (entry) => !entry.builtIn || !deepEqual(entry, BUILT_IN_PROFILES.find((b) => b.id === entry.id)),
  );
  await setMeta(PROFILES_KEY, toStore);
  return profiles;
}

export async function deleteProfile(id: string): Promise<PrinterProfile[]> {
  const profiles = (await loadProfiles()).filter((profile) => profile.id !== id || profile.builtIn);
  const builtIn = BUILT_IN_PROFILES.find((profile) => profile.id === id);
  if (builtIn) {
    // Resetting a built-in profile restores the shipped values.
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index >= 0) profiles[index] = { ...builtIn };
  }
  cache = profiles;
  await setMeta(
    PROFILES_KEY,
    profiles.filter(
      (entry) => !entry.builtIn || !deepEqual(entry, BUILT_IN_PROFILES.find((b) => b.id === entry.id)),
    ),
  );
  return profiles;
}

export function createCustomProfile(base?: PrinterProfile): PrinterProfile {
  const source = base ?? BUILT_IN_PROFILES.find((profile) => profile.id === 'unknown-printer')!;
  return {
    ...source,
    id: newId('printer'),
    brand: source.brand,
    model: base ? `${source.model} (my copy)` : 'My printer',
    builtIn: false,
  };
}

export function getProfile(profiles: PrinterProfile[], id: string | null): PrinterProfile | null {
  if (!id) return null;
  return profiles.find((profile) => profile.id === id) ?? null;
}

export function describeProfile(profile: PrinterProfile): string {
  const parts = [profile.color ? 'Colour' : 'Monochrome', TECHNOLOGY_LABELS[profile.technology]];
  if (profile.autoDuplex) parts.push('automatic duplex');
  else if (profile.manualDuplex) parts.push('manual duplex');
  return parts.join(' · ');
}

export const TECHNOLOGY_LABELS: Record<PrinterTechnology, string> = {
  inkjet: 'inkjet',
  'ink-tank': 'ink tank',
  laser: 'laser',
  'dye-sublimation': 'dye sublimation',
  thermal: 'thermal',
};

function normalizeProfile(input: unknown): PrinterProfile | null {
  const raw = stripUnsafeKeys(input) as Partial<PrinterProfile>;
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const fallback =
    BUILT_IN_PROFILES.find((profile) => profile.id === raw.id) ??
    BUILT_IN_PROFILES[BUILT_IN_PROFILES.length - 1]!;
  return {
    ...fallback,
    ...raw,
    id: sanitizeLine(raw.id, 60),
    brand: sanitizeLine(raw.brand, 60) || fallback.brand,
    model: sanitizeLine(raw.model, 80) || fallback.model,
    notes: sanitizeLine(raw.notes, 600),
    paperSizes: stringList(raw.paperSizes, fallback.paperSizes),
    borderlessSizes: stringList(raw.borderlessSizes, fallback.borderlessSizes),
    connections: stringList(raw.connections, fallback.connections),
    qualityOptions: stringList(raw.qualityOptions, fallback.qualityOptions),
    paperTypes: stringList(raw.paperTypes, fallback.paperTypes),
    minMargins: {
      topMm: clampMm(raw.minMargins?.topMm, fallback.minMargins.topMm),
      rightMm: clampMm(raw.minMargins?.rightMm, fallback.minMargins.rightMm),
      bottomMm: clampMm(raw.minMargins?.bottomMm, fallback.minMargins.bottomMm),
      leftMm: clampMm(raw.minMargins?.leftMm, fallback.minMargins.leftMm),
    },
    // A stored profile from an older build may carry a driver edge name here;
    // anything unrecognised falls back to "not tested yet" rather than being
    // trusted, since guessing wrong wastes a whole duplex run.
    duplexFlip:
      raw.duplexFlip === 'left-right' || raw.duplexFlip === 'top-bottom'
        ? raw.duplexFlip
        : 'unknown',
    scaleCorrection:
      typeof raw.scaleCorrection === 'number' && raw.scaleCorrection > 0.8 && raw.scaleCorrection < 1.2
        ? raw.scaleCorrection
        : 1,
    builtIn: Boolean(fallback.builtIn && raw.id === fallback.id),
  };
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => sanitizeLine(item, 60))
    .filter(Boolean)
    .slice(0, 60);
}

function clampMm(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(40, value));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Test seam. */
export function resetProfileCache(): void {
  cache = null;
}

/** Guard so imported profile colours cannot leak into styles. */
export function profileAccentColor(profile: PrinterProfile): string {
  return safeColor(profile.color ? '#3D66F5' : '#6B6B6B');
}
