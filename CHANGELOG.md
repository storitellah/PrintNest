# Changelog

All notable changes to PrintNest are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and PrintNest uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A site published without a build step now says so.** Serving the repository
  rather than `dist/` left the browser asking for `/src/main.ts`, which static
  hosts label `video/mp2t`; browsers refuse that as a module script, so the
  loading state stayed on screen indefinitely with nothing to explain it. A
  static notice in `index.html`, stripped by Vite in both `dev` and `build`,
  now names the cause and the settings that fix it. The application code was
  not at fault and is unchanged.

### Added

- **`public/boot-watchdog.js`** — reports a start that never happens, whatever
  the cause: a missing or refused bundle, a policy that blocks it, a content
  blocker. Names the file that failed, lists what to check and offers a reload.
  Deliberately outside the bundle, so it survives the bundle failing.
- Cloudflare Pages troubleshooting keyed to the symptom, a warning that
  Cloudflare's "no framework" defaults publish the repository and still report
  success, and a note on the cost of connecting one repository to two projects.
- A `deploy` test suite holding that wiring in place.

## [1.0.0] — 2026-07-29

The first release.

### Project kinds

- Quick Print, Photo Print, Artwork Print, Zine Maker, Booklet Maker, Book
  Printer, Poster Printer, Contact Sheet, Photo Grid, Cards and Invitations,
  Labels and Stickers, Portfolio Print and Custom Layout.

### Imposition

- Saddle stitch with signatures of 4, 8, 12, 16 or a custom size, binding
  margins and creep compensation.
- Cut-and-stack perfect binding.
- The classic eight-page mini zine from a single sheet, with fold guides and
  the centre slit marked.
- Accordion folds, gatefolds and n-up grids.
- Back-side geometry derived from the physical motion used to turn the stack
  over, so it is correct on portrait and landscape paper alike.
- Reading order and print sheet order shown side by side.

### Printing

- Native print dialog via a dedicated print document rendered at exact
  millimetre dimensions, with `@page` set from the project's paper.
- A pre-flight checklist covering content, resolution, page order, booklet
  page counts, duplex configuration, printable area, safe margins, blank
  pages, paper support and crop marks — with one-click fixes.
- Manual duplex assistant with animated diagrams and a one-sheet test that
  learns and remembers how a printer flips paper.
- Calibration page with margin rulers, alignment markers, colour and greyscale
  ramps, fine lines, text samples, a borderless test band and 100 mm / 4 in
  measurement lines, plus scale correction.

### Editing

- Layout editor with pointer-driven move, resize and rotate, snapping,
  alignment, distribution, layer order, locking and keyboard nudging.
- Text with fonts, size, leading, tracking, alignment, columns and case.
- Images with fit, fill, stretch, actual size and custom scale, cropping,
  rotation, flipping, borders, corner radius and mattes.
- Full undo and redo, with drag operations coalesced into single steps.

### Files

- Import JPEG, PNG, WebP, GIF, SVG, PDF, TXT and Markdown, plus HEIC/HEIF,
  AVIF and TIFF where the browser can decode them.
- Drag and drop, folder drops, clipboard paste and the system file picker.
- Export print-ready PDF in reading order or as imposed sheets, PNG pages,
  JPEG spreads, PNG sheets, a low-resolution preview, cutting and folding
  guides, and portable `.printnest` project files.

### Everywhere else

- Nineteen editable templates stored as JSON layout definitions.
- Ten starter printer profiles including the Brother DCP-T420W, all editable.
- Ink-saving mode with a relative usage estimate.
- A local layout assistant that suggests grids, groups by orientation and
  spots low-resolution images — all arithmetic, nothing uploaded.
- Twelve illustrated help guides, a privacy page and a keyboard reference.
- Installable PWA with offline support, local project storage, autosave and
  session recovery.
- Light and dark modes; the print output never inherits dark mode.
- 292 unit tests across seven suites.
