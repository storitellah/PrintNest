import { el } from './dom.ts';
import { icon } from './icons.ts';

/**
 * Transient messages.
 *
 * Rendered into an `aria-live` region so screen readers announce them without
 * stealing focus. Errors use `assertive`; everything else is `polite`.
 */

export type ToastKind = 'info' | 'success' | 'error';

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container?.isConnected) return container;
  container = el('div', {
    class: 'pn-toasts',
    id: 'pn-toasts',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'false',
  });
  document.body.append(container);
  return container;
}

export interface ToastOptions {
  title: string;
  detail?: string;
  kind?: ToastKind;
  /** Milliseconds before it disappears. 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export function toast(options: ToastOptions): () => void {
  const host = ensureContainer();
  const kind = options.kind ?? 'info';
  const duration = options.duration ?? (kind === 'error' ? 9000 : 4500);

  const node = el(
    'div',
    { class: `pn-toast pn-toast--${kind}` },
    icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info', {
      size: 18,
      class: 'pn-note__icon',
    }),
    el(
      'div',
      { class: 'pn-toast__body' },
      el('div', { class: 'pn-toast__title', text: options.title }),
      options.detail ? el('div', { class: 'pn-toast__detail', text: options.detail }) : null,
      options.action
        ? el('button', {
            type: 'button',
            class: 'pn-btn pn-btn--sm pn-btn--ghost',
            text: options.action.label,
            style: { marginTop: '6px', paddingLeft: '0' },
            onclick: () => {
              options.action?.onClick();
              dismiss();
            },
          })
        : null,
    ),
    el('button', {
      type: 'button',
      class: 'pn-btn pn-btn--sm pn-btn--ghost pn-btn--icon',
      'aria-label': 'Dismiss this message',
      onclick: () => dismiss(),
    }, icon('close', { size: 16 })),
  );

  // An error must interrupt; routine confirmations must not.
  host.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  host.append(node);

  let timer: ReturnType<typeof setTimeout> | null =
    duration > 0 ? setTimeout(() => dismiss(), duration) : null;

  function dismiss(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    node.remove();
  }

  return dismiss;
}

export function toastError(error: unknown, fallback = 'Something went wrong.'): void {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  toast({ title: message, kind: 'error' });
}

/**
 * A persistent progress toast for long operations — PDF export, large imports.
 * Returns handles to update and finish it.
 */
export function progressToast(title: string): {
  update: (fraction: number, label?: string) => void;
  done: (message?: string) => void;
  fail: (message: string) => void;
} {
  const host = ensureContainer();
  const bar = el('div', { class: 'pn-progress__bar', style: { width: '0%' } });
  const label = el('div', { class: 'pn-toast__detail', text: 'Starting…' });

  const node = el(
    'div',
    { class: 'pn-toast pn-toast--info' },
    inkDrop(),
    el(
      'div',
      { class: 'pn-toast__body' },
      el('div', { class: 'pn-toast__title', text: title }),
      label,
      el(
        'div',
        { class: 'pn-progress', style: { marginTop: '6px' } },
        el('div', { class: 'pn-progress__track', role: 'progressbar', 'aria-label': title, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar),
      ),
    ),
  );
  host.append(node);

  const track = node.querySelector('.pn-progress__track');

  return {
    update(fraction, text) {
      const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      bar.style.width = `${percent}%`;
      track?.setAttribute('aria-valuenow', String(percent));
      if (text) label.textContent = text;
    },
    done(message) {
      node.remove();
      toast({ title: message ?? `${title} finished`, kind: 'success' });
    },
    fail(message) {
      node.remove();
      toast({ title: message, kind: 'error' });
    },
  };
}

/** A small ink drop that fills as a job progresses. */
function inkDrop(): HTMLElement {
  const wrapper = el('div', { class: 'pn-inkdrop', 'aria-hidden': 'true' });
  wrapper.append(icon('ink', { size: 22 }));
  return wrapper;
}
