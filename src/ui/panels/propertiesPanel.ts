import {
  PAPER_GROUP_LABELS,
  PAPER_SIZES,
  getPaperSize,
  resolveSheet,
  subdivideSheet,
  uniformMargins,
} from '../../core/paper.ts';
import { estimateInk } from '../../core/ink.ts';
import { buildSuggestions } from '../../core/layoutAssistant.ts';
import { createPageNumberElement, createShapeElement, createTextElement } from '../../core/project.ts';
import { assessImageElement, qualityShorthand } from '../../core/resolution.ts';
import { store } from '../../core/store.ts';
import type { ImageElement, PageElement, ShapeElement, TextElement } from '../../core/types.ts';
import { formatLength, fromMm, toMm } from '../../core/units.ts';
import type { LengthUnit } from '../../core/units.ts';
import {
  alignSelection,
  changeLayerOrder,
} from '../editorInteractions.ts';
import { checkbox, el, field, numberField, section, segmented, selectField, slider } from '../dom.ts';
import { icon } from '../icons.ts';
import { toast } from '../toast.ts';

/**
 * Right panel.
 *
 * Two modes, chosen by what is selected:
 *   - something selected → element properties
 *   - nothing selected   → document settings (paper, layout, marks, ink)
 *
 * Every numeric field shows the project's chosen unit, and every value is
 * stored in millimetres regardless.
 */

export interface PropertiesPanel {
  root: HTMLElement;
  render: () => void;
  destroy: () => void;
}

export function createPropertiesPanel(): PropertiesPanel {
  const body = el('div');
  const title = el('div', { class: 'pn-panel__title', text: 'Settings' });
  const root = el(
    'aside',
    { class: 'pn-panel pn-panel--right', 'aria-label': 'Properties and settings' },
    title,
    body,
  );

  function render(): void {
    const project = store.project;
    body.replaceChildren();
    if (!project) return;

    const selected = store.selectedElements;
    if (selected.length > 0) {
      title.textContent = selected.length === 1 ? elementTitle(selected[0]!) : `${selected.length} items`;
      body.append(renderElementProperties(selected));
      return;
    }

    title.textContent = 'Document';
    body.append(renderDocumentSettings());
  }

  const unsubscribe = store.subscribe(render);
  render();

  return { root, render, destroy: unsubscribe };
}

function elementTitle(element: PageElement): string {
  switch (element.type) {
    case 'image':
      return element.assetId ? 'Image' : 'Empty photo frame';
    case 'text':
      return 'Text';
    case 'shape':
      return element.shape === 'line' ? 'Line' : element.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
    case 'page-number':
      return 'Page number';
  }
}

/* ------------------------------------------------------------------ *
 * Element properties
 * ------------------------------------------------------------------ */

function unit(): LengthUnit {
  return store.project?.settings.unit ?? 'mm';
}

function editSelection(mutate: (element: PageElement) => void, label: string): void {
  const ids = new Set(store.ui.selection.elementIds);
  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      let touched = false;
      for (const element of page.elements) {
        if (!ids.has(element.id)) continue;
        mutate(element);
        touched = true;
      }
      return touched ? undefined : false;
    },
    { label, coalesce: true },
  );
}

