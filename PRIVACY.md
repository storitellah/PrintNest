# Privacy

**Short version: PrintNest never sees your work. It cannot — there is nowhere
for it to go.**

## Your files stay on your device

Every image, PDF and piece of text you bring into PrintNest is read by your own
browser, held in your own device's memory and storage, and never sent anywhere.
There is no server that receives your files, because there is no server at all
— PrintNest is a static website that runs entirely in the browser tab.

## Where projects are stored

Projects live in your browser's local database (IndexedDB), scoped to this site
on this device. They are not synchronised, backed up or shared.

Two consequences worth knowing:

- Clearing your browser's site data deletes your projects. Export a
  `.printnest` file for anything you want to keep.
- Projects do not follow you to another device or another browser. Moving work
  between devices means exporting a project file and opening it on the other
  device.

PrintNest asks the browser for persistent storage, which reduces the chance of
projects being evicted automatically when disk space runs low. Browsers may
decline that request.

## Printing

When you print, PrintNest builds the pages and hands them to your browser,
which passes them to your operating system's printing service — the same route
every other application uses. That is why AirPrint, Mopria, Wi-Fi, USB and
network printers all work.

PrintNest never talks to your printer directly, and it never learns which
printer you chose, what you printed, or whether the job succeeded. The printer
profile in Settings is a description **you** write or edit; it is stored
locally and used only to give better advice.

## Analytics

There are none. No analytics, no telemetry, no error reporting, no session
recording, no cookies for tracking, no third-party scripts of any kind.

Nothing about your files, their names, their contents, your printer, your
projects or your usage is measured or transmitted.

## The network

The application is downloaded once from wherever it is hosted, then cached by a
service worker for offline use. After that PrintNest makes no network requests
at all. You can put the device in aeroplane mode and it keeps working —
including templates, help pages and PDF import and export.

The only network requests that can originate from the page are the ones your
browser makes to fetch the application itself.

## Fonts

PrintNest uses the fonts already installed on your device rather than loading
them from a font service, so nothing about your usage leaks through a font
request. This also means the application looks and measures identically
offline.

## External links

The footer links to `storitellah.com` and to the project's GitHub repository.
Following a link is a normal navigation, and those sites have their own privacy
practices. PrintNest sends `Referrer-Policy: no-referrer`, so they are not told
where you came from.

## Children

PrintNest collects nothing from anybody, of any age. It is suitable for
classroom use without any data-processing agreement, because no data is
processed anywhere but on the device in front of you.

## Questions

[hello@storitellah.com](mailto:hello@storitellah.com)
