// While a rollout leaves hosts on different builds, a page can get a 404 for one of its content-hashed assets. The page
// requests the file again with `cache: "reload"` (the 404 is cacheable for five minutes) and reloads only if a host
// serves it, at most twice per path. Offline, or with the file gone everywhere, nothing happens.

export const RECOVER_GLOBAL = "__cdkDocsRecoverAssets";

function recoveryScript(base: string): string {
  return `;(function () {
  var assets = location.origin + ${JSON.stringify(`${base}assets/`)};
  var reloading = false;
  function reloadIfServed(url) {
    var key = "cdk-docs-asset-recovery:" + location.pathname;
    var reloads = Number(sessionStorage.getItem(key));
    if (reloads >= 2) return;
    fetch(url, { cache: "reload" }).then(function (response) {
      if (!response.ok || reloading) return;
      reloading = true;
      sessionStorage.setItem(key, reloads + 1);
      location.reload();
    }, function () {});
  }
  addEventListener("error", function (e) {
    var url = e.target.href || e.target.src;
    if (e.target.rel !== "prefetch" && typeof url === "string" && url.indexOf(assets) === 0) reloadIfServed(url);
  }, true);
  window.${RECOVER_GLOBAL} = function () { reloadIfServed(location.href); };
})();`;
}

/** Put the script right after `<meta charset>`, so it listens before the stylesheet and module tags load. */
export function injectAssetRecovery(html: string, base: string): string {
  const anchor = '<meta charset="utf-8">';
  if (!html.includes(anchor)) {
    throw new Error(`no ${anchor} in the rendered page to put the asset recovery script after`);
  }
  return html.replace(anchor, `${anchor}<script>${recoveryScript(base)}</script>`);
}
