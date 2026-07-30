import type { PrinterProfile } from './printerProfiles.ts';
import type { FlipMotion } from './types.ts';

/**
 * Manual duplex logic.
 *
 * Printing on both sides without an automatic duplexer is the single most
 * common source of ruined home-printed booklets. There are only four things
 * that can vary — which edge the paper flips on, whether pages come out face
 * up or face down, which end enters the printer first, and whether the stack
 * needs reversing — but getting any one of them wrong wastes the whole run.
 *
 * PrintNest resolves this empirically: one test sheet, two questions, and the
 * answer is stored on the printer profile so it never has to be asked again.
 */

export type FlipEdge = 'long' | 'short';

/**
 * The driver's name for a motion, given the shape of the sheet.
 *
 * A sheet turns about one of its edges. On landscape paper the long edges run
 * along the top and bottom, so turning about them tips the sheet top to
 * bottom; on portrait paper the long edges are the sides, so the same name
 * means a left-to-right turn. PrintNest only uses this to *label* what the
 * user is doing — nothing in the layout depends on it.
 */
export function flipEdgeLabel(motion: FlipMotion, sheetIsLandscape: boolean): FlipEdge {
  if (motion === 'left-right') return sheetIsLandscape ? 'short' : 'long';
  return sheetIsLandscape ? 'long' : 'short';
}
export type FeedEdge = 'top-first' | 'bottom-first';
export type FaceDirection = 'up' | 'down';

export interface DuplexSetup {
  flipMotion: FlipMotion;
  /** Which way pages stack in the output tray. */
  outputFaceUp: boolean;
  /** Reverse the order of the second pass. */
  reverseSecondPass: boolean;
  /** Rotate the stack 180° before reloading. */
  rotateStack: boolean;
  feedEdge: FeedEdge;
  reloadFace: FaceDirection;
}

export interface DuplexStep {
  id: string;
  title: string;
  detail: string;
  /** Identifier for the animated diagram to show alongside. */
  diagram: DuplexDiagram;
}

export type DuplexDiagram =
  | 'print-fronts'
  | 'collect-stack'
  | 'flip-long-edge'
  | 'flip-short-edge'
  | 'rotate-180'
  | 'no-rotate'
  | 'face-up'
  | 'face-down'
  | 'top-edge-first'
  | 'bottom-edge-first'
  | 'print-backs'
  | 'done';

/**
 * The default setup.
 *
 * The book-page motion — lifting the stack and turning it left to right — is
 * what almost everyone does unprompted, and it is the motion PrintNest's
 * layouts are generated for, so it is the default until a printer profile says
 * otherwise.
 */
export function defaultSetup(profile: PrinterProfile | null): DuplexSetup {
  const faceUp = profile?.outputFaceUp ?? true;
  const motion: FlipMotion =
    profile && profile.duplexFlip !== 'unknown' ? profile.duplexFlip : 'left-right';

  return {
    flipMotion: motion,
    outputFaceUp: faceUp,
    // Face-up output stacks the run in reverse, so the second pass must be
    // reversed to line up without hand-sorting.
    reverseSecondPass: faceUp,
    // A top-to-bottom turn already lands the content a half turn out, which
    // PrintNest compensates for in the layout — the stack itself is not spun.
    rotateStack: false,
    feedEdge: motion === 'top-bottom' ? 'bottom-first' : 'top-first',
    reloadFace: faceUp ? 'down' : 'up',
  };
}

