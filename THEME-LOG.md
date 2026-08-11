# Health Connectivity theme: live status

Companion to `THEME-SPEC.md`. The spec says what should be true; this says what is true now, and
carries the evidence for each claim.

Last updated: 11 August 2026.

---

## Where things stand

| Item | State |
|---|---|
| Theme reaches the DApp | Not started |
| Palette resolver with light and dark | Not started |
| Colours read from the palette rather than hardcoded | Not started |
| Follows a live theme change | Not started |
| Verified in a browser, both themes | Not started |

## Established before any code, 11 August

Checked in source, not assumed:

- This repository is the one being served. Its `manifest.json` carries dappId
  `7f3b1c20-9d4e-4a6b-bf2a-2c5e8d11a4f0`, identical to the Oura dapp on signetapp.xyz, and the
  account has push and admin on it. No third party and no purchase is involved in changing it.
- The served bundle contains **zero** references to `signet:theme`. It has never subscribed.
- Signet does pass the theme: `DAppView` builds `paramsToPass` including
  `theme: currentTheme` and hands it to `init` as the third argument, then broadcasts changes on
  a `signet:theme` window event. The value is available and simply not read here.
- `init(container, secureInterface)` takes two arguments and reads config through
  `getParameters()`, which returns `apiToken`, `apiBaseUrl` and `env`. No theme. That is the gap.
- All colour is inline, in one `styles` object in `src/app/init.tsx`. `dist/index.css` is a
  47-byte comment confirming the DApp uses inline styles. Thirteen dark values appear across
  that object.

## Consequence worth recording

Because the colours are inline, a host-side CSS override would need blanket `!important` rules
on a wildcard selector, which would also flatten the surfaces this DApp deliberately paints, for
example its cards and badges. Fixing the source is not merely cleaner here, it is the only route
that does not break the DApp's own hierarchy.

## Changelog

- **11 Aug 2026**: audited the served bundle and this source, confirmed ownership and the exact
  reason the theme never arrives, wrote `THEME-SPEC.md` and opened this log. No code yet.
