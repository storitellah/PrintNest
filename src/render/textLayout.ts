/**
 * Text line breaking.
 *
 * Shared by the canvas exporter and the PDF exporter so a caption wraps at the
 * same word in a PNG as it does in a PDF. The browser handles wrapping itself
 * on screen, which can differ by a hair — the exporters are what must agree
 * with each other.
 *
 * `measure` returns the width of a string in the same units as `maxWidth`.
 */

export interface WrappedText {
  lines: string[];
  /** Width of the widest line, in the measuring unit. */
  maxLineWidth: number;
}

export function wrapText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): WrappedText {
  const lines: string[] = [];
  let maxLineWidth = 0;

  const pushLine = (line: string): void => {
    lines.push(line);
    maxLineWidth = Math.max(maxLineWidth, measure(line));
  };

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      pushLine('');
      continue;
    }

    const words = paragraph.split(/(\s+)/).filter((part) => part !== '');
    let current = '';

    for (const word of words) {
      const isSpace = /^\s+$/.test(word);
      const candidate = current + word;

      if (measure(candidate) <= maxWidth || current === '') {
        // A single word longer than the line has to be broken by character,
        // otherwise it would overflow the frame silently.
        if (current === '' && !isSpace && measure(word) > maxWidth) {
          let chunk = '';
          for (const character of word) {
            if (measure(chunk + character) > maxWidth && chunk !== '') {
              pushLine(chunk);
              chunk = character;
            } else {
              chunk += character;
            }
          }
          current = chunk;
          continue;
        }
        current = candidate;
      } else {
        pushLine(current.trimEnd());
        current = isSpace ? '' : word;
      }
    }

    pushLine(current.trimEnd());
  }

  return { lines, maxLineWidth };
}

/** Horizontal offset for a line given the block alignment. */
export function alignOffset(
  align: 'left' | 'center' | 'right' | 'justify',
  lineWidth: number,
  blockWidth: number,
): number {
  switch (align) {
    case 'center':
      return (blockWidth - lineWidth) / 2;
    case 'right':
      return blockWidth - lineWidth;
    default:
      return 0;
  }
}

/**
 * Extra space to insert between words to justify a line.
 * Returns 0 for the last line of a paragraph, which is never justified.
 */
export function justifySpacing(
  line: string,
  lineWidth: number,
  blockWidth: number,
  isLastLine: boolean,
): number {
  if (isLastLine) return 0;
  const gaps = (line.match(/\s+/g) ?? []).length;
  if (gaps === 0) return 0;
  return Math.max(0, (blockWidth - lineWidth) / gaps);
}