function renderElementProperties(selected: PageElement[]): HTMLElement {
  const container = el('div');
  const first = selected[0]!;
  const u = unit();

  container.append(
    section('Position and size', () => {
      const grid = el('div');
      grid.append(
        el(
          'div',
          { class: 'pn-row' },
          numberField({
            label: `X (${u})`,
            value: fromMm(first.xMm, u),
            step: u === 'mm' ? 0.5 : 0.1,
            onInput: (value) => editSelection((element) => void (element.xMm = toMm(value, u)), 'set-x'),
          }),
          numberField({
            label: `Y (${u})`,
            value: fromMm(first.yMm, u),
            step: u === 'mm' ? 0.5 : 0.1,
            onInput: (value) => editSelection((element) => void (element.yMm = toMm(value, u)), 'set-y'),
          }),
        ),
        el(
          'div',
          { class: 'pn-row' },
          numberField({
            label: `Width (${u})`,
            value: fromMm(first.widthMm, u),
            min: 0.1,
            step: u === 'mm' ? 0.5 : 0.1,
            onInput: (value) =>
              editSelection((element) => void (element.widthMm = Math.max(1, toMm(value, u))), 'set-w'),
          }),
          numberField({
            label: `Height (${u})`,
            value: fromMm(first.heightMm, u),
            min: 0.1,
            step: u === 'mm' ? 0.5 : 0.1,
            onInput: (value) =>
              editSelection((element) => void (element.heightMm = Math.max(1, toMm(value, u))), 'set-h'),
          }),
        ),
        numberField({
          label: 'Rotation (degrees)',
          value: first.rotation,
          min: -360,
          max: 360,
          step: 1,
          onInput: (value) => editSelection((element) => void (element.rotation = value), 'set-rotation'),
        }),
        slider({
          label: 'Opacity',
          value: Math.round(first.opacity * 100),
          min: 10,
          max: 100,
          step: 5,
          format: (value) => `${value}%`,
          onInput: (value) => editSelection((element) => void (element.opacity = value / 100), 'set-opacity'),
        }),
        alignmentControls(),
        layerControls(),
        el(
          'div',
          { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
          checkbox({
            label: 'Lock',
            checked: first.locked,
            onChange: (checked) => editSelection((element) => void (element.locked = checked), 'lock'),
          }),
          checkbox({
            label: 'Hide',
            checked: first.hidden,
            onChange: (checked) => editSelection((element) => void (element.hidden = checked), 'hide'),
          }),
        ),
      );
      return grid;
    }),
  );

  if (first.type === 'image') {
    container.append(section('Image', () => imageProperties(first)));
  }
  if (first.type === 'text') {
    container.append(section('Text', () => textProperties(first)));
  }
  if (first.type === 'shape') {
    container.append(section('Shape', () => shapeProperties(first)));
  }
  if (first.type === 'page-number') {
    container.append(
      section('Numbering', () =>
        el(
          'div',
          {},
          field(
            { label: 'Format', hint: 'Use {n} for the page number and {total} for the page count.' },
            el('input', {
              class: 'pn-input',
              value: first.format,
              onchange: (event: Event) =>
                editSelection(
                  (element) =>
                    void (element.type === 'page-number' &&
                      (element.format = (event.target as HTMLInputElement).value)),
                  'set-number-format',
                ),
            }),
          ),
          numberField({
            label: 'Start at',
            value: first.startAt,
            min: 0,
            step: 1,
            onInput: (value) =>
              editSelection(
                (element) => void (element.type === 'page-number' && (element.startAt = Math.round(value))),
                'set-number-start',
              ),
          }),
        ),
      ),
    );
  }

  container.append(
    el(
      'div',
      { style: { padding: '1rem' } },
      el(
        'button',
        {
          type: 'button',
          class: 'pn-btn pn-btn--danger pn-btn--block',
          onclick: () => deleteSelection(),
        },
        icon('trash', { size: 16 }),
        `Delete ${selected.length === 1 ? 'item' : `${selected.length} items`}`,
      ),
    ),
  );

  return container;
}

function alignmentControls(): HTMLElement {
  const row = (label: string, modes: { mode: Parameters<typeof alignSelection>[0]; label: string }[]): HTMLElement =>
    el(
      'div',
      { class: 'pn-field' },
      el('span', { class: 'pn-field__label', text: label }),
      el(
        'div',
        { class: 'pn-segment', role: 'group', 'aria-label': label },
        ...modes.map((entry) =>
          el('button', {
            type: 'button',
            class: 'pn-segment__option',
            text: entry.label,
            onclick: () => alignSelection(entry.mode),
          }),
        ),
      ),
    );

  return el(
    'div',
    {},
    row('Align horizontally', [
      { mode: 'left', label: 'Left' },
      { mode: 'centre-x', label: 'Centre' },
      { mode: 'right', label: 'Right' },
      { mode: 'distribute-x', label: 'Spread' },
    ]),
    row('Align vertically', [
      { mode: 'top', label: 'Top' },
      { mode: 'centre-y', label: 'Middle' },
      { mode: 'bottom', label: 'Bottom' },
      { mode: 'distribute-y', label: 'Spread' },
    ]),
  );
}

function layerControls(): HTMLElement {
  return el(
    'div',
    { class: 'pn-field' },
    el('span', { class: 'pn-field__label', text: 'Layer order' }),
    el(
      'div',
      { class: 'pn-segment', role: 'group', 'aria-label': 'Layer order' },
      ...(
        [
          ['back', 'To back'],
          ['backward', 'Back'],
          ['forward', 'Forward'],
          ['front', 'To front'],
        ] as const
      ).map(([direction, label]) =>
        el('button', {
          type: 'button',
          class: 'pn-segment__option',
          text: label,
          onclick: () => changeLayerOrder(direction),
        }),
      ),
    ),
  );
}

function imageProperties(element: ImageElement): HTMLElement {
  const project = store.project!;
  const asset = project.assets.find((entry) => entry.id === element.assetId);
  const assessment = assessImageElement(element, asset);
  const container = el('div');

  if (assessment) {
    container.append(
      el(
        'div',
        { class: `pn-note pn-note--${assessment.level === 'low' ? 'error' : assessment.level === 'acceptable' ? 'warn' : 'success'}` },
        icon(assessment.level === 'low' ? 'alert' : 'check', { size: 18, class: 'pn-note__icon' }),
        el(
          'div',
          {},
          el('strong', { text: `${qualityShorthand(assessment.level)} · ${assessment.dpi} dpi` }),
          el('div', { style: { marginTop: '2px', fontSize: '0.75rem' }, text: assessment.advice }),
        ),
      ),
    );
  }

  container.append(
    el('div', { style: { height: '0.75rem' } }),
    field(
      { label: 'Fit', hint: 'Fit shows the whole picture. Fill crops it to the frame. Actual size prints at 300 dots per inch.' },
      segmented<ImageElement['fit']>(
        'Image fit',
        element.fit,
        [
          { value: 'fit', label: 'Fit' },
          { value: 'fill', label: 'Fill' },
          { value: 'stretch', label: 'Stretch' },
          { value: 'actual', label: 'Actual' },
          { value: 'custom', label: 'Scale' },
        ],
        (value) => editSelection((entry) => void (entry.type === 'image' && (entry.fit = value)), 'set-fit'),
      ),
    ),
  );

  if (element.fit === 'custom') {
    container.append(
      slider({
        label: 'Scale',
        value: Math.round(element.scale * 100),
        min: 10,
        max: 400,
        step: 5,
        format: (value) => `${value}%`,
        onInput: (value) =>
          editSelection((entry) => void (entry.type === 'image' && (entry.scale = value / 100)), 'set-scale'),
      }),
    );
  }

  container.append(
    el(
      'div',
      { class: 'pn-field' },
      el('span', { class: 'pn-field__label', text: 'Rotate and flip' }),
      el(
        'div',
        { class: 'pn-segment', role: 'group', 'aria-label': 'Rotate and flip the picture inside its frame' },
        el(
          'button',
          {
            type: 'button',
            class: 'pn-segment__option',
            'aria-label': 'Rotate the picture 90 degrees',
            onclick: () =>
              editSelection((entry) => {
                if (entry.type !== 'image') return;
                entry.imageRotation = ((entry.imageRotation + 90) % 360) as 0 | 90 | 180 | 270;
              }, 'rotate-image'),
          },
          icon('rotate', { size: 15 }),
        ),
        el('button', {
          type: 'button',
          class: 'pn-segment__option',
          text: 'Flip ↔',
          'aria-pressed': String(element.flipH),
          onclick: () =>
            editSelection((entry) => void (entry.type === 'image' && (entry.flipH = !entry.flipH)), 'flip-h'),
        }),
        el('button', {
          type: 'button',
          class: 'pn-segment__option',
          text: 'Flip ↕',
          'aria-pressed': String(element.flipV),
          onclick: () =>
            editSelection((entry) => void (entry.type === 'image' && (entry.flipV = !entry.flipV)), 'flip-v'),
        }),
      ),
    ),
    numberField({
      label: `Border (${unit()})`,
      value: fromMm(element.borderMm, unit()),
      min: 0,
      step: 0.5,
      onInput: (value) =>
        editSelection(
          (entry) => void (entry.type === 'image' && (entry.borderMm = toMm(value, unit()))),
          'set-border',
        ),
    }),
    field(
      { label: 'Border colour' },
      el('input', {
        class: 'pn-color',
        type: 'color',
        value: element.borderColor,
        oninput: (event: Event) =>
          editSelection(
            (entry) =>
              void (entry.type === 'image' && (entry.borderColor = (event.target as HTMLInputElement).value)),
            'set-border-colour',
          ),
      }),
    ),
    numberField({
      label: `Corner radius (${unit()})`,
      value: fromMm(element.cornerRadiusMm, unit()),
      min: 0,
      step: 0.5,
      onInput: (value) =>
        editSelection(
          (entry) => void (entry.type === 'image' && (entry.cornerRadiusMm = toMm(value, unit()))),
          'set-radius',
        ),
    }),
    field(
      { label: 'Caption', hint: 'Also used as the alternative text for this picture.' },
      el('textarea', {
        class: 'pn-textarea',
        value: element.caption,
        rows: '2',
        onchange: (event: Event) =>
          editSelection(
            (entry) =>
              void (entry.type === 'image' && (entry.caption = (event.target as HTMLTextAreaElement).value)),
            'set-caption',
          ),
      }),
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'pn-btn pn-btn--sm pn-btn--block',
        title: 'Resize the frame so the whole picture fits with no empty space',
        onclick: () => fitFrameToImage(),
      },
      'Fit frame to picture',
    ),
  );

  if (asset) {
    container.append(
      el('p', {
        class: 'pn-field__hint',
        style: { marginTop: '0.75rem' },
        text: `${asset.name} · ${asset.widthPx} × ${asset.heightPx} px · printed at ${formatLength(element.widthMm, unit())} wide`,
      }),
    );
  }

  return container;
}

