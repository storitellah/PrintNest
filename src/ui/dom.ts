/**
 * DOM helpers.
 *
 * A deliberately tiny alternative to a framework. `el()` builds elements with
 * attributes, children and listeners in one call; nothing here ever assigns
 * `innerHTML`, so user content cannot become markup by accident.
 */

type Child = Node | string | number | null | undefined | false;

export interface ElementOptions {
  class?: string;
  text?: string;
  html?: never;
  /** Anything else is set as an attribute (or a property for `value`). */
  [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyOptions(node, options);
  append(node, children);
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function applyOptions(node: HTMLElement, options: ElementOptions): void {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value as Record<string, string>);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value as Partial<CSSStyleDeclaration>);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(
        key.slice(2).toLowerCase(),
        value as EventListener,
      );
    } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
      // These must be set as properties to take effect reliably.
      (node as unknown as Record<string, unknown>)[key] = value;
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

function append(node: Node, children: Child[]): void {
  for (const child of children.flat(4) as Child[]) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/**
 * `replaceChildren` that tolerates `null`/`false` entries, so callers can write
 * `setChildren(body, a, condition && b, c)` without filtering by hand.
 */
export function setChildren(node: Element, ...children: Child[]): void {
  node.replaceChildren();
  append(node, children);
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Attach a listener and get an unsubscriber back. */
export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K | string,
  handler: (event: never) => void,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
}

/* ------------------------------------------------------------------ *
 * Form controls
 * ------------------------------------------------------------------ */

export interface FieldOptions {
  label: string;
  hint?: string;
  id?: string;
}

let idCounter = 0;
export function uniqueId(prefix = 'pn'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** A labelled control with an optional hint, wired up for screen readers. */
export function field(options: FieldOptions, control: HTMLElement): HTMLElement {
  const id = options.id ?? uniqueId('field');
  control.id = id;
  const hintId = options.hint ? `${id}-hint` : undefined;
  if (hintId) control.setAttribute('aria-describedby', hintId);

  return el(
    'div',
    { class: 'pn-field' },
    el('label', { class: 'pn-field__label', for: id, text: options.label }),
    control,
    options.hint ? el('p', { class: 'pn-field__hint', id: hintId, text: options.hint }) : null,
  );
}

export interface NumberFieldOptions extends FieldOptions {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onInput: (value: number) => void;
}

export function numberField(options: NumberFieldOptions): HTMLElement {
  const input = el('input', {
    class: 'pn-input pn-input--number',
    type: 'number',
    value: String(round(options.value)),
    min: options.min,
    max: options.max,
    step: options.step ?? 1,
    inputmode: 'decimal',
    onchange: (event: Event) => {
      const target = event.target as HTMLInputElement;
      const parsed = Number.parseFloat(target.value);
      if (!Number.isFinite(parsed)) {
        target.value = String(round(options.value));
        return;
      }
      const clamped = clampValue(parsed, options.min, options.max);
      target.value = String(round(clamped));
      options.onInput(clamped);
    },
  });
  return field(options, input);
}

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

export interface SelectFieldOptions extends FieldOptions {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export function selectField(options: SelectFieldOptions): HTMLElement {
  const select = el('select', {
    class: 'pn-select',
    onchange: (event: Event) => options.onChange((event.target as HTMLSelectElement).value),
  });

  const groups = new Map<string, HTMLOptGroupElement>();
  for (const option of options.options) {
    const node = el('option', {
      value: option.value,
      text: option.label,
      selected: option.value === options.value,
      disabled: option.disabled,
    });
    if (option.group) {
      let group = groups.get(option.group);
      if (!group) {
        group = el('optgroup', { label: option.group });
        groups.set(option.group, group);
        select.append(group);
      }
      group.append(node);
    } else {
      select.append(node);
    }
  }

  select.value = options.value;
  return field(options, select);
}

export interface CheckboxOptions {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function checkbox(options: CheckboxOptions): HTMLElement {
  const input = el('input', {
    type: 'checkbox',
    checked: options.checked,
    disabled: options.disabled,
    onchange: (event: Event) => options.onChange((event.target as HTMLInputElement).checked),
  });
  return el(
    'label',
    { class: 'pn-checkbox' },
    input,
    el(
      'span',
      { class: 'pn-checkbox__text' },
      el('span', { text: options.label }),
      options.note ? el('span', { class: 'pn-checkbox__note', text: options.note }) : null,
    ),
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/**
 * A radio group presented as a segmented control. Uses `role="radiogroup"` so
 * arrow keys work and the current choice is announced.
 */
export function segmented<T extends string>(
  label: string,
  value: T,
  options: SegmentOption<T>[],
  onChange: (value: T) => void,
): HTMLElement {
  const group = el('div', { class: 'pn-segment', role: 'radiogroup', 'aria-label': label });
  const buttons: HTMLButtonElement[] = [];

  options.forEach((option, index) => {
    const button = el('button', {
      type: 'button',
      class: 'pn-segment__option',
      role: 'radio',
      'aria-checked': String(option.value === value),
      tabindex: option.value === value ? '0' : '-1',
      title: option.title,
      text: option.label,
      onclick: () => onChange(option.value),
      onkeydown: (event: KeyboardEvent) => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (delta === 0) return;
        event.preventDefault();
        const next = options[(index + delta + options.length) % options.length]!;
        onChange(next.value);
        // Focus follows selection, which is the expected radio behaviour.
        queueMicrotask(() => buttons[options.indexOf(next)]?.focus());
      },
    });
    buttons.push(button);
    group.append(button);
  });

  return group;
}

export interface SliderOptions extends FieldOptions {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}

export function slider(options: SliderOptions): HTMLElement {
  const readout = el('span', {
    class: 'pn-field__hint',
    text: (options.format ?? String)(options.value),
  });
  const input = el('input', {
    class: 'pn-range',
    type: 'range',
    value: String(options.value),
    min: options.min,
    max: options.max,
    step: options.step,
    oninput: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      readout.textContent = (options.format ?? String)(next);
      options.onInput(next);
    },
  });
  const wrapper = field({ label: options.label, hint: options.hint, id: options.id }, input);
  wrapper.append(readout);
  return wrapper;
}

/** A collapsible settings section. */
export function section(
  title: string,
  content: () => HTMLElement,
  options: { open?: boolean; id?: string } = {},
): HTMLElement {
  const bodyId = uniqueId('section-body');
  const body = el('div', { class: 'pn-section__body', id: bodyId });
  let open = options.open ?? true;

  const header = el(
    'button',
    {
      type: 'button',
      class: 'pn-section__header',
      'aria-expanded': String(open),
      'aria-controls': bodyId,
      onclick: () => {
        open = !open;
        header.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        if (open && body.childElementCount === 0) body.append(content());
      },
    },
    el('span', { text: title }),
    chevron(),
  );

  body.hidden = !open;
  if (open) body.append(content());

  return el('div', { class: 'pn-section', id: options.id }, header, body);
}

function chevron(): SVGElement {
  return svg(
    'svg',
    { class: 'pn-section__chevron', viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
    svg('path', {
      d: 'M6 3.5 10.5 8 6 12.5',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function clampValue(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Trap focus inside a container while a dialog is open. Native `<dialog>`
 * already does this in modern browsers; this covers the non-modal panels.
 */
export function trapFocus(container: HTMLElement): () => void {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = qsa<HTMLElement>(selector, container).filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/** Debounce that keeps the latest arguments. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/** Run at most once per animation frame — used by the drag handlers. */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let queued = false;
  let latest: A;
  return (...args: A) => {
    latest = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...latest);
    });
  };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Add a decorative animation class, skipping it when motion is reduced. */
export function animate(node: HTMLElement, className: string, durationMs = 900): void {
  if (prefersReducedMotion()) return;
  node.classList.add(className);
  setTimeout(() => node.classList.remove(className), durationMs);
}
