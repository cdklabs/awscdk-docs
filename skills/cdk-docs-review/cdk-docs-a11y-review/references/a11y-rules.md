# Accessibility rules: the lookup

Rows are grouped by family: semantics and names, interaction and states, layout and themes, evidence.
See the `cdk-docs-review-principles` skill for the shared lookup convention.

## Semantics and names

**[A11Y-SEM-NESTED-INTERACTIVE] (BLOCKING)**: An interactive element inside another (a permalink or button
inside a `<summary>`, a link inside a link, a button inside a `role="button"` row). axe
`nested-interactive`: screen readers announce only the outer control, so the inner one is unreachable for
them. Move the inner control out of the outer one's subtree.

**[A11Y-SEM-NAME-MISMATCH] (BLOCKING)**: An `aria-label` that does not contain the control's visible text.
WCAG 2.5.3 Label in Name: a voice-control user says what they see and the command does not match. Either
drop the `aria-label` or start it with the visible text.

**[A11Y-SEM-ICON-NO-NAME] (BLOCKING)**: An icon-only control (`#` permalink, copy button, theme toggle)
with no accessible name. Add an `aria-label` or visually hidden text.

**[A11Y-SEM-LOST-STRUCTURE] (RECOMMENDED)**: A list, table or heading turned into generic `div`s, or a
heading level skipped. axe does not flag most of these, yet a screen-reader user loses item counts and
navigation by heading. (doc-absent detail) Check the accessibility tree in the browser, not the axe
report.

**[A11Y-SEM-DECORATIVE-ANNOUNCED] (RECOMMENDED)**: A decorative glyph, separator or badge announced as
content. Add `aria-hidden="true"`; for a copyable row, also `user-select: none` so it does not land in the
clipboard.

## Interaction and states

**[A11Y-INT-KEYBOARD] (BLOCKING)**: A control reachable by mouse but not by keyboard, a focus trap, or a
hover-only reveal with no `:focus-visible` equivalent. A keyboard user cannot reach the feature.

**[A11Y-INT-FOCUS-INVISIBLE] (BLOCKING)**: `outline: none` (or equivalent) on a focusable element with no
replacement focus style. WCAG 2.4.7.

**[A11Y-INT-TARGET-SIZE] (RECOMMENDED)**: A new pointer target under 24×24 CSS px without the spacing
exception. WCAG 2.5.8; `test/e2e/a11y-target-size.spec.ts` guards existing targets, extend it for new ones.

**[A11Y-INT-STATE-UNTESTED] (RECOMMENDED)**: A change verified in one state only: a disclosure checked
open but not closed, a sidebar checked expanded but not collapsed, a component checked after hydration
but its SSR markup not. Up-tier BLOCKING when the unchecked state is broken (content hidden, overlapping
or unreachable).

- **Detection method (doc-absent detail):** list every state the element can be in, load each, and look.
  The quality-gates ADR notes the navbar filter, language toggle, lazy sidebar and tooltips "only exist
  after hydration", so an audit of generated markup misses them.

**[A11Y-INT-MOTION] (OPTIONAL)**: New animation or smooth scroll with no `prefers-reduced-motion` guard.

## Layout and themes

**[A11Y-LAY-NARROW] (BLOCKING)**: Content clips, overlaps or forces horizontal scroll below the sidebar
breakpoint or at 320-375px. WCAG 1.4.10 Reflow.

- **Detection method (doc-absent detail):** an element positioned into a gutter (negative margin, absolute
  offset) has a gutter at desktop widths that becomes page padding on mobile. Measure its bounding box at
  375px and assert `left >= 0`.

**[A11Y-LAY-LOAD-BEARING-REMOVED] (BLOCKING)**: A removed CSS property or markup that was doing work the
diff does not account for: spaces that acted as line-break opportunities, a `position: relative` that
anchored an absolutely positioned child, a `min-width: 0` that let a flex child shrink.

- **Detection method (doc-absent detail):** for each removed declaration, delete it alone on the base
  build and compare. If the page changes, the PR owes a replacement.

**[A11Y-LAY-CONTRAST] (BLOCKING)**: Text or a meaningful icon below 4.5:1 (3:1 for large text and UI
components) in either theme. Check light and dark separately; a color variable can pass in one and fail in
the other.

**[A11Y-LAY-DUPLICATE-RULE] (RECOMMENDED)**: The same selector declared twice with conflicting values, so
the effective style depends on source order. Merge into one rule set. A test that matches only the first
copy is `GEN-TEST-HOLLOW` (general dimension).

**[A11Y-LAY-SHIFT-ON-HOVER] (RECOMMENDED)**: Revealing an element on hover or focus moves surrounding
content. Reserve the space or position the revealed element out of flow, and assert the row's box does not
change after hover.

## Evidence

**[A11Y-EV-NOT-DIFFERENT] (RECOMMENDED)**: Before and after screenshots that do not show the change: both
taken from the same build (a stash or base checkout that did not rebuild), or cropped so the changed
element is out of frame. `AGENTS.md` rule 9 requires visual evidence for visual changes; evidence that
shows nothing does not meet it. Report in the summary.

**[A11Y-EV-MISSING-STATE] (OPTIONAL)**: Evidence for a visual change covers one theme or one width when the
change plausibly affects the other. Ask for the missing frame.
