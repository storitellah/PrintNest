# The PrintNest user guide

*Make it. Arrange it. Print it at home.*

This guide walks through the things people actually do with PrintNest, in the
order they usually do them. Everything here also lives inside the app, under
Help.

---

## Before anything else: is your printer honest?

Most disappointing home prints come from one cause: the printer quietly
shrinking the page. Drivers do this by default under names like "fit to page",
"shrink oversized pages" or "scale to fit", and the result is a print a few per
cent smaller than you designed — which ruins folded booklets and any print that
was supposed to be a specific size.

Five minutes now saves a lot of paper later:

1. Open **Printer setup** (the gear icon), choose your printer, and open
   **Calibration**.
2. Print the calibration page on plain paper. **Set the scale to 100 % or
   "Default" in the print dialog** — not "Fit to page".
3. Measure the 100 mm line with a ruler.
4. Type what you measured back in and apply the correction.

While you have the sheet, look at the rulers along the top and left edge. They
show exactly where your printer starts printing. Put those numbers into the
printer profile as the minimum margins, and PrintNest will warn you before you
place something where it cannot be printed.

If the line measures more than about 3 % out, "fit to page" is almost certainly
still on. Turn it off and print the test again before applying a correction
that large.

---

## Making an eight-page mini zine

The classic: one sheet of A4, three folds, one cut, eight pages.

1. **Zine Maker** on the home screen. PrintNest sets A4 landscape and quarter
   pages for you.
2. Drop your pictures anywhere on the window. They land one per page.
3. Page 1 is the cover and page 8 is the back cover. Type over the placeholder
   text.
4. Switch the preview to **Print sheets** and check it: page 1 should sit at the
   bottom right, and the top row should be upside down. That is correct — it is
   what makes the folding work.
5. **Print.** One side of one sheet; leave duplex off.

### Folding it

1. Fold the sheet in half the short way. Crease. Open it out.
2. Fold in half the long way. Crease. Open out.
3. Fold the long way once more. Crease. Open out flat.
4. Cut the short slit along the centre line — **only** between the two middle
   folds. It is marked in red on the printed guide.
5. Fold the sheet the long way again and push the two ends towards each other.
   The slit opens into a diamond.
6. Flatten the pages around so the cover ends up on the outside.

---

## Making an A5 booklet

1. **Booklet Maker.** A4 landscape, two A5 pages per side.
2. Keep the page count in fours — a folded sheet always holds four pages. The
   checklist offers to add the blanks for you.
3. Set a **binding margin** of 5–8 mm so text does not disappear into the fold.
4. Press **Print**. Because this needs both sides, PrintNest opens the manual
   duplex assistant.

### Manual duplex, once

The assistant prints the front sides, waits, shows you exactly how to turn the
stack over, and then prints the backs in the right order.

Three things matter:

- **Do not tick "two-sided" in the printer driver.** PrintNest is handling both
  sides itself; the driver would flip them a second time.
- **Do not shuffle the stack.** Lift it out in one piece — the order is what
  makes the second pass land correctly.
- **Turn it the way the diagram shows.** Left to right is like turning a page in
  a book; top to bottom is like flipping a calendar.

If you are unsure which your printer needs, run the **one-sheet test**. It takes
a minute, and PrintNest remembers the answer for that printer from then on.

### Finishing

Stack the sheets in printed order and fold **the whole stack at once** — not
sheet by sheet. Staple twice along the fold, about a third in from each end.
On a thick booklet the inner pages will stick out slightly; trim the outer
edge flush.

---

## Printing photographs at a true size

1. **Photo Print**, then choose the finished size from the paper list — 4×6,
   5×7, 8×10 and the rest are all there.
2. Drop the photograph in. PrintNest keeps its proportions; use **Fill** only
   when you are happy to crop.
3. Watch the resolution badge on the selected image. It tells you the effective
   dots per inch at the printed size: 300 is photographic, 200 looks clean,
   below 150 you will see pixels. Screenshots are typically 72–96 dpi, so they
   only print well at about a third of their screen size.
4. In the print dialog, set the **paper type** to match what is in the tray.
   This matters more than the quality setting — glossy paper on a plain-paper
   setting looks flat and smudges.
5. Print at 100 %, and let the print dry a few minutes before stacking.

---

## Tiling a poster

1. **Poster Printer**, and add one image.
2. Either pick a grid ("4 sheets — 2 × 2") or type the finished size you want
   and let PrintNest work out how many sheets that needs.
3. Leave the **overlap** at about 10 mm. It gives you room to line the sheets
   up instead of needing a perfect edge-to-edge joint.
