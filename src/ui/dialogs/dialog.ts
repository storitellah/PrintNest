import { el } from '../dom.ts';
import { icon } from '../icons.ts';

/**
 * A thin wrapper over the native `<dialog>` element.
 *
 * Native dialogs give focus trapping, `Escape` to close, inert background and
 * a real top layer for free — all things a hand-rolled modal gets subtly
 * wrong. On mobile the same element is styled as a bottom sheet.
 */

export interface DialogOptions {
  title: string;
  subtitle?: string;
  /** Rendered into the scrolling body. */
  body: HTMLElement;
  /** Buttons for the footer, in reading order (primary last). */
  footer?: HTMLElement[];
  /** Called when the dialog closes for any reason. */
  onClose?: () => void;
  /** Wider dialog for the print and export flows. */
  wide?: boolean;
}

export interface DialogHandle {
  element: HTMLDialogElement;
  close: () => void;
  /** Replace the body without rebuilding the dialog — used by wizards. */
  setBody: (body: HTMLElement) => void;
  setFooter: (buttons: HTMLElement[]) => void;
  setTitle: (title: string, subtitle?: string) => void;
}

export function openDialog(options: DialogOptions): DialogHandle {
  const titleId = `pn-dialog-title-${Math.random().toString(36).slice(2, 8)}`;

  const titleNode = el('h2', { class: 'pn-dialog__title', id: titleId, text: options.title });
  const subtitleNode = el('p', {
    class: 'pn-dialog__subtitle',
    text: options.subtitle ?? '',
  });
  subtitleNode.hidden = !options.subtitle;

  const body = el('div', { class: 'pn-dialog__body' }, options.body);
  const footer = el('div', { class: 'pn-dialog__footer' }, ...(options.footer ?? []));

  const dialog = el(
    'dialog',
    {
      class: 'pn-dialog',
      'aria-labelledby': titleId,
      style: options.wide ? { width: 'min(900px, calc(100vw - 2rem))' } : {},
    },
    el(
      'div',
      { class: 'pn-dialog__header' },
      el('div', {}, titleNode, subtitleNode),
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn pn-btn--ghost pn-btn--icon',
          'aria-label': 'Close',
          onclick: () => dialog.close(),
        },
        icon('close', { size: 18 }),
      ),
    ),
    body,
    footer,
  ) as HTMLDialogElement;

  dialog.addEventListener('close', () => {
    options.onClose?.();
    dialog.remove();
  });

  // Clicking the backdrop closes — but only the backdrop, not the panel.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) dialog.close();
  });

  document.body.append(dialog);
  dialog.showModal();

  // Move focus to the first control rather than the close button.
  const firstControl = dialog.querySelector<HTMLElement>(
    '.pn-dialog__body input, .pn-dialog__body select, .pn-dialog__body textarea, .pn-dialog__body button',
  );
  firstControl?.focus();

  return {
    element: dialog,
    close: () => dialog.close(),
    setBody: (next) => body.replaceChildren(next),
    setFooter: (buttons) => footer.replaceChildren(...buttons),
    setTitle: (title, subtitle) => {
      titleNode.textContent = title;
      subtitleNode.textContent = subtitle ?? '';
      subtitleNode.hidden = !subtitle;
    },
  };
}

/** A yes/no confirmation. Resolves `true` when the user confirms. */
export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const handle = openDialog({
      title: options.title,
      body: el('p', { text: options.message, style: { lineHeight: '1.6' } }),
      footer: [
        el('button', {
          type: 'button',
          class: 'pn-btn',
          text: 'Cancel',
          onclick: () => handle.close(),
        }),
        el('button', {
          type: 'button',
          class: `pn-btn ${options.danger ? 'pn-btn--danger' : 'pn-btn--primary'}`,
          text: options.confirmLabel,
          onclick: () => {
            answered = true;
            handle.close();
            resolve(true);
          },
        }),
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

/** A single-line text prompt. Resolves `null` when cancelled. */
export function promptDialog(options: {
  title: string;
  label: string;
  value: string;
  confirmLabel?: string;
  maxLength?: number;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let answered = false;
    const input = el('input', {
      class: 'pn-input',
      value: options.value,
      maxlength: options.maxLength ?? 120,
      id: 'pn-prompt-input',
    });

    const submit = (): void => {
      answered = true;
      handle.close();
      resolve(input.value.trim());
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    const handle = openDialog({
      title: options.title,
      body: el(
        'div',
        { class: 'pn-field' },
        el('label', { class: 'pn-field__label', for: 'pn-prompt-input', text: options.label }),
        input,
      ),
      footer: [
        el('button', { type: 'button', class: 'pn-btn', text: 'Cancel', onclick: () => handle.close() }),
        el('button', {
          type: 'button',
          class: 'pn-btn pn-btn--primary',
          text: options.confirmLabel ?? 'Save',
          onclick: submit,
        }),
      ],
      onClose: () => {
        if (!answered) resolve(null);
      },
    });

    input.select();
  });
}