function textProperties(element: TextElement): HTMLElement {
  return el(
    'div',
    {},
    field(
      { label: 'Text' },
      el('textarea', {
        class: 'pn-textarea',
        rows: '6',
        value: element.text,
        onchange: (event: Event) =>
          editSelection(
            (entry) => void (entry.type === 'text' && (entry.text = (event.target as HTMLTextAreaElement).value)),
            'set-text',
          ),
      }),
    ),
    selectField({
      label: 'Font',
      value: element.font,
      options: [
        { value: 'serif', label: 'Editorial serif' },
        { value: 'sans', label: 'Clean sans-serif' },
        { value: 'mono', label: 'Monospace' },
      ],
      onChange: (value) =>
        editSelection(
          (entry) => void (entry.type === 'text' && (entry.font = value as TextElement['font'])),
          'set-font',
        ),
    }),
    el(
      'div',
      { class: 'pn-row' },
      numberField({
        label: 'Size (pt)',
        value: element.sizePt,
        min: 3,
        max: 400,
        step: 0.5,
        onInput: (value) =>
          editSelection((entry) => void (entry.type === 'text' && (entry.sizePt = value)), 'set-size'),
      }),
      numberField({
        label: 'Line height',
        value: element.lineHeight,
        min: 0.7,
        max: 4,
        step: 0.05,
        onInput: (value) =>
          editSelection((entry) => void (entry.type === 'text' && (entry.lineHeight = value)), 'set-leading'),
      }),
    ),
    slider({
      label: 'Letter spacing',
      value: Math.round(element.letterSpacing * 100),
      min: -10,
      max: 40,
      step: 1,
      format: (value) => `${value / 100}em`,
      onInput: (value) =>
        editSelection(
          (entry) => void (entry.type === 'text' && (entry.letterSpacing = value / 100)),
          'set-tracking',
        ),
    }),
    field(
      { label: 'Alignment' },
      segmented<TextElement['align']>(
        'Text alignment',
        element.align,
        [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
          { value: 'justify', label: 'Justify' },
        ],
        (value) =>
          editSelection((entry) => void (entry.type === 'text' && (entry.align = value)), 'set-align'),
      ),
    ),
    el(
      'div',
      { class: 'pn-field' },
      el('span', { class: 'pn-field__label', text: 'Style' }),
      el(
        'div',
        { class: 'pn-segment', role: 'group', 'aria-label': 'Text style' },
        el('button', {
          type: 'button',
          class: 'pn-segment__option',
          text: 'Bold',
          'aria-pressed': String(element.bold),
          onclick: () =>
            editSelection((entry) => void (entry.type === 'text' && (entry.bold = !entry.bold)), 'bold'),
        }),
        el('button', {
          type: 'button',
          class: 'pn-segment__option',
          text: 'Italic',
          'aria-pressed': String(element.italic),
          onclick: () =>
            editSelection((entry) => void (entry.type === 'text' && (entry.italic = !entry.italic)), 'italic'),
        }),
        el('button', {
          type: 'button',
          class: 'pn-segment__option',
          text: 'CAPS',
          'aria-pressed': String(element.uppercase),
          onclick: () =>
            editSelection(
              (entry) => void (entry.type === 'text' && (entry.uppercase = !entry.uppercase)),
              'caps',
            ),
        }),
      ),
    ),
    el(
      'div',
      { class: 'pn-row' },
      numberField({
        label: 'Columns',
        value: element.columns,
        min: 1,
        max: 6,
        step: 1,
        onInput: (value) =>
          editSelection(
            (entry) => void (entry.type === 'text' && (entry.columns = Math.round(value))),
            'set-columns',
          ),
      }),
      numberField({
        label: `Gap (${unit()})`,
        value: fromMm(element.columnGapMm, unit()),
        min: 0,
        step: 0.5,
        onInput: (value) =>
          editSelection(
            (entry) => void (entry.type === 'text' && (entry.columnGapMm = toMm(value, unit()))),
            'set-column-gap',
          ),
      }),
    ),
    field(
      { label: 'Colour' },
      el('input', {
        class: 'pn-color',
        type: 'color',
        value: element.color,
        oninput: (event: Event) =>
          editSelection(
            (entry) => void (entry.type === 'text' && (entry.color = (event.target as HTMLInputElement).value)),
            'set-colour',
          ),
      }),
    ),
  );
}

