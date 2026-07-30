# Deploying PrintNest to Cloudflare Pages

PrintNest is a static site with no backend, so deployment is genuinely just
"build it and upload the folder". These are the exact settings, and the
reasoning behind the configuration files.

## Connecting the repository

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) and open
   **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorise Cloudflare for your GitHub account and pick the `printnest`
   repository.
3. Configure the build:

   | Setting | Value |
   | --- | --- |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | *(leave blank)* |

4. Under **Environment variables**, add `NODE_VERSION` = `22` (or newer).
   Cloudflare's default is older than PrintNest's build tooling supports, and
   the test suite's jsdom needs at least 22.
5. **Save and Deploy.**

> **The build command and output directory are not optional.** Cloudflare's
> defaults for "Framework preset: None" are an *empty* build command and the
> repository root as the output directory. Accept those and the deploy still
> reports success — it simply publishes the source tree instead of the
> application, and the site never starts. This has happened; see
> [When the page shows only the PrintNest logo](#when-the-page-shows-only-the-printnest-logo).

The first build takes a couple of minutes. Every push to the default branch
deploys automatically; every pull request gets its own preview URL.

## One project per site

Connect the repository **once**. If two Pages projects point at it, every push
runs two builds and produces two preview URLs, and after a merge there are two
production deployments — whichever one carries the custom domain is the real
site and the other quietly shadows it. If you find a spare, delete it under
**Workers & Pages → the project → Settings → Delete project**.

The project name matters in one place only: `wrangler pages deploy
--project-name <name>` for a manual deploy. Nothing in the application
hard-codes it.

## What `npm run build` does

```
tsc --noEmit                          # typecheck; fails the build on an error
vite build                            # the application → dist/
vite build --config vite.sw.config.ts # the service worker → dist/sw.js
```

The service worker is built separately because it has to sit at a stable,
unhashed path at the root of the scope it controls — a hashed
`sw-a1b2c3.js` cannot control `/`.

`dist/precache.json` is emitted during the main build and lists every asset for
the worker to cache at install time. Keeping the list in a separate file means
the worker's own contents do not change on every deploy, so browsers do not
reinstall it for no reason.

## The files in `public/`

Cloudflare copies everything in `public/` into `dist/` verbatim.

### `_headers`

Response headers, applied by path.

- **`Content-Security-Policy`** — `default-src 'none'` with each capability
  opted into. This is the header that actually enforces `frame-ancestors`;
  the meta tag in `index.html` is only a fallback for other hosts, and
  browsers ignore `frame-ancestors` there.
- **`Permissions-Policy`** — switches off every sensor and device API.
  PrintNest needs none of them, so denying them all costs nothing.
- **`Cross-Origin-Opener-Policy: same-origin`** and
  **`Cross-Origin-Resource-Policy: same-origin`** — isolate the browsing
  context. PrintNest does not need `Cross-Origin-Embedder-Policy`, and
  setting it would break nothing but gain nothing either.
- **Cache rules**:
  - `/assets/*` — `immutable`, one year. Vite content-hashes these, so a
    changed file is a changed name; they can never go stale.
  - `/icons/*` — one day. Not hashed, but rarely changed.
  - `index.html`, `manifest.webmanifest`, `precache.json`, `sw.js` —
    `max-age=0, must-revalidate`. These are the entry points; caching them
    would mean a deploy did not reach anyone until their cache expired.
- **`Service-Worker-Allowed: /`** on `sw.js`, so the worker may claim the
  whole origin.

### `_redirects`

```
/*    /index.html   200
```

The single-page fallback. Status `200` rewrites rather than redirects, so the
address bar is untouched. Real files are matched first, so a missing asset
still returns a genuine 404 instead of silently serving HTML.

PrintNest keeps its state in memory and IndexedDB rather than in the URL, so
there are no client-side routes to preserve — this exists so that a stray or
shared deep link opens the application instead of an error page.

### `404.html`

Cloudflare serves this for a genuine not-found. Because of the rewrite above
it is rarely reached, but it exists so a mistyped asset path is not a blank
page.

### `offline.html`

Shown by the service worker when someone reaches PrintNest for the first time
with no connection, before anything has been cached.

### `boot-watchdog.js`

The only JavaScript in `public/`, and it is there rather than in `src/` on
purpose: files in `public/` are copied verbatim, never bundled. As a second
Vite entry point the bundler merged it into the application chunk, which made
it fail alongside the very thing it exists to report on.

It watches for a start that never happens — a refused script, a missing chunk,
a policy that blocks the bundle — and replaces the loading state with the
reason and what to check. `index.html` loads it as a classic, non-deferred
script ahead of the bundle, because its listeners have to be registered before
the browser starts fetching the thing it is watching.

Being outside the bundle, it does not appear in `precache.json`, so `src/sw.ts`
lists it in `SHELL` by hand. The file that explains a failed start is the worst
possible one to be missing offline.

## Verifying a deployment

After the first deploy, check:

1. **The app loads** — the home screen shows the project options, not the logo
   on its own. If it is just the logo, go to
   [When the page shows only the PrintNest logo](#when-the-page-shows-only-the-printnest-logo).
2. **Headers are applied** —
   `curl -sI https://your-project.pages.dev | grep -i content-security`
   should show the policy.
3. **It installs** — the browser offers "Install" or "Add to Home Screen".
4. **It works offline** — load it once, then switch to offline in DevTools and
   reload. The application, templates and help pages should all still work.
5. **It prints** — open a project, press Print, and confirm the browser's
   print preview shows your sheets at the right size and nothing else.

## When the page shows only the PrintNest logo

The logo, the name and the tagline on a plain background, for ever. That is the
static loading state in `index.html`, and seeing it means the page was served
but the application code never ran.

**First, look at the page itself.** PrintNest now diagnoses this on its own, and
which of the two messages you get tells you where to look:

| What you see | What it means |
| --- | --- |
| "This site was published without being built" | The host is serving the repository, not `dist/`. Fix the build settings below. |
| "PrintNest could not start", naming a file | The build is right but a file did not load. The named file and the browser console say why. |
| Neither — just the logo | Older deploy, from before those messages existed. Work through the checks below. |

**The build settings.** In **Workers & Pages → your project → Settings → Build**:

| Setting | Must be |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `22` or newer |

Then **Deployments → Retry deployment**, or push a commit — changing the
settings does not rebuild anything on its own.

**Confirming it from the terminal**, which is quicker than clicking around:

```bash
# The published HTML must reference a hashed bundle, never a .ts file.
curl -s https://your-project.pages.dev/ | grep -o 'src="[^"]*"'
```

`./assets/index-<hash>.js` is correct. `/src/main.ts` means the repository is
being served: browsers refuse TypeScript as a module script — a static host
labels `.ts` as `video/mp2t`, the MPEG transport stream — and the application
never starts.

```bash
# The security headers only exist if public/ was published as the site root.
curl -sI https://your-project.pages.dev/ | grep -i content-security-policy
```

No output is the same diagnosis: `public/_headers` is not at the deployment
root, so the whole of `public/` went to the wrong place.

**Other causes, once the build settings are right:**

- **A stale service worker.** DevTools → Application → Service Workers →
  *Unregister*, then reload. Bump `VERSION` in `src/sw.ts` to force this for
  everyone on the next deploy.
- **A blocked script.** The console names the directive. Compare the
  `Content-Security-Policy` header against `public/_headers`; a proxy or a
  host-level rule may be adding a stricter one of its own.
- **A partial upload.** Retry the deployment.

## A custom domain

**Custom domains → Set up a domain**. If the domain is already on Cloudflare
the DNS record is created for you; otherwise add the CNAME Cloudflare shows.
HTTPS is provisioned automatically.

Nothing in PrintNest hard-codes a domain, so no rebuild is needed.

## Deploying by hand

Without the Git integration:

```bash
npm run build
npx wrangler pages deploy dist --project-name printnest
```

## Hosting it somewhere else

Any static host works: GitHub Pages, Netlify, Vercel, S3, or a folder on your
own machine served over HTTPS. Two things to carry across:

- **The security headers.** Other hosts have their own mechanism — Netlify
  reads the same `_headers` format; nginx and Apache need their own
  configuration. Without them the meta-tag CSP still applies, but
  `frame-ancestors` and the cross-origin policies do not.
- **HTTPS.** Service workers and persistent storage require a secure context.
  `localhost` counts as secure for development.

`base: './'` in `vite.config.ts` means the build uses relative paths, so it
also works from a subdirectory such as `example.com/printnest/`.
