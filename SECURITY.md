# Security

## Reporting a vulnerability

Email [hello@storitellah.com](mailto:hello@storitellah.com) with "PrintNest
security" in the subject. Please include what you did, what happened, and what
you expected. If you have a proof of concept, a `.printnest` file or an SVG
that demonstrates the issue is ideal.

Please do not open a public issue for a vulnerability until it has been fixed.

We aim to acknowledge within a few days. PrintNest has no server and no user
accounts, so the realistic attack surface is "a malicious file someone was
sent" — which is exactly what we most want to hear about.

## Threat model

PrintNest is a static, client-side application with no backend, no accounts and
no network requests after load. That removes most of the usual categories.
What remains:

1. **A malicious file** — an SVG, PDF or `.printnest` file crafted to run code,
   reach the network, or corrupt the application when opened.
2. **Cross-site scripting** through user-entered text (project names, captions,
   imported text) reaching the DOM as markup.
3. **Prototype pollution** through imported JSON reaching the object graph.
4. **Data exfiltration** — anything that could send local files anywhere.

## What is done about each

### Content Security Policy

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:; font-src 'self'; connect-src 'self' blob:;
worker-src 'self' blob:; manifest-src 'self'; media-src 'self' blob:;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Deny by default; every capability is opted into. No inline scripts, no `eval`,
nothing loadable from another origin. `connect-src 'self'` means that even if
something did execute, it would have nowhere to send data.

`style-src` allows `'unsafe-inline'` because the renderer positions elements
with inline styles in millimetres. Every value that reaches a style attribute
goes through `safeColor()` or is a number the application computed itself —
never a raw imported string.

The policy is served as a real header from `public/_headers`, with a meta-tag
fallback in `index.html` for hosts that do not read it.

### SVG import

An SVG is a document that can carry scripts, network references and embedded
content. `sanitizeSvg()` parses it, walks it and removes:

- `<script>`, `<foreignObject>`, `<image>`, `<a>`, `<animate*>` and anything
  else not on an explicit allow-list
- every `on*` event handler attribute
- every `href`/`src`/`data` attribute, except same-document `#fragment`
  references, which gradients and `<use>` legitimately need
- every `javascript:`, `data:`, `vbscript:`, `file:` and `blob:` URL
- every external `url()` in a paint or filter attribute
- `<style>` blocks containing `@import` or an external `url()`

The sanitised document is re-serialised, and only that version is stored.

### PDF import

PDFs are rendered through PDF.js with XFA off, system fonts off, and every
network-reaching option disabled. Document-level JavaScript is a viewer feature
this import path never opts into. Pages are rasterised to images, so nothing
from the PDF's own object graph survives into the project.

### Text and markup

User text is only ever written with `textContent`. `innerHTML` is not used
anywhere in the codebase. Imported Markdown is converted to **plain text**
blocks rather than rendered as HTML — the layout engine positions text itself,
so rendering markup would add an injection surface for no benefit.

### JSON import

`.printnest` files and template JSON are parsed with a reviver that drops
`__proto__`, `constructor` and `prototype`, then recursively stripped again,
then normalised field by field: every number is range-checked, every colour
passes `safeColor()`, every string is length-capped and stripped of control
characters, and unknown element types are discarded.

### File validation

Files are identified by their **byte signature**, not by their extension or
their browser-supplied MIME type, both of which are attacker-controlled. Size
limits are enforced per kind (100 MB overall, 5 MB text, 4 MB SVG, 500 files
per import), and asset payloads inside a project file are re-checked against an
allow-list of types on import.

### Dependencies

Two production dependencies, both well-established and both lazily loaded:
`pdf-lib` and `pdfjs-dist`. `package-lock.json` is committed. Run
`npm run audit` to check production dependencies.

Fonts are the system's own; nothing is fetched from a CDN, so there is no
subresource-integrity gap to cover.

### Other headers

`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security`, and a
`Permissions-Policy` that switches off every sensor and device API — PrintNest
needs none of them.

## What is deliberately not defended against

- **A user pasting their own malicious content.** PrintNest sanitises it, but
  the security boundary is the browser tab; there is no other user to protect.
- **Local device access.** Anyone who can read your browser profile can read
  your projects. That is true of every local-first application; use device
  encryption if it matters.
- **Denial of service through enormous files.** Size limits keep the common
  cases sane, but a sufficiently large import can still make a tab sluggish.