/** The full walkthrough for a given setup. */
export function buildSteps(setup: DuplexSetup, sheetCount: number): DuplexStep[] {
  const sheets = Math.max(1, Math.ceil(sheetCount / 2));
  const motion = setup.flipMotion;
  return [
    {
      id: 'print-fronts',
      title: 'Print the first side',
      detail: `PrintNest sends ${sheets} sheet${sheets === 1 ? '' : 's'} — the front of every sheet. Wait for the ink to dry before touching them.`,
      diagram: 'print-fronts',
    },
    {
      id: 'collect',
      title: 'Take the whole stack out',
      detail: setup.outputFaceUp
        ? 'Your printer stacks pages printed side up, so the last sheet is on top. Lift the stack without shuffling it.'
        : 'Your printer stacks pages printed side down, so the first sheet is on top. Lift the stack without shuffling it.',
      diagram: 'collect-stack',
    },
    {
      id: 'flip',
      title: motion === 'left-right' ? 'Turn the stack left to right' : 'Turn the stack top to bottom',
      detail:
        motion === 'left-right'
          ? 'Like turning a page in a book: keep the top edge at the top and swing the stack over sideways.'
          : 'Like flipping a calendar: swing the stack over so the edge that was at the top ends up at the bottom.',
      diagram: motion === 'left-right' ? 'flip-long-edge' : 'flip-short-edge',
    },
    {
      id: 'rotate',
      title: setup.rotateStack ? 'Rotate the stack 180°' : 'Do not rotate the stack',
      detail: setup.rotateStack
        ? 'Spin the stack a half turn on the table so the edge that came out last goes back in first.'
        : 'Leave the stack the way round it is — the turn you just made is all that is needed.',
      diagram: setup.rotateStack ? 'rotate-180' : 'no-rotate',
    },
    {
      id: 'reload',
      title: `Reload printed side ${setup.reloadFace}`,
      detail: `Put the stack back in the tray with the printed side facing ${setup.reloadFace}, ${
        setup.feedEdge === 'top-first' ? 'top edge' : 'bottom edge'
      } going into the printer first.`,
      diagram: setup.reloadFace === 'up' ? 'face-up' : 'face-down',
    },
    {
      id: 'feed',
      title: setup.feedEdge === 'top-first' ? 'Top edge enters first' : 'Bottom edge enters first',
      detail:
        setup.feedEdge === 'top-first'
          ? 'The edge that carries the top of the page goes into the printer first.'
          : 'The edge that carries the bottom of the page goes into the printer first.',
      diagram: setup.feedEdge === 'top-first' ? 'top-edge-first' : 'bottom-edge-first',
    },
    {
      id: 'print-backs',
      title: 'Print the second side',
      detail: setup.reverseSecondPass
        ? 'PrintNest sends the back sides in reverse order so they land on the right sheets.'
        : 'PrintNest sends the back sides in the same order as the fronts.',
      diagram: 'print-backs',
    },
  ];
}

/* ------------------------------------------------------------------ *
 * The one-sheet test
 * ------------------------------------------------------------------ */

export type TestAnswer = 'same-way-up' | 'upside-down' | 'other-side' | 'not-sure';

export interface TestOutcome {
  setup: Partial<DuplexSetup>;
  summary: string;
  confident: boolean;
}

/**
 * Interpret the duplex test sheet.
 *
 * The test prints "FRONT · TOP" on one side. After the user follows the
 * suggested flip and prints again, the back carries "BACK · TOP". Where that
 * second mark lands tells us everything:
 *
 *  - same way up  → the suggested flip was right.
 *  - upside down  → the stack needs a 180° rotation as well.
 *  - other side   → the paper went in the wrong way up; swap the reload face.
 */
export function interpretTest(answer: TestAnswer, current: DuplexSetup): TestOutcome {
  switch (answer) {
    case 'same-way-up':
      return {
        setup: {},
        summary: 'Your printer flips exactly as expected. Nothing to change.',
        confident: true,
      };
    case 'upside-down':
      return {
        setup: {
          // The layout, not the user, absorbs the half turn: recording the
          // other motion makes PrintNest rotate the back sides instead.
          flipMotion: current.flipMotion === 'left-right' ? 'top-bottom' : 'left-right',
        },
        summary:
          'The back printed a half turn out. PrintNest has recorded the other turn, so the back sides will be rotated to compensate.',
        confident: true,
      };
    case 'other-side':
      return {
        setup: {
          reloadFace: current.reloadFace === 'up' ? 'down' : 'up',
          outputFaceUp: !current.outputFaceUp,
          reverseSecondPass: !current.reverseSecondPass,
        },
        summary:
          'The second pass printed on the blank side, so the stack went back the wrong way up. PrintNest has swapped the reload direction.',
        confident: true,
      };
    case 'not-sure':
    default:
      return {
        setup: {},
        summary:
          'No change made. Print the test again and compare where the word TOP appears on each side.',
        confident: false,
      };
  }
}