function shapeProperties(element: ShapeElement): HTMLElement {
  return el(
    'div',
    {},
    field(
      { label: 'Shape' },
      segmented<ShapeElement['shape']>(
        'Shape kind',
        element.shape,
        [
          { value: 'rect', label: 'Rectangle' },
          { value: 'ellipse', label: 'Ellipse' },
          { value: 'line', label: 'Line' },
        ],
        (value) =>
          editSelection((entry) => void (entry.type === 'shape' && (entry.shape = value)), 'set-shape'),
      ),
    ),
    checkbox({
      label: 'Filled',
      checked: element.fill !== null,
      onChange: (checked) =>
        editSelection(
          (entry) => void (entry.type === 'shape' && (entry.fill = checked ? '#D9D5CE' : null)),
          'toggle-fill',
        ),
    }),
    element.fill
      ? field(
          { label: 'Fill colour' },
          el('input', {
            class: 'pn-color',
            type: 'color',
            value: element.fill,
            oninput: (event: Event) =>
              editSelection(
                (entry) =>
                  void (entry.type === 'shape' && (entry.fill = (event.target as HTMLInputElement).value)),
                'set-fill',
              ),
          }),
        )
      : null,
    numberField({
      label: `Line thickness (${unit()})`,
      value: fromMm(element.strokeMm, unit()),
      min: 0,
      step: 0.1,
      onInput: (value) =>
        editSelection(
          (entry) => void (entry.type === 'shape' && (entry.strokeMm = toMm(value, unit()))),
          'set-stroke',
        ),
    }),
    field(
      { label: 'Line colour' },
      el('input', {
        class: 'pn-color',
        type: 'color',
        value: element.stroke ?? '#171717',
        oninput: (event: Event) =>
          editSelection(
            (entry) =>
              void (entry.type === 'shape' && (entry.stroke = (event.target as HTMLInputElement).value)),
            'set-stroke-colour',
          ),
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Document settings
 * ------------------------------------------------------------------ */

function renderDocumentSettings(): HTMLElement {
  const project = store.project!;
  const container = el('div');
  const u = unit();

  container.append(
    section('Paper', () => {
      const paperOptions = PAPER_SIZES.map((paper) => ({
        value: paper.id,
        label: paper.note ? `${paper.name} — ${paper.note}` : paper.name,
        group: PAPER_GROUP_LABELS[paper.group],
      }));
      paperOptions.push({ value: 'custom', label: 'Custom size', group: PAPER_GROUP_LABELS.custom });

      const sheet = resolveSheet(
        { widthMm: project.paper.widthMm, heightMm: project.paper.heightMm },
        project.paper.orientation,
      );

      return el(
        'div',
        {},
        selectField({
          label: 'Paper size',
          value: project.paper.sizeId,
          options: paperOptions,
          onChange: (value) => setPaper(value),
        }),
        project.paper.sizeId === 'custom'
          ? el(
              'div',
              { class: 'pn-row' },
              numberField({
                label: `Width (${u})`,
                value: fromMm(project.paper.widthMm, u),
                min: 10,
                step: 1,
                onInput: (value) =>
                  store.update((draft) => void (draft.paper.widthMm = toMm(value, u)), { label: 'paper-w' }),
              }),
              numberField({
                label: `Height (${u})`,
                value: fromMm(project.paper.heightMm, u),
                min: 10,
                step: 1,
                onInput: (value) =>
                  store.update((draft) => void (draft.paper.heightMm = toMm(value, u)), { label: 'paper-h' }),
              }),
            )
          : null,
        field(
          { label: 'Orientation' },
          segmented(
            'Paper orientation',
            project.paper.orientation,
            [
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ],
            (value) =>
              store.update(
                (draft) => {
                  draft.paper.orientation = value;
                },
                { label: 'orientation' },
              ),
          ),
        ),
        selectField({
          label: 'Measurement unit',
          value: u,
          options: [
            { value: 'mm', label: 'Millimetres' },
            { value: 'cm', label: 'Centimetres' },
            { value: 'in', label: 'Inches' },
            { value: 'pt', label: 'Points' },
            { value: 'px', label: 'Pixels (at 96 dpi)' },
          ],
          onChange: (value) =>
            store.update((draft) => void (draft.settings.unit = value as LengthUnit), { label: 'unit' }),
        }),
        el('p', {
          class: 'pn-field__hint',
          text: `Sheet: ${formatLength(sheet.widthMm, u)} × ${formatLength(sheet.heightMm, u)}`,
        }),
      );
    }),

    section('Page size and margins', () =>
      el(
        'div',
        {},
        el(
          'div',
          { class: 'pn-row' },
          numberField({
            label: `Page width (${u})`,
            value: fromMm(project.pageWidthMm, u),
            min: 5,
            step: 1,
            onInput: (value) =>
              store.update((draft) => void (draft.pageWidthMm = toMm(value, u)), { label: 'page-w' }),
          }),
          numberField({
            label: `Page height (${u})`,
            value: fromMm(project.pageHeightMm, u),
            min: 5,
            step: 1,
            onInput: (value) =>
              store.update((draft) => void (draft.pageHeightMm = toMm(value, u)), { label: 'page-h' }),
          }),
        ),
        el(
          'div',
          { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' } },
          el('button', {
            type: 'button',
            class: 'pn-btn pn-btn--sm',
            text: 'Match the sheet',
            onclick: () => matchPageToSheet(1),
          }),
          el('button', {
            type: 'button',
            class: 'pn-btn pn-btn--sm',
            text: 'Half the sheet',
            onclick: () => matchPageToSheet(2),
          }),
          el('button', {
            type: 'button',
            class: 'pn-btn pn-btn--sm',
            text: 'A quarter',
            onclick: () => matchPageToSheet(4),
          }),
        ),
        el(
          'div',
          { class: 'pn-row' },
          numberField({
            label: `Top (${u})`,
            value: fromMm(project.margins.topMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.margins.topMm = toMm(value, u)), { label: 'margin-t' }),
          }),
          numberField({
            label: `Bottom (${u})`,
            value: fromMm(project.margins.bottomMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.margins.bottomMm = toMm(value, u)), { label: 'margin-b' }),
          }),
        ),
        el(
          'div',
          { class: 'pn-row' },
          numberField({
            label: `Left (${u})`,
            value: fromMm(project.margins.leftMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.margins.leftMm = toMm(value, u)), { label: 'margin-l' }),
          }),
          numberField({
            label: `Right (${u})`,
            value: fromMm(project.margins.rightMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.margins.rightMm = toMm(value, u)), { label: 'margin-r' }),
          }),
        ),
        el('button', {
          type: 'button',
          class: 'pn-btn pn-btn--sm pn-btn--block',
          text: 'Make all margins equal',
          onclick: () =>
            store.update((draft) => void (draft.margins = uniformMargins(draft.margins.topMm)), {
              label: 'margins-equal',
            }),
        }),
      ),
    ),

    section(
      'Layout and binding',
      () =>
        el(
          'div',
          {},
          selectField({
            label: 'Binding',
            value: project.settings.imposition.binding,
            options: [
              { value: 'none', label: 'None — one page per sheet' },
              { value: 'saddle-stitch', label: 'Saddle stitch — fold and staple' },
              { value: 'perfect-bound', label: 'Perfect bound — cut, stack and glue' },
              { value: 'mini-zine-8', label: 'Eight-page mini zine' },
              { value: 'accordion', label: 'Accordion fold' },
              { value: 'gatefold', label: 'Gatefold' },
            ],
            onChange: (value) =>
              store.update(
                (draft) => {
                  draft.settings.imposition.binding = value as never;
                },
                { label: 'binding' },
              ),
          }),
          project.settings.imposition.binding === 'saddle-stitch'
            ? selectField({
                label: 'Signature size',
                hint: 'How many pages are folded together as one bundle.',
                value: String(project.settings.imposition.signatureSize),
                options: [
                  { value: '0', label: 'One signature for the whole book' },
                  { value: '4', label: '4 pages' },
                  { value: '8', label: '8 pages' },
                  { value: '12', label: '12 pages' },
                  { value: '16', label: '16 pages' },
                  { value: '24', label: '24 pages' },
                  { value: '32', label: '32 pages' },
                ],
                onChange: (value) =>
                  store.update(
                    (draft) => void (draft.settings.imposition.signatureSize = Number(value)),
                    { label: 'signature' },
                  ),
              })
            : null,
          project.settings.imposition.binding === 'none'
            ? el(
                'div',
                { class: 'pn-row' },
                numberField({
                  label: 'Columns',
                  value: project.settings.nUp.columns,
                  min: 1,
                  max: 12,
                  step: 1,
                  onInput: (value) =>
                    store.update((draft) => void (draft.settings.nUp.columns = Math.round(value)), {
                      label: 'nup-cols',
                    }),
                }),
                numberField({
                  label: 'Rows',
                  value: project.settings.nUp.rows,
                  min: 1,
                  max: 12,
                  step: 1,
                  onInput: (value) =>
                    store.update((draft) => void (draft.settings.nUp.rows = Math.round(value)), {
                      label: 'nup-rows',
                    }),
                }),
              )
            : null,
          checkbox({
            label: 'Cut guides between pieces',
            checked: project.settings.nUp.cutMarks,
            onChange: (checked) =>
              store.update((draft) => void (draft.settings.nUp.cutMarks = checked), { label: 'cut-marks' }),
          }),
          field(
            { label: 'Sides' },
            segmented(
              'Printing sides',
              project.settings.imposition.duplex,
              [
                { value: 'single-sided', label: 'One side' },
                { value: 'auto-duplex', label: 'Automatic' },
                { value: 'manual-duplex', label: 'Manual' },
              ],
              (value) =>
                store.update((draft) => void (draft.settings.imposition.duplex = value), {
                  label: 'duplex',
                }),
            ),
          ),
          numberField({
            label: `Binding margin (${u})`,
            hint: 'Extra space at the spine so text is not swallowed by the fold.',
            value: fromMm(project.settings.imposition.gutterMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.settings.imposition.gutterMm = toMm(value, u)), {
                label: 'gutter',
              }),
          }),
          numberField({
            label: `Creep per sheet (${u})`,
            hint: 'For thick booklets: shifts inner pages towards the spine so the trimmed edge is straight.',
            value: fromMm(project.settings.imposition.creepMm, u),
            min: 0,
            step: 0.05,
            onInput: (value) =>
              store.update((draft) => void (draft.settings.imposition.creepMm = toMm(value, u)), {
                label: 'creep',
              }),
          }),
          checkbox({
            label: 'Print fold guides',
            checked: project.settings.imposition.foldMarks,
            onChange: (checked) =>
              store.update((draft) => void (draft.settings.imposition.foldMarks = checked), {
                label: 'fold-marks',
              }),
          }),
        ),
      { open: false },
    ),

    section(
      'Bleed and marks',
      () =>
        el(
          'div',
          {},
          numberField({
            label: `Bleed (${u})`,
            hint: 'How far full-page pictures run past the trim line.',
            value: fromMm(project.settings.marks.bleedMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.settings.marks.bleedMm = toMm(value, u)), { label: 'bleed' }),
          }),
          checkbox({
            label: 'Crop marks',
            note: 'Corner marks showing where to cut.',
            checked: project.settings.marks.cropMarks,
            onChange: (checked) =>
              store.update((draft) => void (draft.settings.marks.cropMarks = checked), { label: 'crop' }),
          }),
          checkbox({
            label: 'Registration marks',
            checked: project.settings.marks.registrationMarks,
            onChange: (checked) =>
              store.update((draft) => void (draft.settings.marks.registrationMarks = checked), {
                label: 'registration',
              }),
          }),
          numberField({
            label: `Safe area (${u})`,
            hint: 'Keep text at least this far from the trim.',
            value: fromMm(project.settings.marks.safeAreaMm, u),
            min: 0,
            step: 0.5,
            onInput: (value) =>
              store.update((draft) => void (draft.settings.marks.safeAreaMm = toMm(value, u)), {
                label: 'safe-area',
              }),
          }),
        ),
      { open: false },
    ),

    section('Ink saving', () => inkSection(), { open: false }),
    section('Layout assistant', () => assistantSection(), { open: false }),

    section(
      'Page furniture',
      () =>
        el(
          'div',
          {},
          el(
            'button',
            {
              type: 'button',
              class: 'pn-btn pn-btn--sm pn-btn--block',
              onclick: () => addPageNumbers(),
            },
            'Add page numbers to every page',
          ),
          el('div', { style: { height: '0.5rem' } }),
          checkbox({
            label: 'Stamp “Made at home” on the last page',
            checked: project.settings.madeAtHomeStamp,
            onChange: (checked) =>
              store.update((draft) => void (draft.settings.madeAtHomeStamp = checked), { label: 'stamp' }),
          }),
        ),
      { open: false },
    ),
  );

  return container;
}

