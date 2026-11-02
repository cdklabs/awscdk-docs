// Recovers a page whose content-hashed build assets fail to load. The hosting fleet takes a new build host by host,
// so for a while a page from one build can request assets from a host that still serves the other build and get a
// 404. Each retry can land on another host, so the page fetches its assets again past the browser cache (which keeps
// the 404 for minutes) and reloads, a bounded number of times.

/** Global the not-found view calls when it mounts, so a page that exists but failed to load can recover. */
export const RECOVER_GLOBAL = "__cdkDocsRecoverAssets";

/** sessionStorage key holding the reload attempts for the current path. */
export const RECOVERY_KEY = "cdk-docs-asset-recovery";

/** Reloads allowed per path within {@link RECOVERY_WINDOW_MS}. */
export const MAX_RECOVERY_RELOADS = 2;

/** Window in which reloads of one path count towards {@link MAX_RECOVERY_RELOADS}. */
export const RECOVERY_WINDOW_MS = 60_000;

/** The element VitePress emits first in every page's `<head>`; the script goes right after it. */
const HEAD_ANCHOR = '<meta charset="utf-8">';

/**
 * The inline recovery script for one page. `isNotFoundPage` is true only for the 404 page the host serves for a
 * missing address, where the not-found view is the correct result and must not trigger a reload.
 */
export function assetRecoveryScript(base: string, isNotFoundPage: boolean): string {
  const config = JSON.stringify({
    assets: `${base}assets/`,
    notFound: isNotFoundPage,
    key: RECOVERY_KEY,
    max: MAX_RECOVERY_RELOADS,
    windowMs: RECOVERY_WINDOW_MS,
  }).replace(/</g, "\\u003c");
  // Written one statement per line for review; every line ends a statement or opens a block, so joining is safe.
  return `;(function (c) {
  var assets = location.origin + c.assets, startUrl = location.href, started = false;
  function isAsset(u) { return typeof u === "string" && u.indexOf(assets) === 0; }
  function nextAttempt() {
    try {
      var s = JSON.parse(sessionStorage.getItem(c.key) || "null");
      var n = s && s.path === location.pathname && Date.now() - s.at < c.windowMs ? s.n : 0;
      if (n >= c.max) return -1;
      sessionStorage.setItem(c.key, JSON.stringify({ path: location.pathname, n: n + 1, at: Date.now() }));
      return n;
    } catch (e) { return -1; }
  }
  function recover() {
    if (started) return;
    var n = nextAttempt();
    if (n < 0) return;
    started = true;
    var urls = {}, nodes = document.querySelectorAll("link[href],script[src]"), i;
    for (i = 0; i < nodes.length; i++) if (isAsset(nodes[i].href || nodes[i].src)) urls[nodes[i].href || nodes[i].src] = 1;
    var entries = performance.getEntriesByType ? performance.getEntriesByType("resource") : [];
    for (i = 0; i < entries.length; i++) if (isAsset(entries[i].name)) urls[entries[i].name] = 1;
    Promise.all(Object.keys(urls).map(function (u) { return fetch(u, { cache: "reload" }).catch(function () {}); }))
      .then(function () { setTimeout(function () { location.reload(); }, 1000 * n); });
  }
  addEventListener("error", function (e) { var t = e.target; if (t && (isAsset(t.href) || isAsset(t.src))) recover(); }, true);
  addEventListener("vite:preloadError", recover);
  window.${RECOVER_GLOBAL} = function () { if (!c.notFound || location.href !== startUrl) recover(); };
  addEventListener("load", function () {
    var links = document.querySelectorAll('link[rel~="stylesheet"]');
    for (var i = 0; i < links.length; i++) if (isAsset(links[i].href) && !links[i].sheet) return recover();
    if (!window.__VP_SITE_DATA__) return recover();
    if (!started) try { sessionStorage.removeItem(c.key); } catch (e) {}
  });
})(${config});`.replace(/\n\s*/g, "");
}

/** Inject the recovery script ahead of the page's stylesheet and module tags, so it sees their load errors. */
export function injectAssetRecovery(html: string, base: string, page: string): string {
  if (!html.includes(HEAD_ANCHOR)) {
    throw new Error(`cannot inject the asset recovery script: no ${HEAD_ANCHOR} in the rendered page ${page}`);
  }
  return html.replace(HEAD_ANCHOR, `${HEAD_ANCHOR}<script>${assetRecoveryScript(base, page === "404.md")}</script>`);
}
