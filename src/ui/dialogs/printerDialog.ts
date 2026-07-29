import { PAPER_GROUP_LABELS, PAPER_SIZES, getPaperSize, projectSheetFromPaper } from '../../core/paper.ts';
import { projectSheet } from '../../core/project.ts';
import {
  BUILT_IN_PROFILES,
  createCustomProfile,
  deleteProfile,
  describeProfile,
  getProfile,
  loadProfiles,
  saveProfile,
} from '../../core/printerProfiles.ts';
import type { PrinterProfile } from '../../core/printerProfiles.ts';
import { store } from '../../core/store.ts';
import { buildTestPage, calculateCorrection, clampCorrection } from '../../core/testPage.ts';
import { printStandalone } from '../../render/printRoot.ts';
import { checkbox, el, numberField, section, selectField, setChildren } from '../dom.ts';
import { icon } from '../icons.ts';
import { toast, toastError } from '../toast.ts';
import { confirmDialog, openDialog } from './dialog.ts';

/**
 * Printer profile setup, and the calibration page that fills it in.
 *
 * The profile is advice, not control: a web page cannot query a printer, so
 * everything here is either a shipped starting point or something the user
 * measured. Every field is editable for exactly that reason — drivers and
 * regional model variants differ, and a profile you cannot correct is worse
 * than none.
 */

