/**
 * Identifier generation.
 *
 * `crypto.randomUUID` is available in every browser PrintNest targets, but it
 * requires a secure context. The fallback keeps `npm run dev` over plain HTTP
 * on a phone working, and keeps the unit tests independent of the environment.
 */

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buffer);
  } else {
    for (let i = 0; i < bytes; i += 1) buffer[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomHex(8)}`;
}

export function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `prj_${randomHex(16)}`;
}
