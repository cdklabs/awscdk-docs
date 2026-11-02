// While a rollout leaves hosts on different builds, a page can get a 404 for one of its content-hashed assets. A reload
// may reach a host that has it, but the browser can reuse the cached 404 for five minutes, so the assets are refetched
// past the cache first.

export const RECOVER_GLOBAL = "__cdkDocsRecoverAssets";

function recoveryScript(base: string, isNotFoundPage: boolean): string {
  return `;(function () {
  var assets = location.origin + ${JSON.stringify(`${base}assets/`)};
  var startUrl = location.href;
  var started = false;
  function recover() {
    var key = "cdk-docs-asset-recovery:" + location.pathname;
    var reloads = Number(sessionStorage.getItem(key));
    if (started || reloads >= 2) return;
    started = true;
    sessionStorage.setItem(key, reloads + 1);
    var urls = performance.getEntriesByType("resource").map(function (e) { return e.name; });
    Promise.all(urls.filter(function (u) { return u.indexOf(assets) === 0; }).map(function (u) {
      return fetch(u, { cache: "reload" }).catch(function () {});
    })).then(function () { location.reload(); });
  }
  addEventListener("error", function (e) {
    var url = e.target.href || e.target.src;
    if (typeof url === "string" && url.indexOf(assets) === 0) recover();
  }, true);
  window.${RECOVER_GLOBAL} = function () {
    if (!${isNotFoundPage} || location.href !== startUrl) recover();
  };
})();`;
}

/** Put the script right after `<meta charset>`, so it listens before the stylesheet and module tags load. */
export function injectAssetRecovery(html: string, base: string, page: string): string {
  const anchor = '<meta charset="utf-8">';
  if (!html.includes(anchor)) {
    throw new Error(`no ${anchor} in ${page} to put the asset recovery script after`);
  }
  return html.replace(anchor, `${anchor}<script>${recoveryScript(base, page === "404.md")}</script>`);
}