function inkSection(): HTMLElement {
  const project = store.project!;
  const ink = project.settings.ink;
  const estimate = estimateInk(project);

  return el(
    'div',
    {},
    el(
      'div',
      { class: `pn-note pn-note--${estimate.level === 'high' ? 'warn' : 'info'}` },
      icon('ink', { size: 18, class: 'pn-note__icon' }),
      el(
        'div',
        {},
        el('strong', { text: estimate.label }),
        el('div', { style: { marginTop: '2px', fontSize: '0.75rem' }, text: estimate.detail }),
      ),
    ),
    el('div', { style: { height: '0.75rem' } }),
    checkbox({
      label: 'Ink-saving mode',
      checked: ink.enabled,
      onChange: (checked) =>
        store.update((draft) => void (draft.settings.ink.enabled = checked), { label: 'ink-enabled' }),
    }),
    checkbox({
      label: 'Print in greyscale',
      checked: ink.greyscale,
      disabled: !ink.enabled,
      onChange: (checked) =>
        store.update((draft) => void (draft.settings.ink.greyscale = checked), { label: 'ink-grey' }),
    }),
    checkbox({
      label: 'Drop background fills',
      note: 'Removes solid page and block backgrounds.',
      checked: ink.removeBackgrounds,
      disabled: !ink.enabled,
      onChange: (checked) =>
        store.update((draft) => void (draft.settings.ink.removeBackgrounds = checked), {
          label: 'ink-bg',
        }),
    }),
    slider({
      label: 'Image density',
      hint: 'Lower values lay down less ink but look paler.',
      value: Math.round(ink.imageDensity * 100),
      min: 40,
      max: 100,
      step: 5,
      format: (value) => `${value}%`,
      onInput: (value) =>
        store.update((draft) => void (draft.settings.ink.imageDensity = value / 100), {
          label: 'ink-density',
        }),
    }),
    el('p', {
      class: 'pn-field__hint',
      text: 'PrintNest cannot measure real ink use — this is a relative guide based on how much of each page carries dark or photographic material.',
    }),
  );
}

