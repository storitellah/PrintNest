# Printer profiles

A printer profile is PrintNest's description of what a printer can and cannot
do. It is used for **advice**, never for control: a web page cannot interrogate
a printer, so everything here is either a shipped starting point or something a
user measured.

Every field is editable in the app, because drivers, firmware and regional
model variants differ — a profile you cannot correct is worse than none.

## Where the shipped profiles live

The ten starter profiles are defined in
[`src/core/printerProfiles.ts`](../src/core/printerProfiles.ts). They are code
rather than JSON because they are the fallback used when storage is
unavailable, so they have to be in the bundle unconditionally.

The JSON files in this folder are the same data in a portable form, for
reference and for contributions.

## Contributing a profile

If you have run PrintNest's calibration page and know your printer's real
behaviour, that is genuinely useful. Open an issue with the printer profile
template, or a pull request adding a JSON file here.

The measurements worth having:

- **Minimum margins** — the rulers on the calibration page show exactly where
  printing starts on each edge.
- **Borderless sizes** — the calibration page prints a blue band to all four
  edges; if it reaches them, borderless is working for that size.
- **Duplex behaviour** — which way the stack has to be turned over, and whether
  pages come out printed side up or down. The one-sheet test in the manual
  duplex assistant answers both.

## Field reference

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier; lowercase, hyphenated |
| `brand`, `model` | As printed on the machine |
| `technology` | `inkjet`, `ink-tank`, `laser`, `dye-sublimation` or `thermal` |
| `color` | Whether it prints in colour at all |
| `paperSizes` | Catalogue ids it can take — see `src/core/paper.ts` |
| `maxPaperSizeId` | The largest of them |
| `borderlessSizes` | Sizes it prints edge to edge. Empty means none. |
| `autoDuplex` | Can it turn the paper over by itself? |
| `manualDuplex` | Can the paper be reloaded by hand? |
| `minMargins` | The unprintable strip, per edge, in millimetres |
| `rearFeed`, `mainTray` | Which paper paths exist |
| `photoPaper` | Whether it takes photo stock |
| `connections` | Wi-Fi, USB, AirPrint, Mopria, Bluetooth, local network |
| `defaultQuality`, `qualityOptions` | As the driver names them |
| `defaultPaperType`, `paperTypes` | As the driver names them |
| `duplexFlip` | `left-right`, `top-bottom` or `unknown` — the motion, not driver jargon |
| `outputFaceUp` | Whether pages stack printed side up |
| `scaleCorrection` | Measured with the calibration page; 1 means accurate |
| `notes` | Anything practical a user should know |

`duplexFlip` stores the physical motion rather than "long edge"/"short edge",
because those names mean opposite actions on portrait and landscape paper.