export async function openPrinterDialog(): Promise<void> {
  const project = store.project;
  let profiles = await loadProfiles();
  let selectedId = project?.settings.printerProfileId ?? profiles[0]?.id ?? null;

  const body = el('div');
  const handle = openDialog({
    title: 'Printer setup',
    subtitle: 'Optional, but it makes the checks and the duplex assistant much more useful',
    body,
    wide: true,
  });

  const render = (): void => {
    const profile = getProfile(profiles, selectedId);

    setChildren(
      body,
      selectField({
        label: 'Printer',
        value: selectedId ?? '',
        options: [
          { value: '', label: 'No profile — general advice only' },
          ...profiles.map((entry) => ({
            value: entry.id,
            label: `${entry.brand} ${entry.model}`,
            group: entry.builtIn ? 'Starter profiles' : 'My printers',
          })),
        ],
        onChange: (value) => {
          selectedId = value || null;
          store.update((draft) => void (draft.settings.printerProfileId = selectedId), {
            label: 'printer-profile',
          });
          render();
        },
      }),

      profile ? profileSummary(profile) : null,
      profile ? profileEditor(profile, render, () => profiles, (next) => (profiles = next)) : null,

      el(
        'div',
        { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' } },
        el(
          'button',
          {
            type: 'button',
            class: 'pn-btn pn-btn--sm',
            onclick: async () => {
              const created = createCustomProfile(profile ?? undefined);
              profiles = await saveProfile(created);
              selectedId = created.id;
              store.update((draft) => void (draft.settings.printerProfileId = created.id), {
                label: 'printer-profile',
              });
              render();
              toast({ title: 'New profile created', detail: 'Edit the fields to match your printer.', kind: 'success' });
            },
          },
          icon('plus', { size: 15 }),
          profile ? 'Copy this profile' : 'Add a printer',
        ),
        profile && !profile.builtIn
          ? el(
              'button',
              {
                type: 'button',
                class: 'pn-btn pn-btn--sm pn-btn--danger',
                onclick: async () => {
                  const confirmed = await confirmDialog({
                    title: 'Delete this printer profile?',
                    message: `${profile.brand} ${profile.model} will be removed. Your projects are not affected.`,
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (!confirmed) return;
                  profiles = await deleteProfile(profile.id);
                  selectedId = profiles[0]?.id ?? null;
                  render();
                },
              },
              icon('trash', { size: 15 }),
              'Delete',
            )
          : null,
        profile?.builtIn
          ? el('button', {
              type: 'button',
              class: 'pn-btn pn-btn--sm',
              text: 'Reset to the shipped values',
              onclick: async () => {
                profiles = await deleteProfile(profile.id);
                render();
                toast({ title: 'Profile reset', kind: 'success' });
              },
            })
          : null,
      ),

      section('Calibration', () => calibrationSection(profile, render), { open: false }),
    );
  };

  handle.setFooter([
    el('button', {
      type: 'button',
      class: 'pn-btn pn-btn--primary',
      text: 'Done',
      onclick: () => handle.close(),
    }),
  ]);

  render();
}

function profileSummary(profile: PrinterProfile): HTMLElement {
  const notes: string[] = [describeProfile(profile)];
  if (profile.connections.length > 0) notes.push(profile.connections.join(', '));
  if (profile.borderlessSizes.length === 0) notes.push('no borderless printing');

  return el(
    'div',
    { class: 'pn-note pn-note--info', style: { marginBottom: '1rem' } },
    icon('print', { size: 18, class: 'pn-note__icon' }),
    el(
      'div',
      {},
      el('strong', { text: `${profile.brand} ${profile.model}` }),
      el('div', { style: { marginTop: '2px', fontSize: '0.8125rem' }, text: notes.join(' · ') }),
      profile.notes
        ? el('div', { style: { marginTop: '6px', fontSize: '0.8125rem' }, text: profile.notes })
        : null,
    ),
  );
}

function profileEditor(
  profile: PrinterProfile,
  rerender: () => void,
  getProfiles: () => PrinterProfile[],
  setProfiles: (next: PrinterProfile[]) => void,
): HTMLElement {
  const update = async (patch: Partial<PrinterProfile>): Promise<void> => {
    const next = await saveProfile({ ...profile, ...patch });
    setProfiles(next);
    rerender();
  };
  void getProfiles;

  return el(
    'div',
    {},
    section(
      'Printer details',
      () =>
        el(
          'div',
          {},
          el(
            'div',
            { class: 'pn-row' },
            textField('Brand', profile.brand, (value) => void update({ brand: value })),
            textField('Model', profile.model, (value) => void update({ model: value })),
          ),
          selectField({
            label: 'Technology',
            value: profile.technology,
            options: [
              { value: 'inkjet', label: 'Inkjet' },
              { value: 'ink-tank', label: 'Ink tank' },
              { value: 'laser', label: 'Laser' },
              { value: 'dye-sublimation', label: 'Dye sublimation' },
              { value: 'thermal', label: 'Thermal' },
            ],
            onChange: (value) => void update({ technology: value as PrinterProfile['technology'] }),
          }),
          checkbox({
            label: 'Prints in colour',
            checked: profile.color,
            onChange: (checked) => void update({ color: checked }),
          }),
          selectField({
            label: 'Largest paper it takes',
            value: profile.maxPaperSizeId,
            options: PAPER_SIZES.map((paper) => ({
              value: paper.id,
              label: paper.name,
              group: PAPER_GROUP_LABELS[paper.group],
            })),
            onChange: (value) => void update({ maxPaperSizeId: value }),
          }),
        ),
      { open: false },
    ),

    section(
      'Duplex',
      () =>
        el(
          'div',
          {},
          checkbox({
            label: 'Has automatic duplex',
            note: 'The printer can turn the paper over by itself.',
            checked: profile.autoDuplex,
            onChange: (checked) => void update({ autoDuplex: checked }),
          }),
          checkbox({
            label: 'Manual duplex is possible',
            note: 'You can reload the stack by hand.',
            checked: profile.manualDuplex,
            onChange: (checked) => void update({ manualDuplex: checked }),
          }),
          selectField({
            label: 'Paper flip direction',
            hint: 'The manual duplex assistant fills this in for you after the one-sheet test.',
            value: profile.duplexFlip,
            options: [
              { value: 'unknown', label: 'Not tested yet' },
              { value: 'long', label: 'Flip on the long edge' },
              { value: 'short', label: 'Flip on the short edge' },
            ],
            onChange: (value) => void update({ duplexFlip: value as PrinterProfile['duplexFlip'] }),
          }),
          selectField({
            label: 'Pages come out',
            value: profile.outputFaceUp === null ? 'unknown' : profile.outputFaceUp ? 'up' : 'down',
            options: [
              { value: 'unknown', label: 'Not sure' },
              { value: 'up', label: 'Printed side up' },
              { value: 'down', label: 'Printed side down' },
            ],
            onChange: (value) =>
              void update({ outputFaceUp: value === 'unknown' ? null : value === 'up' }),
          }),
        ),
      { open: false },
    ),

    section(
      'Margins and borderless',
      () =>
        el(
          'div',
          {},
          el('p', {
            class: 'pn-field__hint',
            style: { marginBottom: '0.75rem' },
            text: 'The unprintable strip around the edge of the paper. The calibration page measures it for real.',
          }),
          el(
            'div',
            { class: 'pn-row' },
            numberField({
              label: 'Top (mm)',
              value: profile.minMargins.topMm,
              min: 0,
              max: 40,
              step: 0.5,
              onInput: (value) =>
                void update({ minMargins: { ...profile.minMargins, topMm: value } }),
            }),
            numberField({
              label: 'Bottom (mm)',
              value: profile.minMargins.bottomMm,
              min: 0,
              max: 40,
              step: 0.5,
              onInput: (value) =>
                void update({ minMargins: { ...profile.minMargins, bottomMm: value } }),
            }),
          ),
          el(
            'div',
            { class: 'pn-row' },
            numberField({
              label: 'Left (mm)',
              value: profile.minMargins.leftMm,
              min: 0,
              max: 40,
              step: 0.5,
              onInput: (value) =>
                void update({ minMargins: { ...profile.minMargins, leftMm: value } }),
            }),
            numberField({
              label: 'Right (mm)',
              value: profile.minMargins.rightMm,
              min: 0,
              max: 40,
              step: 0.5,
              onInput: (value) =>
                void update({ minMargins: { ...profile.minMargins, rightMm: value } }),
            }),
          ),
          el('p', {
            class: 'pn-field__label',
            text: 'Borderless paper sizes',
            style: { marginTop: '0.75rem' },
          }),
          el(
            'div',
            {},
            ...PAPER_SIZES.filter((paper) => profile.paperSizes.includes(paper.id)).map((paper) =>
              checkbox({
                label: paper.name,
                checked: profile.borderlessSizes.includes(paper.id),
                onChange: (checked) =>
                  void update({
                    borderlessSizes: checked
                      ? [...profile.borderlessSizes, paper.id]
                      : profile.borderlessSizes.filter((id) => id !== paper.id),
                  }),
              }),
            ),
          ),
        ),
      { open: false },
    ),

    section(
      'Paper and quality',
      () =>
        el(
          'div',
          {},
          selectField({
            label: 'Default quality',
            value: profile.defaultQuality,
            options: profile.qualityOptions.map((option) => ({ value: option, label: option })),
            onChange: (value) => void update({ defaultQuality: value }),
          }),
          selectField({
            label: 'Default paper type',
            value: profile.defaultPaperType,
            options: profile.paperTypes.map((option) => ({ value: option, label: option })),
            onChange: (value) => void update({ defaultPaperType: value }),
          }),
          checkbox({
            label: 'Takes photo paper',
            checked: profile.photoPaper,
            onChange: (checked) => void update({ photoPaper: checked }),
          }),
          checkbox({
            label: 'Has a rear paper feed',
            checked: profile.rearFeed,
            onChange: (checked) => void update({ rearFeed: checked }),
          }),
          checkbox({
            label: 'Has a main paper tray',
            checked: profile.mainTray,
            onChange: (checked) => void update({ mainTray: checked }),
          }),
          el(
            'div',
            { class: 'pn-field' },
            el('label', { class: 'pn-field__label', for: 'pn-profile-notes', text: 'Notes' }),
            el('textarea', {
              class: 'pn-textarea',
              id: 'pn-profile-notes',
              rows: '3',
              value: profile.notes,
              onchange: (event: Event) =>
                void update({ notes: (event.target as HTMLTextAreaElement).value }),
            }),
          ),
        ),
      { open: false },
    ),
  );
}

function textField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
  const id = `pn-text-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return el(
    'div',
    { class: 'pn-field' },
    el('label', { class: 'pn-field__label', for: id, text: label }),
    el('input', {
      class: 'pn-input',
      id,
      value,
      onchange: (event: Event) => onChange((event.target as HTMLInputElement).value),
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Calibration
 * ------------------------------------------------------------------ */

function calibrationSection(profile: PrinterProfile | null, rerender: () => void): HTMLElement {
  const project = store.project;
  const sheet = project
    ? projectSheet(project)
    : projectSheetFromPaper(getPaperSize('a4')!, 'portrait');

  let measured = 100;
  const resultNode = el('p', { class: 'pn-field__hint' });

  const options = {
    colour: true,
    greyscale: true,
    photo: true,
    borderless: profile ? profile.borderlessSizes.length > 0 : true,
    duplex: true,
  };

  const container = el(
    'div',
    {},
    el('p', {
      style: { lineHeight: '1.6', marginBottom: '1rem' },
      text: 'Print one calibration page, measure the two reference lines with a ruler, and PrintNest will work out whether your printer is scaling the page — the most common cause of prints that come out slightly wrong.',
    }),

    checkbox({
      label: 'Colour blocks',
      checked: options.colour,
      onChange: (checked) => {
        options.colour = checked;
      },
    }),
    checkbox({
      label: 'Greyscale steps',
      checked: options.greyscale,
      onChange: (checked) => {
        options.greyscale = checked;
      },
    }),
    checkbox({
      label: 'Tone and gradient sample',
      checked: options.photo,
      onChange: (checked) => {
        options.photo = checked;
      },
    }),
    checkbox({
      label: 'Borderless test band',
      note: 'A colour band running to all four edges, to find the true unprintable margin.',
      checked: options.borderless,
      onChange: (checked) => {
        options.borderless = checked;
      },
    }),
    checkbox({
      label: 'Duplex orientation marks',
      checked: options.duplex,
      onChange: (checked) => {
        options.duplex = checked;
      },
    }),

    el(
      'button',
      {
        type: 'button',
        class: 'pn-btn pn-btn--print',
        style: { marginTop: '0.75rem' },
        onclick: async () => {
          try {
            await printStandalone(
              () => [
                buildTestPage({
                  sheet,
                  printerLabel: profile ? `${profile.brand} ${profile.model}` : 'Unknown printer',
                  includeColorBlocks: options.colour,
                  includeGreyscale: options.greyscale,
                  includePhotoSample: options.photo,
                  includeBorderlessTest: options.borderless,
                  includeDuplexTest: options.duplex,
                  claimedMarginMm: profile
                    ? Math.min(
                        profile.minMargins.topMm,
                        profile.minMargins.rightMm,
                        profile.minMargins.bottomMm,
                        profile.minMargins.leftMm,
                      )
                    : 0,
                }),
              ],
              sheet,
            );
          } catch (error) {
            toastError(error, 'The calibration page could not be printed.');
          }
        },
      },
      icon('print', { size: 16 }),
      'Print the calibration page',
    ),

    el('hr', { style: { margin: '1.25rem 0', border: '0', borderTop: '1px solid var(--pn-border)' } }),

    numberField({
      label: 'The 100 mm line measured (mm)',
      hint: 'Measure between the two end marks with a ruler. Be as precise as you can.',
      value: 100,
      min: 50,
      max: 150,
      step: 0.5,
      onInput: (value) => {
        measured = value;
        const result = calculateCorrection(100, measured);
        resultNode.textContent = result.message;
      },
    }),
    resultNode,

    el(
      'div',
      { style: { display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' } },
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--sm pn-btn--primary',
        text: 'Apply the correction',
        onclick: async () => {
          const result = calculateCorrection(100, measured);
          const factor = clampCorrection(result.factor);
          store.update((draft) => void (draft.settings.scaleCorrection = factor), {
            label: 'scale-correction',
          });
          if (profile) await saveProfile({ ...profile, scaleCorrection: factor });
          toast({
            title:
              factor === 1
                ? 'No correction needed'
                : `Correction set to ${(factor * 100).toFixed(2)} %`,
            detail: result.message,
            kind: 'success',
          });
          rerender();
        },
      }),
      el('button', {
        type: 'button',
        class: 'pn-btn pn-btn--sm',
        text: 'Clear the correction',
        onclick: () => {
          store.update((draft) => void (draft.settings.scaleCorrection = 1), {
            label: 'scale-correction',
          });
          toast({ title: 'Correction cleared', kind: 'info' });
          rerender();
        },
      }),
    ),

    el('p', {
      class: 'pn-field__hint',
      style: { marginTop: '0.75rem' },
      text: `Current correction: ${((project?.settings.scaleCorrection ?? 1) * 100).toFixed(2)} %`,
    }),
  );

  return container;
}

/** The built-in profile list, exposed for the help pages. */
export function starterProfiles(): PrinterProfile[] {
  return BUILT_IN_PROFILES;
}