4. Print every sheet. Each carries its grid code in the corner, and the
   assembly map prints with them.
5. Lay all the sheets out following the map **before** sticking anything down.
6. Trim the top and left edge of each sheet to its guide line, lay it over its
   neighbour's overlap band, and tape from the back. Work row by row.

---

## Contact sheets

1. **Contact Sheet**, then drop in as many photographs as you like.
2. Pick a preset — client proof, student review, archive, film-style — or set
   the columns and rows yourself.
3. Turn file names, numbers and dates on or off. File names are what make a
   proof sheet useful: the person choosing can tell you which frame by name.

---

## Before you print anything

Press **Print** and read the checklist. It runs eleven checks and tells you
one of three things:

- **Ready to print** — every check passed.
- **Review suggested** — worth a look, but not fatal.
- **Action required** — printing now would waste paper. Printing is blocked
  until it is resolved.

Most items offer a one-click fix.

Then check the four settings PrintNest cannot control for you, because they
belong to your browser and operating system:

| Setting | What it should be |
| --- | --- |
| Paper size | The size shown on the print screen |
| Scale | 100 % or "Default" — **not** "Fit to page" |
| Margins | None |
| Background graphics | On, if your pages use background colours |
| Headers and footers | Off |

---

## Saving, moving and backing up work

Projects save themselves as you work, into your browser's own storage on this
device. They do not sync anywhere.

- **To keep something safely**, export a `.printnest` file. It contains the
  layout and every imported picture in one self-contained file.
- **To move a project to another device**, export a `.printnest` file there and
  open it on the other one — drop it onto the window, or use Open saved
  project.
- **Clearing your browser's site data deletes your projects.** Export first.

---

## Using less ink

Open **Ink saving** in the settings panel. The estimate updates as you change
things.

- **Greyscale** is the biggest single saving on a colour printer.
- **Dropping background fills** is the next: a full-page tint is by far the
  most expensive thing you can print.
- **Draft quality** in the print dialog is for proofs; save the good setting for
  the final copy.
- **White space costs nothing**, and usually looks better.

PrintNest reports ink use as low, medium or high. It cannot measure real
consumption — that depends on your driver, paper and cartridge — so it does not
pretend to.

---

## Choosing paper

| For | Use |
| --- | --- |
| Everyday prints and zines | 80–100 gsm plain paper — cheap, and it creases well |
| Booklet covers | 120–160 gsm; heavier than that will crack unless you score the fold first |
| Photographs | Glossy or lustre photo paper, with the paper type set in the driver |
| Artwork | Matte or fine-art inkjet paper, 200 gsm and up |

Thick paper usually needs the rear feed. Pushing card through a front tray is
the most common cause of jams.

---

## Keyboard shortcuts

| | |
| --- | --- |
| `Ctrl`/`⌘` `P` | Print |
| `Ctrl`/`⌘` `E` | Export |
| `Ctrl`/`⌘` `O` | Import files |
| `Ctrl`/`⌘` `Z` | Undo (add `Shift` to redo) |
| `Ctrl`/`⌘` `D` | Duplicate the selection |
| Arrow keys | Nudge by 1 mm (`Shift` for 10 mm) |
| `Alt` `↑`/`↓` on a page | Move that page up or down the list |
| `1`–`5` | Switch preview mode |
| `+` / `−` / `0` | Zoom in, out, fit |
| `?` | The full list |

---

## Working on a phone or tablet

Everything is available on a small screen. The side panels become bottom
sheets: **Pages** for the page list and imported files, **Settings** for the
document and element properties. Swipe left and right in the reading preview to
turn pages, and pinch to zoom.

Printing from a phone opens the system print sheet, which reaches AirPrint on
iOS and Mopria on Android — the same printers every other app can see.

---

## When something is not right

| It looks like | It is usually |
| --- | --- |
| Everything printed slightly small | "Fit to page" is on. Turn it off, then run the calibration page. |
| The second side is upside down | The stack was turned the other way. Run the one-sheet duplex test. |
| The second side printed on the blank side | The stack went back in the wrong way up. The test covers this too. |
| Background colours did not print | "Background graphics" is off in the print dialog. |
| Content is missing near the edge | It is inside the printer's unprintable margin. Set the printer profile's minimum margins and the checker will warn you next time. |
| A photograph looks soft | Check the resolution badge. Below 150 dpi, print it smaller. |

---

**PrintNest by Storitellah** · [storitellah.com](https://storitellah.com) ·
[hello@storitellah.com](mailto:hello@storitellah.com)
