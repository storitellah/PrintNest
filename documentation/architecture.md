# PrintNest architecture

Notes for anyone reading or extending the code. The user-facing guide is
[`user-guide.md`](user-guide.md); this is the "why is it built like that"
document.

## Shape of the thing

A static, client-side application. No server, no API, no accounts, no
database. Vite bundles TypeScript and CSS; the output is a folder of files.

```
src/core/     the document model and every pure engine. No DOM.
src/render/   turns a document into a DOM page, a canvas, or a PDF.
src/ui/       screens, panels, dialogs, direct manipulation.
```

The dependency direction is strictly one way. `core` never imports from
`render` or `ui`; `render` never imports from `ui`. That is what keeps the
engines testable without a browser, and it is worth defending.

## Three decisions that shape everything else

### 1. Everything is millimetres

Paper, margins, element positions, bleed, crop marks — all stored in
millimetres. Units exist only at the edges: where a user types a number
(`parseLength`) and where a renderer needs points or pixels (`mmToPt`,
`mmToCssPx`).

Any variable carrying a length ends in `Mm`. This is a naming convention doing
real work: it removes the class of bug where a value silently changes meaning
as it crosses a module boundary.

The payoff is in the renderer. Pages are laid out in actual CSS `mm`:

```css
.pn-page { width: 210mm; height: 297mm; }
```

so `@page { size: 210mm 297mm; margin: 0 }` gives a 1:1 print with no scaling
arithmetic anywhere in the code. The screen preview is the same DOM under a
`scale()` transform. "What you see is the size it prints" is a structural
property rather than something maintained by hand.

### 2. The document is plain JSON

`Project` contains no class instances, no functions and no DOM references —
only data. Binary assets live outside it, in IndexedDB, referenced by id.

That single constraint gives, for free:

- **Undo/redo** — history is an array of whole documents. A 200-page book is
  well under a megabyte of JSON, because the images are not in it, so this is
  both cheaper and far less bug-prone than a patch log.
- **Autosave** — write the object.
- **`.printnest` export** — the same object plus base64 assets.
- **Tests** — construct a document, assert on the result. No fixtures, no
  mocks.

`store.update()` hands the caller a *draft copy* to mutate freely and swaps it
in afterwards, so mutation is convenient without anything ever being mutated in
place.

### 3. Imposition is pure functions

`src/core/imposition.ts` has no DOM and no store dependency. It takes a page
count, a sheet size and some settings, and returns where every page goes on
every physical sheet.

This is the part of the application that most deserves tests, because a wrong
answer wastes real paper and is not obvious until after printing. It has 48 of
them.

## The bit that is genuinely hard: the back side

Every booklet imposition reference gives the same table. For eight pages:

```
sheet 1 front:  8 | 1        sheet 1 back:  2 | 7
sheet 2 front:  6 | 3        sheet 2 back:  4 | 5
```

Those numbers are what you see **looking at each side of the sheet**. They are
correct when the sheet is turned over **left to right**, like a page in a book:
the half that carried page 1 ends up on the left, ready to receive page 2.

Turn the sheet **top to bottom** instead and the content lands a half turn out.
So the back side has to be rotated 180° — the rectangle mirrored in *both* axes
and the page's own rotation advanced by 180°, not just an x mirror.

The trap, and the reason this was originally wrong:

| flip about | portrait sheet | landscape sheet |
| --- | --- | --- |
| long edge | left ↔ right | top ↔ bottom |
| short edge | top ↔ bottom | left ↔ right |

"Flip on the long edge" means opposite physical actions depending on the shape
of the paper. A document that stored an edge name would silently change meaning
the moment someone rotated the page.

So the document stores the **motion** — `'left-right'` or `'top-bottom'` —
which is orientation-independent. `backTransformFor()` maps it to a transform;
`flipEdgeLabel()` maps it back to driver jargon purely for display, because the
duplex assistant is helpful when it mentions what your driver calls the thing.

## Rendering

One page renderer, three consumers.

- **`pageRender.ts`** builds a DOM subtree at true physical size. The preview
  wraps it in a `scale()` transform and adds an overlay layer; the print
  document uses it untouched. Same code, so they cannot drift.
- **`canvasRender.ts`** draws the same elements to a canvas for PNG/JPEG
  export, sharing `computeImageLayout()` so the geometry is identical.
- **`pdfExport.ts`** writes text and shapes as **vectors** — real, selectable,
  resolution-independent text — and rasterises images at the requested DPI,
  because cropping, fitting and the ink-saving transforms cannot be expressed
  in PDF operators without reimplementing them.

