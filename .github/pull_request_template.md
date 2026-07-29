## What this changes

<!-- One or two sentences. What is different afterwards? -->

## Why

<!-- What problem does it solve? If it fixes an issue, link it. -->

## Does it change what comes out of a printer?

<!--
This is the question that matters most in PrintNest. Imposition, page sizes,
margins, scaling and duplex all end up on real paper, and a subtle change is
not obvious until someone has wasted a stack of it.

Say "no" if it does not. If it does, say what changes and how you checked.
-->

## How it was checked

- [ ] `npm run test` passes
- [ ] `npm run build` passes (this runs the typechecker)
- [ ] Checked in the browser at desktop and mobile widths
- [ ] If it affects printing: compared the Print sheets preview against actual
      printed output, or against the PDF export

<!-- If you printed something, say what on what. That is real evidence. -->

## Accessibility

- [ ] Every new control is reachable and operable by keyboard
- [ ] Anything that is only an icon has an accessible name
- [ ] No state is conveyed by colour alone
- [ ] Any new animation is removed under `prefers-reduced-motion`

## Notes for the reviewer

<!-- Anything you are unsure about, or would like a second opinion on. -->
