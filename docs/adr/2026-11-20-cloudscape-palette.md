# Cloudscape Palette

## Status

Accepted

## Context

The site's light theme used an orange and brown brand ramp (`#b45309` / `#92400e`)
on squid-ink accents, a warm off-white page (`#faf9f7`) and brown inline code.
Readers found these accents off brand next to the AWS CDK Developer Guide, which
uses the neutral Cloudscape colors: white and gray surfaces, near-black text and
blue links. The dark theme used orange links on squid-ink surfaces, which also does
not match the guide's dark palette. Several stylesheets copied the old values by
hand, so a palette change has to reach all of them.

This decision replaces the Palette section of
[brand theme and icons](./2026-10-15-brand-theme-and-icons.md). The logo, icons
and every other part of that decision are unchanged.

## Decision

`custom.css` sets the Cloudscape light palette in `:root` and the matching
Cloudscape dark palette in `.dark`. Only documented `--vp-*` variables are
overridden, so every default-theme component keeps working.

| Role | Light | Dark |
|---|---|---|
| Page `--vp-c-bg` | `#ffffff` | `#161d26` |
| `--vp-c-bg-alt` | `#f6f6f9` | `#0f141a` |
| `--vp-c-bg-soft`, `--vp-c-bg-elv` | `#f6f6f9` | `#1b232d` |
| Body text `--vp-c-text-1` | `#0f141a` | `#c6c6cd` |
| Links, active nav `--vp-c-brand-1` | `#006ce0` | `#42b4ff` |
| Link hover `--vp-c-brand-2` | `#001a99` | `#75cfff` |
| `--vp-c-brand-3` | `#ff9900` | `#ff9900` |
| `--vp-c-brand-soft` | `rgba(0, 108, 224, 0.1)` | `rgba(66, 180, 255, 0.16)` |
| `--vp-c-tip-1` / `--vp-c-tip-2` | `#001a99` / `#000833` | `#42b4ff` / `#75cfff` |
| Inline code `--vp-code-color` | `#0f141a` | `#ebebf0` |
| Linked code `--vp-code-link-color` | `#001a99` | `#42b4ff` |
| Code language label | `#424650` | `#a4a4ad` |
| Divider `--vp-c-divider` | `#c6c6cd` | `#424650` |
| Primary button bg, hover, active | `#ff9900`, `#e68a00`, `#d98a00` | same |
| Primary button text | `#0f141a` | `#0f141a` |

The light page background is pure white again. The warm off-white surface and
the orange-on-squid-ink identity are gone. Links, active states and focus are
blue. Orange stays only for primary buttons and the home hero: the hero wordmark
is an orange gradient (`#ff9900` to `#e68a00` light, `#ffb84d` to `#ff9900`
dark), and the hero glow pairs orange with the new ink.

Linked code in light mode uses the hover blue `#001a99`, not brand-1. Brand-1
`#006ce0` measures only 3.74 to 4.32:1 on the gray code chips and the tip tint,
which fails AA; `#001a99` clears 9.81:1 on each of them.

Hand-written copies follow the palette: the decoupled code-theme chrome in
`code-theme.css` mirrors the new surfaces and dividers, the signature keyword
color and the API badge pair use the hover blue (`#001a99` / `#75cfff` on
`#e6f0fc` / `#1d3549`), and the member-row flash starts at `#f2f8fd` light and
`#1b2a3a` dark.

Every variable in `:root` that sets a text color MUST be re-declared in `.dark`
with an explicit value, not a `var()` reference. `custom.css` loads after the
default theme and `:root` matches `<html>` at the same specificity as `.dark`, so
an unshadowed `:root` value silently wins in dark mode and produces dark-on-dark
text.

Every text and surface pair meets WCAG AA (>= 4.5:1). Brand-1 measures 4.97:1 on
the light page and 7.44:1 on the dark page, and body text 18.5:1 and 9.99:1.

## Consequences

- The site matches the AWS CDK Developer Guide in both color modes.
- The per-kind badge palette (`--cdk-badge-*`), Shiki token colors, the logo
  filter, the deprecated marker and the type link colors are not part of this
  palette and keep their own values.
- Contrast pins in the theme and accessibility tests are computed from these
  tokens, so a future palette change fails the suite until every pair is
  re-measured.