/** Save the learned setup back onto a printer profile. */
export function applySetupToProfile(profile: PrinterProfile, setup: DuplexSetup): PrinterProfile {
  return {
    ...profile,
    duplexFlip: setup.flipMotion,
    outputFaceUp: setup.outputFaceUp,
  };
}

/**
 * The two-page test document: one sheet, front and back, each carrying an
 * unmistakable orientation mark.
 */
export function buildDuplexTestSheet(
  side: 'front' | 'back',
  sheet: { widthMm: number; heightMm: number },
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'pn-sheet pn-sheet--duplex-test';
  wrapper.style.width = `${sheet.widthMm}mm`;
  wrapper.style.height = `${sheet.heightMm}mm`;

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${sheet.widthMm} ${sheet.heightMm}`);
  svg.setAttribute('width', `${sheet.widthMm}mm`);
  svg.setAttribute('height', `${sheet.heightMm}mm`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Duplex test sheet, ${side} side.`);

  const colour = side === 'front' ? '#3D66F5' : '#F4A340';

  const band = document.createElementNS(svgNs, 'rect');
  band.setAttribute('x', '0');
  band.setAttribute('y', '0');
  band.setAttribute('width', String(sheet.widthMm));
  band.setAttribute('height', '24');
  band.setAttribute('fill', colour);
  svg.append(band);

  const label = document.createElementNS(svgNs, 'text');
  label.setAttribute('x', String(sheet.widthMm / 2));
  label.setAttribute('y', '15');
  label.setAttribute('font-size', '9');
  label.setAttribute('font-family', 'sans-serif');
  label.setAttribute('font-weight', '700');
  label.setAttribute('fill', '#FFFFFF');
  label.setAttribute('text-anchor', 'middle');
  label.textContent = `${side.toUpperCase()} · TOP`;
  svg.append(label);

  // A large arrow pointing to the top edge, readable even upside down.
  const arrow = document.createElementNS(svgNs, 'path');
  const cx = sheet.widthMm / 2;
  arrow.setAttribute(
    'd',
    `M ${cx - 20} 70 L ${cx} 36 L ${cx + 20} 70 L ${cx + 8} 70 L ${cx + 8} 120 L ${cx - 8} 120 L ${cx - 8} 70 Z`,
  );
  arrow.setAttribute('fill', colour);
  arrow.setAttribute('opacity', '0.25');
  svg.append(arrow);

  const instructions = [
    side === 'front'
      ? 'This is the FRONT. Take the sheet out, follow the flip shown on screen, and reload it.'
      : 'This is the BACK. Compare where the word TOP sits on each side, then answer the question on screen.',
  ];
  let y = 140;
  for (const line of instructions) {
    const node = document.createElementNS(svgNs, 'text');
    node.setAttribute('x', String(sheet.widthMm / 2));
    node.setAttribute('y', String(y));
    node.setAttribute('font-size', '4');
    node.setAttribute('font-family', 'sans-serif');
    node.setAttribute('fill', '#171717');
    node.setAttribute('text-anchor', 'middle');
    node.textContent = line;
    svg.append(node);
    y += 7;
  }

  const footer = document.createElementNS(svgNs, 'text');
  footer.setAttribute('x', String(sheet.widthMm / 2));
  footer.setAttribute('y', String(sheet.heightMm - 12));
  footer.setAttribute('font-size', '6');
  footer.setAttribute('font-family', 'sans-serif');
  footer.setAttribute('font-weight', '700');
  footer.setAttribute('fill', colour);
  footer.setAttribute('text-anchor', 'middle');
  footer.textContent = `${side.toUpperCase()} · BOTTOM`;
  svg.append(footer);

  wrapper.append(svg);
  return wrapper;
}

/** Short human-readable summary of a setup, for the printer profile panel. */
export function describeSetup(setup: DuplexSetup): string {
  const motion = setup.flipMotion;
  const parts = [
    motion === 'left-right' ? 'turn left to right' : 'turn top to bottom',
    `reload printed side ${setup.reloadFace}`,
    `${setup.feedEdge === 'top-first' ? 'top' : 'bottom'} edge first`,
  ];
  if (setup.rotateStack) parts.splice(1, 0, 'rotate the stack 180°');
  return parts.join(', ');
}