function assistantSection(): HTMLElement {
  const project = store.project!;
  const suggestions = buildSuggestions(project);
  const container = el('div');

  if (suggestions.length === 0) {
    container.append(
      el('p', { class: 'pn-field__hint', text: 'Nothing to suggest — this layout looks balanced.' }),
    );
    return container;
  }

  for (const suggestion of suggestions) {
    container.append(
      el(
        'div',
        { class: 'pn-issue pn-issue--review', style: { marginBottom: '0.5rem' } },
        icon('sparkle', { size: 18, class: 'pn-issue__icon' }),
        el(
          'div',
          { class: 'pn-issue__body' },
          el('div', { class: 'pn-issue__title', text: suggestion.title }),
          el('div', { class: 'pn-issue__detail', text: suggestion.detail }),
          el(
            'div',
            { class: 'pn-issue__actions' },
            el('button', {
              type: 'button',
              class: 'pn-btn pn-btn--sm',
              text: 'Apply',
              onclick: () => {
                store.update((draft) => suggestion.apply(draft), { label: `assist-${suggestion.id}` });
                toast({ title: 'Applied', detail: suggestion.title, kind: 'success' });
              },
            }),
          ),
        ),
      ),
    );
  }

  container.append(
    el('p', {
      class: 'pn-field__hint',
      text: 'These suggestions are worked out on your device from image sizes and page contents. Nothing is uploaded.',
    }),
  );
  return container;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function setPaper(sizeId: string): void {
  store.update(
    (draft) => {
      if (sizeId === 'custom') {
        draft.paper.sizeId = 'custom';
        return;
      }
      const paper = getPaperSize(sizeId);
      if (!paper) return false;
      draft.paper.sizeId = paper.id;
      draft.paper.widthMm = paper.widthMm;
      draft.paper.heightMm = paper.heightMm;
      return undefined;
    },
    { label: 'paper' },
  );
}

function matchPageToSheet(divisor: 1 | 2 | 4): void {
  store.update(
    (draft) => {
      const sheet = resolveSheet(
        { widthMm: draft.paper.widthMm, heightMm: draft.paper.heightMm },
        draft.paper.orientation,
      );
      const size = subdivideSheet(sheet, divisor);
      draft.pageWidthMm = size.widthMm;
      draft.pageHeightMm = size.heightMm;
    },
    { label: 'page-size' },
  );
}

function addPageNumbers(): void {
  store.update(
    (draft) => {
      for (const page of draft.pages) {
        if (page.elements.some((element) => element.type === 'page-number')) continue;
        page.elements.push(
          createPageNumberElement({
            xMm: draft.margins.leftMm,
            yMm: draft.pageHeightMm - draft.margins.bottomMm,
            widthMm: draft.pageWidthMm - draft.margins.leftMm - draft.margins.rightMm,
            heightMm: 6,
          }),
        );
      }
    },
    { label: 'page-numbers' },
  );
  toast({ title: 'Page numbers added', detail: 'Covers are skipped automatically.', kind: 'success' });
}

function deleteSelection(): void {
  const ids = new Set(store.ui.selection.elementIds);
  if (ids.size === 0) return;
  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      page.elements = page.elements.filter((element) => !ids.has(element.id));
      return undefined;
    },
    { label: 'delete-elements' },
  );
  store.selectElements([]);
}

