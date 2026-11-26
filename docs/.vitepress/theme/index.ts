// Extend the VitePress default theme with CDK brand styling, the navbar
// type-ahead symbol filter, interactive API page layout, doc-footer
// contribution links, favorite pages, the global language toggle, the
// lazy-loaded API sidebar, and two tri-state theme controls (a
// Light/Device/Dark site picker and an independent Light/Default/Dark
// code-block theme).
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme-without-fonts";
import { h, nextTick, onMounted } from "vue";
import ApiSidebar from "./ApiSidebar.vue";
import { initCodeTheme } from "./code-theme";
import CopyMarkdown from "./CopyMarkdown.vue";
import { applyFoldoutsAfterNavigation, initDensity } from "./density";
import ExplorerPreviewPicker from "./ExplorerPreviewPicker.vue";
import ExplorerRail from "./ExplorerRail.vue";
import ExplorerViewsButton from "./ExplorerViewsButton.vue";
import { initExplorerPreview } from "./explorer-preview";
import { installFavoritesSearchBoost } from "./favorites-client";
import FavoriteStar from "./FavoriteStar.vue";
import FavoritesList from "./FavoritesList.vue";
import LanguageTabs from "./LanguageTabs.vue";
import LanguageToggle from "./LanguageToggle.vue";
import { installMemberFlash } from "./member-flash";
import JumpToCurrent from "./JumpToCurrent.vue";
import NavFilter from "./NavFilter.vue";
import NavStylePicker from "./NavStylePicker.vue";
import NavSiteTitle from "./NavSiteTitle.vue";
import NotFound from "./NotFound.vue";
import PageFooterLinks from "./PageFooterLinks.vue";
import { warmSearchIndex } from "./search-client";
import { installSearchHotkeys, markSearchShortcuts } from "./search-hotkeys";
import SettingsMenu from "./SettingsMenu.vue";
import SiteFooter from "./SiteFooter.vue";
import BackToTop from "./BackToTop.vue";
import ThemePicker from "./ThemePicker.vue";
import { installTypeTooltips } from "./type-tooltips";
import VersionBadge from "./VersionBadge.vue";
import "./custom.css";
import "./typeface.css";
import "./signatures.css";
import "./api-layout.css";
import "./density.css";
import "./responsive.css";
import "./wide-layout.css";
import "./favorites.css";
import "./api-sidebar.css";
import "./theme-picker.css";
import "./code-theme.css";
import "./nav-controls.css";
import "./explorer-preview.css";
import "./outline.css";
import "./home-features.css";
import "./callouts.css";
import "./glyphs.css";

// Set in enhanceApp, called from setup and after each route change.
let flashMember: (hash: string) => void = () => {};

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // The symbol filter belongs in the sidebar rather than the nav header:
      // it is a navigation aid for the API tree beside it. Both children share
      // one wrapper so the block can be made sticky together — see
      // `.sidebar-header` in api-sidebar.css.
      // With the Explorer preview on, the view rail comes first in the DOM and the Views button
      // (below 960px) heads the pinned block; both render nothing while the preview is off.
      "sidebar-nav-before": () => [
        h(ExplorerRail),
        h("div", { class: "sidebar-header" }, [
          h(ExplorerViewsButton),
          h(NavFilter, null, { "status-actions": () => h(JumpToCurrent) }),
          h(FavoritesList),
        ]),
      ],
      "doc-before": () => [h(FavoriteStar), h(CopyMarkdown)],
      "doc-after": () => h(PageFooterLinks),
      // The generated Service -> Resource -> Kind tree, fetched once. Inert
      // outside the /api/ section.
      "sidebar-nav-after": () => h(ApiSidebar),
      // The title stays one root link, with responsive visual labels and one
      // stable accessible name. VitePress still owns the link and logo.
      "nav-bar-title-after": () => h(NavSiteTitle),
      // Navbar: language slider (multi-language builds only), centered search,
      // and the two tri-state theme pickers behind the gear Settings dropdown.
      // Positioning is flex `order` + centering in nav-controls.css. The
      // aws-cdk-lib version badge sits just left of the gear.
      "nav-bar-content-after": () => [h(LanguageToggle), h(VersionBadge), h(SettingsMenu)],
      // Below 768px the Settings dropdown is hidden (nav-controls.css), so the
      // hamburger screen carries its controls directly, navigation style included,
      // while the Explorer preview is off. With it on, explorer-preview.css hides these
      // rows and the rail's Settings panel holds them.
      "nav-screen-content-after": () => [
        h(LanguageToggle),
        h(ThemePicker),
        h(NavStylePicker),
        h(ExplorerPreviewPicker),
      ],
      // Site-wide footer: community links + AWS legal line. In layout-bottom
      // because themeConfig.footer is hidden by the default theme on sidebar
      // pages (every /api/** page).
      "layout-bottom": () => [h(SiteFooter), h(BackToTop)],
      // Not-found body. Must be the `not-found` SLOT, not the theme's top-level
      // `NotFound` key: the slot renders the body, while the key is only the
      // client router's fallback for a page module it cannot load.
      "not-found": () => h(NotFound),
    }),
  enhanceApp({ app, router, siteData }) {
    // Client-side language tabs sharing one global language state. Registered
    // globally because generated markdown pages instantiate them directly.
    app.component("LanguageTabs", LanguageTabs);
    // Re-apply a stored decoupled code-block theme choice at client boot.
    // No-op on the server and when the code theme follows the site theme.
    initCodeTheme();
    // Re-apply a stored layout-density choice at client boot. No-op on the
    // server and at the default (Balanced) level, which carries no attribute.
    initDensity();
    // Re-apply a stored Explorer preview choice at client boot. No-op on the server and while the preview is off.
    initExplorerPreview();
    // Mark the member row a jump lands on. Same-page links arrive as `hashchange`;
    // the route hook below covers back/forward, cross-page links with a hash and,
    // in a build, the initial load.
    flashMember = installMemberFlash();
    // Spacious opens every fold-out; a client-side navigation renders a new
    // page whose fold-outs start closed, so reapply the level after each one.
    // Chained so any hook another module set keeps running.
    const previousAfterRouteChange = router.onAfterRouteChange;
    router.onAfterRouteChange = async (to) => {
      await previousAfterRouteChange?.(to);
      applyFoldoutsAfterNavigation();
      // SSR renders through the same hook with no window; `to` is then not a jump to flash.
      if (typeof location !== "undefined") {
        // The new page's rows exist after Vue has patched the route component in.
        await nextTick();
        flashMember(new URL(to, location.href).hash);
      }
    };
    installTypeTooltips(siteData.value.themeConfig.typeSummariesAsset ?? "");
    installFavoritesSearchBoost();
    // `/` opens the Pagefind dialog beside the plugin's own Cmd+K / Ctrl+K.
    installSearchHotkeys();
    // Eagerly initialize Pagefind: the plugin's own idle loader leaves a window
    // where the first search silently returns an empty result. Runs after the
    // favorites trap so the warmed handle still gets filters + boosting.
    warmSearchIndex();
  },
  setup() {
    // Runs inside the root component, so the navbar search button exists once mounted.
    onMounted(markSearchShortcuts);
    // A load with a member hash: in a build the route hook already marked the server-rendered row;
    // on the dev server the rows exist only after mount, so this call covers it.
    onMounted(() => flashMember(location.hash));
  },
};

export default theme;
