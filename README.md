# PrintNest by Storitellah

**Make it. Arrange it. Print it at home.**

A print workshop that runs in your browser. Bring in pictures, PDFs and text,
arrange them into zines, books, photographs, posters, cards and labels, and
print them properly on the printer you already own.

Everything happens on your device. Nothing is uploaded, there is no account,
and it works offline.

Made with care by [Storitellah](https://storitellah.com).

---

## What it does

| | |
| --- | --- |
| **Zine Maker** | Eight-page mini zines from one sheet, folded booklets, accordion strips and gatefolds, with the imposition worked out for you. |
| **Booklet & Book** | Saddle-stitched A5 booklets from A4 paper, signatures for longer books, binding margins, creep compensation and page numbering. |
| **Photo & Artwork** | True-to-size photographic prints at 4×6 through A3, gallery margins, borders, captions, edition details and a resolution checker. |
| **Poster Printer** | Tile one large image across 2, 4, 6, 9, 12 or any grid of sheets, with overlap bands, cut marks, grid codes and a printed assembly map. |
| **Contact Sheets** | Proof sheets with file names, numbers and dates, from six presets including client proofs and film-style sheets. |
| **Cards & Labels** | Folded cards, postcards, business cards, sticker sheets and address labels, several to a page with cut guides. |
| **Manual duplex** | An assistant that prints one side, waits, shows you exactly how to turn the stack over, and prints the other side in the right order. |
| **Calibration** | A test page that finds out whether your printer is silently scaling your work, and corrects for it. |

Plus a layout editor, a pre-flight checklist, ink-saving mode, PDF/PNG/JPEG
export, nineteen editable templates and twelve illustrated help guides.

## How printing actually works

PrintNest prepares your pages and hands them to **your browser's own print
dialog**, which passes them to your operating system's printing service. That
is the same route every other application on your computer uses, which is why
it works with Wi-Fi, USB, network, AirPrint, Mopria, Windows, macOS, Android
and iOS printers without PrintNest knowing anything about them.

What a web page **cannot** do — and PrintNest does not pretend to:

- choose your printer for you
- set the paper size, quality or paper type
- turn duplex, borderless or colour management on or off
- turn off "fit to page" (the single most common cause of prints coming out
  a few per cent small)

So the print screen lists exactly which settings you need to confirm in your
own dialog, and the calibration page measures what your printer really did.

Tested against Brother DCP-T420W, Brother Ink Tank, Epson EcoTank, Canon
PIXMA, HP Smart Tank, laser, photo and portable printers. Starter profiles
ship for all of them and **every field is editable**, because drivers and
regional model variants differ.

## Running it locally

No server, no database, no accounts, no API keys.

```bash
npm install
npm run dev        # development server on http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the production build on http://localhost:4173
npm run test       # 292 unit tests
```

Other scripts:

```bash
npm run typecheck  # TypeScript, no emit
npm run icons      # regenerate the PWA icons in public/icons
npm run audit      # npm audit for production dependencies
```

Requires Node 22 or newer — jsdom, which the test suite runs in, needs it.

## Deploying to Cloudflare Pages

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` or newer |

Security headers, cache rules, the SPA fallback and the custom 404 are all in
`public/`, which Cloudflare copies verbatim into the deployment. Full
walkthrough: [`documentation/cloudflare-pages.md`](documentation/cloudflare-pages.md).

## How it is built

A static, client-side application: Vite, TypeScript and the DOM. No UI
framework — the document is plain JSON and the store is 300 lines, which is
what makes undo/redo, autosave, `.printnest` export and the test suite all
the same structural clone.

```
src/core/      the document model, imposition, storage, validation, checks
src/render/    page, sheet, canvas and PDF renderers
src/ui/        screens, panels, dialogs, editor interactions
templates/     nineteen editable JSON layout definitions
printer-profiles/  starter printer descriptions
documentation/ deployment, architecture, printing notes, the user guide
tests/         292 unit tests across seven suites
```

Two dependencies, both lazily loaded and only for PDF work:
[`pdf-lib`](https://github.com/Hopding/pdf-lib) for export and
[`pdfjs-dist`](https://github.com/mozilla/pdf.js) for import.

Some choices worth knowing about:

- **Everything is millimetres.** Paper, margins, element positions, bleed. Units
  only exist at the edges, where a user types a number or a renderer needs
  points or pixels. Pages are laid out in real `mm` in the DOM, so
  `@page { size: 210mm 297mm; margin: 0 }` gives a 1:1 print with no scaling
  arithmetic anywhere.
- **Imposition is pure functions.** No DOM, no store, fully tested — including
  the back-side geometry, which is where home booklet printing usually
  goes wrong.
- **The flip is stored as a motion**, not as "long edge"/"short edge": those
  names mean opposite physical actions on portrait and landscape paper.

Architecture notes: [`documentation/architecture.md`](documentation/architecture.md).

## Privacy

Every image, PDF and piece of text you bring in is read by your own browser and
stays on your device. There is no upload, no account, no analytics, no
trackers and no third-party scripts. After the first load PrintNest makes no
network requests at all — put the device in aeroplane mode and it keeps
working.

See [PRIVACY.md](PRIVACY.md).

## Security

- Strict Content Security Policy: `default-src 'none'`, no inline scripts, no
  `eval`, nothing loaded from another origin.
- Imported SVGs are parsed and stripped of scripts, event handlers,
  `foreignObject`, embedded images, animations and every external reference.
- PDFs are rendered through PDF.js with scripting, XFA and network access off,
  and rasterised, so nothing from the PDF's object graph reaches the project.
- Project files are parsed with a prototype-pollution-safe reviver and
  normalised field by field.
- Files are identified by their byte signature, not by their extension or
  their claimed MIME type.
- User text is only ever written with `textContent`.

See [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, printer profiles and templates are all welcome —
see [CONTRIBUTING.md](CONTRIBUTING.md). Printer profiles are especially
useful: if you have measured your printer's real margins with the calibration
page, that is worth sharing.

## Licence

MIT — see [LICENSE](LICENSE).

---

**PrintNest by Storitellah**
*Make it. Arrange it. Print it at home.*

Made with care by [Storitellah](https://storitellah.com) ·
[hello@storitellah.com](mailto:hello@storitellah.com)
