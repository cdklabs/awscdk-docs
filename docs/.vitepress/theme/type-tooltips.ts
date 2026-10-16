// Hover tooltips for cross-reference links on generated API pages. Docgen writes
// a type-summary lookup to `type-summaries.json` in the site root at build time;
// it is fetched lazily on the first hover and cached for the session.
import { withBase } from "vitepress";
import { API_DOCS_ROOT } from "../../../src/site-routes";

interface TypeSummary {
  name: string;
  kind: string;
  summary: string;
  /**
   * Reader-facing label for the kind chip. Docgen emits it only for leveled
   * constructs; `kind` stays the classification value.
   */
  label?: string;
  /** Canonical `L1`/`L2`/`L3` level, matching the sidebar's `data-level`. */
  level?: string;
}

type SummaryMap = Record<string, TypeSummary>;

const TOOLTIP_ID = "api-type-tooltip";

let loading: Promise<SummaryMap> | undefined;
let tooltip: HTMLElement | undefined;
let currentAnchor: HTMLAnchorElement | undefined;

function loadSummaries(): Promise<SummaryMap> {
  loading ??= fetch(withBase("/type-summaries.json"))
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return loading;
}

/** Page-link key for an anchor into the generated API docs, if any. */
function apiKeyFor(anchor: HTMLAnchorElement): string | undefined {
  const start = anchor.pathname.indexOf(API_DOCS_ROOT);
  if (start < 0) {
    return undefined;
  }
  return anchor.pathname.slice(start).replace(/\.html$/, "");
}

// Anchors that never get a preview: heading `#` permalinks and the right-hand
// "On this page" outline. Both point within the current page.
const SUPPRESSED_CONTAINERS = ".header-anchor, .VPDocAsideOutline";

/**
 * True when a hover preview must be suppressed for this anchor: it is a
 * heading permalink, lives in the aside outline, or resolves to the current
 * page itself (bare `#fragment` hrefs resolve to `location.pathname`).
 */
function suppressPreview(anchor: HTMLAnchorElement): boolean {
  return (
    anchor.closest(SUPPRESSED_CONTAINERS) !== null ||
    anchor.pathname === window.location.pathname
  );
}

function ensureTooltip(): HTMLElement {
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.className = "type-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function show(anchor: HTMLAnchorElement, entry: TypeSummary): void {
  const el = ensureTooltip();
  el.replaceChildren();
  const head = document.createElement("div");
  head.className = "type-tooltip-head";
  const name = document.createElement("strong");
  name.className = "type-tooltip-name";
  name.textContent = entry.name;
  const kind = document.createElement("span");
  kind.className = entry.level
    ? `type-tooltip-kind type-tooltip-kind-${entry.level.toLowerCase()}`
    : "type-tooltip-kind";
  kind.textContent = entry.label ?? entry.kind;
  head.append(name, kind);
  el.append(head);
  if (entry.summary) {
    const summary = document.createElement("p");
    summary.className = "type-tooltip-summary";
    summary.textContent = entry.summary;
    el.append(summary);
  }

  const rect = anchor.getBoundingClientRect();
  el.style.top = `${rect.bottom + 8}px`;
  el.style.left = "0px"; // reset before measuring width
  const width = el.offsetWidth;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  el.style.left = `${left}px`;
  el.setAttribute("aria-hidden", "false");
  anchor.setAttribute("aria-describedby", TOOLTIP_ID);
}

function hide(): void {
  currentAnchor?.removeAttribute("aria-describedby");
  currentAnchor = undefined;
  tooltip?.setAttribute("aria-hidden", "true");
}

function handleEnter(event: Event): void {
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a");
  if (!anchor || anchor === currentAnchor) {
    return;
  }
  const key = suppressPreview(anchor) ? undefined : apiKeyFor(anchor);
  if (!key) {
    hide();
    return;
  }
  currentAnchor = anchor;
  void loadSummaries().then((summaries) => {
    const entry = summaries[key];
    if (entry && currentAnchor === anchor && anchor.isConnected) {
      show(anchor, entry);
    }
  });
}

function handleLeave(event: Event): void {
  const target = event.target as Element | null;
  if (currentAnchor && target?.closest?.("a") === currentAnchor) {
    hide();
  }
}

// Hide on scroll, but only when the scrolled element can displace the tooltip's
// anchor: the document itself, or an ancestor of the anchor. The sidebar is an
// independent scroller whose scroll never moves a hovered content link.
function handleScroll(event: Event): void {
  const target = event.target as Node | null;
  if (
    !currentAnchor ||
    !target ||
    !(target instanceof Element) ||
    target.contains(currentAnchor)
  ) {
    hide();
  }
}

/** Install delegated hover/focus tooltip handlers (client only). */
export function installTypeTooltips(): void {
  if (typeof window === "undefined") {
    return;
  }
  document.addEventListener("mouseover", handleEnter, { passive: true });
  document.addEventListener("focusin", handleEnter);
  document.addEventListener("mouseout", handleLeave, { passive: true });
  document.addEventListener("focusout", handleLeave);
  window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
}