`computeImageLayout()` is the shared heart: given an element and a source size,
it returns where the picture sits, how big it is, how it is rotated and how the
crop maps onto it. Pure, and separately tested, because it is used three times.

### The PDF coordinate problem

PDF is y-up with the origin bottom-left; the document model is y-down with the
origin top-left, in millimetres. Rather than convert every value by hand, each
slot pushes a transformation matrix making the local space "millimetres, y-up,
origin at the page's bottom-left corner":

```
T(slot centre) · R(-rotation) · S(scale × pointsPerMm) · T(-pageW/2, -pageH/2)
```

After that, a single `pageHeightMm - y - height` flip is the only conversion in
the element-drawing code.

## Printing

There is no pop-up and no iframe. `preparePrintJob()` builds the sheets into a
`#pn-print-root` element in the live document, writes an `@page` rule matching
the paper, and calls `window.print()`. The print stylesheet removes everything
else from the printed flow:

```css
@media print { body > *:not(#pn-print-root) { display: none !important; } }
```

`display: none` rather than off-screen positioning, so hidden interface cannot
leave blank pages behind.

Manual duplex is two print jobs from the same document, filtered to fronts and
backs, with the back pass reversed when the printer stacks pages face up.

### What a browser cannot do

It cannot choose a printer, set the paper size, control duplex or borderless
mode, or turn off "fit to page". This is not a gap to work around — it is the
security boundary that stops any web page from driving your hardware.

PrintNest's response is to be explicit. The print screen lists the settings the
user must confirm themselves, and the calibration page measures what the
printer actually did. Interface copy that implied otherwise would produce
wasted paper, so it is avoided deliberately.

## Storage

IndexedDB, three stores: `projects` (JSON documents), `assets` (blobs, indexed
by owning project so deletion can sweep) and `meta` (preferences, printer
profiles, the recovery snapshot).

Object URLs are owned centrally by `assets.ts`. Nothing else calls
`URL.createObjectURL`, because an unreleased URL pins the whole blob in memory
and a re-render loop would leak one per frame. Previews are downsampled
copies; the originals are only touched by the exporters.

## Security posture

The full statement is in [`SECURITY.md`](../SECURITY.md). The engineering
summary:

- `default-src 'none'` and nothing loaded from another origin, so even a
  successful injection would have nowhere to send data.
- Untrusted input has exactly one entry point, `src/core/sanitize.ts`.
- `innerHTML` is not used anywhere. `textContent` or the `el()` helper.
- Files are identified by byte signature, not extension or claimed MIME type.
- Imported JSON is parsed with a prototype-pollution-safe reviver, then
  normalised field by field, with every number range-checked and every colour
  validated.

## Why no framework

The interface is built with a 300-line DOM helper and functions returning
elements.

For this application that is the right trade. The state is one JSON document
with a store that already notifies subscribers; the expensive rendering is
millimetre-precise page layout that a virtual DOM would not help with; and the
bundle stays small enough that a phone opens it instantly. A framework would
have added a dependency, a build concept and a rendering model without solving
a problem PrintNest actually has.

That is a judgement about this application, not a general position.

## Performance notes

- Thumbnails are virtualised past 24 pages with an `IntersectionObserver`.
- Image previews are downsampled to 1400 px; originals are only decoded by the
  exporters.
- Imports process one file at a time, yielding to the event loop between them,
  so a folder of eighty photographs does not freeze the interface.
- Drag handlers are `requestAnimationFrame`-throttled and their store updates
  coalesce into a single undo step.
- `pdfjs-dist` and `pdf-lib` are split into their own chunks and only loaded
  when a PDF is actually imported or exported.

## Testing

292 tests across seven suites, organised by subject rather than by file:

| Suite | Covers |
| --- | --- |
| `imposition` | page order, sheet layout, back-side geometry, duplex passes |
| `paper` | unit conversion, the paper catalogue, sheet and margin maths |
| `imageLayout` | fit/fill/crop/rotation geometry, resolution assessment |
| `security` | SVG sanitising, prototype pollution, file sniffing, normalisation |
| `project` | project kinds, templates, the checker, poster, contact sheets, ink, calibration, duplex |
| `render` | DOM output at true millimetre size, text wrapping, crop marks |
| `storage` | IndexedDB round-trips, the store and undo, `.printnest` files, PDF dimensions |

The imposition tests are the ones to be careful with. They encode the page
orders that make a folded booklet read correctly; changing them to make a test
pass, rather than because the physics changed, will waste somebody's paper.
