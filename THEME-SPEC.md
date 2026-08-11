# Health Connectivity: following the host theme

Status: the agreed target. Live progress is in `THEME-LOG.md`. Nothing counts as done because it
is written here; each item is done when the log says so and a test proves it.

---

## 1. Why this exists

Opening this DApp inside Signet drops the user from a light product into a dark one. The shell,
the rail and the Data Vault are light; this panel is `#090d16`. It reads as leaving the product
rather than moving within it, which is exactly what Signet's own review flagged about branding on
8 August.

It is not a third-party constraint. This repository is ours, and the served bundle is built from
it: the dappId here, `7f3b1c20-9d4e-4a6b-bf2a-2c5e8d11a4f0`, is the one the marketplace serves.

## 2. Why it happens

Two facts, both verified in source rather than assumed:

1. **The theme never reaches this DApp.** Signet passes `theme` as the third argument to
   `init(container, secureInterface, params)` and broadcasts later changes as a `signet:theme`
   window event. `init` here takes two arguments and reads its config from
   `secureInterface.getParameters()`, which carries `apiToken`, `apiBaseUrl` and `env` and no
   theme. So the value is available and simply never read.
2. **Every colour is hardcoded inline.** There is no stylesheet: `dist/index.css` is a comment
   saying so. All colour lives in one `styles` object in `src/app/init.tsx`, as inline style
   props. That is why the host cannot override it from outside without blanket `!important`
   rules that would also flatten the backgrounds this DApp intends.

The second fact is what makes fixing the source the only honest option, and it is also what makes
it easy: the colours are in one place.

## 3. What should be true

- On load, the DApp paints itself in the theme Signet handed it.
- When the user flips the theme, this panel follows, without a reload.
- Standalone, with no host, it still renders. Light is the default, matching the product.
- The light palette is Signet's own, not an invented one, so the two sit side by side without a
  seam.
- Dark stays available and keeps this DApp's current character rather than becoming a flat
  inversion.

## 4. The palette

Light values are Signet's tokens, taken from the Data Vault's `index.css` rather than sampled by
eye:

| Role | Light | Dark (current) |
|---|---|---|
| Page ground | `#f4fafa` | `#090d16` |
| Card surface | `#ffffff` | `#111827` |
| Nested surface | `#f4fafa` | `#0d1424` |
| Primary text | `#1f2330` | `#f1f5f9` |
| Secondary text | `#47506a` | `#94a3b8` |
| Muted text | `#6b7280` | `#64748b` |
| Hairline | `#e7e9f0` | `#1f2937` |
| Accent | `#0084c0` | `#38bdf8` |
| Input ground | `#ffffff` | `#1f2937` |

Semantic colours (warning amber, success green) keep their hue in both themes and are only
adjusted where contrast demands it.

## 5. What this is not

Not a redesign. Layout, copy, spacing and behaviour are untouched; only colour moves. Not a
Tailwind migration: the inline-style approach stays, because rewriting the styling system in the
same change would make any visual regression impossible to attribute.

## 6. How it is proven

- **Unit**: the theme resolver returns the light palette for `'light'`, the dark palette for
  `'dark'`, light for a missing or malformed value, and every token defined in one theme exists
  in the other.
- **Contract**: `init` reads `params.theme`, subscribes to `signet:theme`, and unsubscribes when
  the DApp is torn down, so a remount does not stack listeners.
- **Live**: loaded in a browser against the built bundle, in light and dark, with a mid-session
  theme flip.
