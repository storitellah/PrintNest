# Contributing to PrintNest

Thank you for wanting to help. PrintNest exists so that people can print their
own work properly at home, and the most valuable contributions are usually the
least glamorous ones: a printer profile with real measured margins, a template
someone actually uses, or a bug report from a printer nobody tested on.

## The quickest ways to help

### Send a printer profile

If you have run the calibration page and know your printer's real margins, that
is genuinely useful. Open an issue with:

- brand and exact model
- the margins you measured on each edge (top, right, bottom, left)
- whether it has automatic duplex
- which paper sizes it prints borderless, if any
- which way the stack has to be turned over for manual duplex
- whether pages come out printed side up or down

There is an issue template for exactly this.

### Report a printing bug

Printing bugs are hard to reproduce without detail. Please include the browser
and version, the operating system, the printer, the project kind, and — most
usefully — what came out of the printer versus what the Print sheets preview
showed.

### Add a template

Templates are JSON files in `/templates`. Copy an existing one, change it, and
open a pull request. The schema is documented at the top of
`src/core/templates.ts`; rectangles are `[x, y, width, height]` in millimetres
of the finished page.

## Working on the code

Node 22 or newer is required — jsdom, which the tests run in, needs it.

```bash
npm install
npm run dev
npm run test
npm run typecheck
```

Before opening a pull request, `npm run build` must pass — it runs the
typechecker first.

### How the code is organised

```
src/core/    the document model and every pure engine: imposition, paper
             maths, validation, checks, ink, templates. No DOM.
src/render/  turns a document into a DOM page, a canvas, or a PDF.
src/ui/      screens, panels, dialogs, direct manipulation.
```

The dependency direction is one way: `core` knows nothing about `render`, and
`render` knows nothing about `ui`. Keeping that straight is what makes the
engines testable.

### Conventions worth knowing

- **Everything geometric is millimetres.** Variables carrying a length end in
  `Mm`. Convert at the edges, never in the middle.
- **Never `innerHTML`.** Use `textContent`, or the `el()` helper in
  `src/ui/dom.ts`.
- **Untrusted input goes through `src/core/sanitize.ts`.** Every time.
- **Status is never colour alone.** Every coloured state also carries text or
  an icon, for the same reason it carries an `aria-label`.
- **Say what a browser cannot do.** PrintNest cannot choose a printer or set a
  paper size. Interface copy that implies otherwise produces wasted paper, so
  we are explicit about the boundary rather than papering over it.

### Tests

New behaviour in `src/core` or `src/render` needs a test. The suites are
organised by subject rather than by file, and they read as descriptions of
behaviour — please keep that style.

The imposition tests are the ones to be most careful with: they encode the
page orders that make a folded booklet read correctly, and getting them wrong
wastes real paper.

### Accessibility

PrintNest aims at WCAG 2.2 AA. Practically that means: every control reachable
by keyboard, a visible focus ring, an accessible name on anything that is only
an icon, and no interaction that requires a drag with no keyboard alternative.
Reordering pages, for example, works with Alt and the arrow keys as well as by
dragging.

Animations are decorative and must be removed entirely under
`prefers-reduced-motion`, never merely shortened.

## Commit messages

Explain what changed and why. If a change affects what comes out of a printer,
say so in the message — that is the part a future reader needs.

## Code of conduct

Be kind and assume good faith. This is a small tool for making things; disputes
about it are not worth anyone's day.

## Questions

[hello@storitellah.com](mailto:hello@storitellah.com)
