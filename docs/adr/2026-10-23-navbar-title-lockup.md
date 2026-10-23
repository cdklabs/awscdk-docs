# Navbar Title Lockup

## Status

Accepted. Supersedes the site-title color and accessible-name rules in
[navbar, footer, and layout](./2026-10-15-navbar-footer-and-layout.md#one-navbar-divider-and-a-steady-title-color)
and [brand theme and icons](./2026-10-15-brand-theme-and-icons.md#logo-and-copyright).

## Context

The stock VitePress title placed the AWS logo directly beside the words
"AWS CDK Reference" with an 8px gap. The title used the secondary text color,
and below 960px it kept the full text in one line with an ellipsis. The result
looked like one repeated "AWS AWS" label, had weak contrast in dark mode, and
showed a broken product name on narrow screens.

The logo's `alt` text and the visible title also combined into the accessible
name "AWS AWS CDK Reference". A responsive visual label must not change the
name announced for the home link.

## Decision

- The home link keeps one logo image and one root URL. The image is decorative
  inside this named link, so its `alt` text is empty.
- `NavSiteTitle.vue` supplies two painted labels and one visually hidden name.
  The full label is "AWS CDK Reference", the short label is "CDK Reference",
  and the accessible name is always "AWS CDK Reference".
- The full label appears at 430-767px and from 960px upward. The short label
  appears at 390-429px. The logo stands alone below 390px and at 768-959px,
  where VitePress moves the desktop controls into the same row.
- Labels switch with `display`; no visible label is clipped or ellipsized. The
  full accessible name remains in the DOM at every width.
- The title uses `--vp-c-text-1` in every interaction state. The logo-to-label
  gap is 16px. The existing logo color and dark-mode filter stay unchanged.
- The link keeps a 44px minimum mobile target and gains a visible brand-color
  focus outline. No other navbar control changes.

## Consequences

- The product name is complete whenever text is shown, and every tested navbar
  width fits without overlap.
- The same link name is announced at every width without repeating "AWS".
- The medium layout shows only the logo even though some narrower mobile rows
  show text; this follows VitePress's larger control set at 768px.
- The responsive thresholds belong to the current navbar controls. Tests at
  320, 360, 390, 430, 768, 960, and 1280px catch future width changes.
