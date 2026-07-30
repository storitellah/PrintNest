# Printing from PrintNest on a Brother DCP-T420W

A practical test profile for the printer PrintNest was developed against. Most
of it applies to the wider Brother Ink Tank range; the specifics were checked
on a DCP-T420W over both Wi-Fi and USB.

## What this printer can and cannot do

| | |
| --- | --- |
| Technology | Colour ink tank (refillable, not cartridges) |
| Paper sizes | A4, A5, A6, Letter, Legal, Executive, B5, photo sizes, postcard |
| Maximum | Legal |
| Automatic duplex | **No.** Use PrintNest's manual duplex assistant. |
| Borderless | **No.** There is always an unprintable edge. |
| Unprintable margin | About 3 mm on each edge; the bottom is the tightest on plain paper |
| Connections | Wi-Fi and USB |
| Paper path | Front tray only — no rear feed |
| Photo paper | Yes, including Brother BP71 |

The two that catch people out are the missing automatic duplex and the missing
borderless mode. Both are handled below.

## Setting it up in PrintNest

1. **Printer setup** (the gear icon) → choose **Brother DCP-T420W**.
2. Open **Calibration** and print the calibration page on plain A4, at 100 %.
3. Measure the 100 mm line and enter what you measured.
4. Read the rulers along the top and left edge of the printed sheet. They show
   where your particular unit actually starts printing — put those numbers into
   the profile as the minimum margins.

Now the pre-flight checker knows your real limits and will warn you before you
place something where this printer cannot print it.

## Print dialog settings

Whatever you are printing:

| Setting | Value |
| --- | --- |
| Paper size | A4 (or whatever PrintNest shows on the print screen) |
| Scale | **100 % or "Default"** — never "Fit to page" |
| Margins | None |
| Two-sided | **Off** — PrintNest handles duplex itself |
| Background graphics | On, if your pages use background colours |
| Headers and footers | Off |

Then, in the Brother driver's own options:

| For | Media Type | Quality |
| --- | --- | --- |
| Everyday, zines, proofs | Plain Paper | Fast or Normal |
| Booklet covers, artwork on plain paper | Plain Paper | Best |
| Photographs on glossy | Brother BP71 Photo (or Other Glossy) | Best |
| Draft check before a long run | Plain Paper | Fast |

Media Type matters more than Quality. Glossy paper printed on a Plain Paper
setting comes out flat and stays wet.

## Manual duplex, the way this printer likes it

The DCP-T420W has a front-loading tray and delivers pages **printed side up**,
which means the last sheet ends up on top. PrintNest's default profile knows
this and reverses the second pass, so you never have to re-sort the stack.

1. PrintNest prints the front sides. **Wait for the ink to dry** — this is an
   ink tank printer on plain paper, and thirty seconds saves a smudged booklet.
2. Lift the whole stack out in one piece. Do not shuffle it.
3. **Turn it left to right**, like turning a page in a book, keeping the top
   edge at the top.
4. Put it back in the tray **printed side down**, **top edge going in first**.
5. Press continue. PrintNest sends the backs in the right order.

If the second side comes out upside down, or on the blank side, run the
**one-sheet test** in the assistant. It takes a minute and PrintNest remembers
the answer for this printer permanently.

Do **not** enable any "two-sided" option in the Brother driver at the same
time. PrintNest is already handling both sides; the driver would flip them
again and produce nonsense.

## Getting edge-to-edge colour without borderless

This printer has no borderless mode, so a full-bleed cover has to be made by
printing oversized and trimming:

1. Set the **paper** to A4 but the **page** to something smaller — A5, or
   190 × 277 mm.
2. Set **bleed** to 3 mm and let full-page images overhang the page edge.
3. Turn **crop marks** on.
4. Print, then cut on the marks with a guillotine or a sharp knife and a steel
   rule.

The result is cleaner than most borderless modes give, because you are cutting
rather than relying on the printer to over-spray.

## Paper this printer is happy with

| Use | Weight | Notes |
| --- | --- | --- |
| Zines, everyday | 80–100 gsm plain | Cheapest, creases well, what this printer is designed for |
| Booklet covers | 120–160 gsm | Fine through the front tray; score the fold first above about 140 gsm |
| Photographs | Brother BP71 or similar glossy | Set the Media Type to match |
| Artwork | Up to about 200 gsm matte | Feed one sheet at a time |

There is no rear feed, so anything heavier than roughly 200 gsm is asking for a
jam. Load thick paper a few sheets at a time rather than filling the tray.

## Ink

An ink tank printer is cheap to run, which is exactly why it suits zine
printing — but the tanks are still finite:

- **Greyscale** for text-heavy interiors; save colour for covers and photos.
- **Fast quality** for proofs. You will proof more than you think.
- **Drop background fills.** A full-page tint on A4 is the single most
  expensive thing you can print.
- Watch PrintNest's ink estimate as you edit; it updates live.

## Wi-Fi versus USB

Both work identically from PrintNest's point of view — the browser hands the
job to the operating system, which reaches the printer however it is
configured.

- **Wi-Fi** is more convenient and is the only option from a phone or tablet.
  Make sure the printer and the device are on the same network.
- **USB** is worth switching to for a long booklet run: no dropped jobs
  halfway through a manual duplex pass, which would mean starting again.
- **iOS and iPadOS** reach this printer through AirPrint; **Android** through
  Mopria. Both appear in the normal system print sheet.

## If something goes wrong

| Symptom | Cause |
| --- | --- |
| Everything is slightly small | "Fit to page" is on. Turn it off and run the calibration page. |
| The second side is a half turn out | The stack was turned the wrong way. Run the one-sheet duplex test. |
| The second side printed on the blank side | The stack went in the wrong way up. Same test. |
| Content missing near the edge | Inside the 3 mm unprintable margin. Set the minimum margins in the profile. |
| Colours look washed out on glossy | Media Type is still Plain Paper. |
| Smudged booklet | Not dry before folding. Give it a minute. |
| Paper jam with card | No rear feed — feed thick stock a few sheets at a time. |

## Sharing your measurements

If you have run the calibration page on your DCP-T420W and measured different
margins, that is worth knowing —
[hello@storitellah.com](mailto:hello@storitellah.com) or an issue on GitHub.
Regional variants and firmware differ, which is exactly why every field in the
profile is editable.
