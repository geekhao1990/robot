# One-day flow chart font subsets

The chart bundles only its required glyphs as WOFF data URLs in
`../dark-flow-fonts.wxss`. No runtime CDN request or server deployment is needed.
Numbers prefer the user's requested locally installed Bahnschrift. It is not
redistributed here; devices without it fall back to the bundled DarkFlowDigits.

- `DarkFlowDigits`, normal 400: subset of D-DIN Regular, Copyright 2017 Datto Inc.
  Source: https://github.com/amcchord/datto-d-din/blob/main/D-DIN.ttf
- `DarkFlowLabels`, 400 and 700: subsets of Noto Sans SC, Copyright 2014–2021 Adobe.
  Source: https://github.com/google/fonts/tree/main/ofl/notosanssc

Both are licensed under SIL OFL 1.1; original license notices and the D-DIN
font log accompany this file. Subsets have been renamed to avoid reserved names.
Generate them with `server/scripts/build-dark-flow-fonts.py` and FontTools.
These are visual matches, not a claim that the reference app uses these fonts.