function fitFrameToImage(): void {
  const project = store.project;
  if (!project) return;
  const ids = new Set(store.ui.selection.elementIds);

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      let changed = false;
      for (const element of page.elements) {
        if (!ids.has(element.id) || element.type !== 'image') continue;
        const asset = draft.assets.find((entry) => entry.id === element.assetId);
        if (!asset?.widthPx || !asset.heightPx) continue;
        const ratio = asset.widthPx / asset.heightPx;
        // Keep the longer edge, adjust the other, and stay centred.
        const centreX = element.xMm + element.widthMm / 2;
        const centreY = element.yMm + element.heightMm / 2;
        if (ratio >= 1) element.heightMm = element.widthMm / ratio;
        else element.widthMm = element.heightMm * ratio;
        element.xMm = centreX - element.widthMm / 2;
        element.yMm = centreY - element.heightMm / 2;
        element.fit = 'fit';
        changed = true;
      }
      return changed ? undefined : false;
    },
    { label: 'fit-frame' },
  );
}

/** Add a new text or shape element to the current page. */
export function addElement(kind: 'text' | 'rect' | 'ellipse' | 'line'): void {
  const project = store.project;
  if (!project) return;

  store.update(
    (draft) => {
      const page = draft.pages[store.ui.selection.pageIndex];
      if (!page) return false;
      const width = Math.min(80, draft.pageWidthMm - draft.margins.leftMm - draft.margins.rightMm);
      const rect = {
        xMm: draft.margins.leftMm,
        yMm: draft.margins.topMm,
        widthMm: width,
        heightMm: kind === 'line' ? 1 : kind === 'text' ? 30 : 40,
      };
      const element =
        kind === 'text'
          ? createTextElement('New text', rect)
          : createShapeElement(kind === 'rect' ? 'rect' : kind === 'ellipse' ? 'ellipse' : 'line', rect);
      page.elements.push(element);
      page.intentionallyBlank = false;
      store.ui.selection = { pageIndex: store.ui.selection.pageIndex, elementIds: [element.id] };
      return undefined;
    },
    { label: `add-${kind}` },
  );
}
