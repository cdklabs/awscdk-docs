// Extend the VitePress default theme with CDK brand styling, the navbar
// type-ahead symbol filter, interactive API page layout, doc-footer
// contribution links, favorite pages, the global language toggle, the
// lazy-loaded API sidebar, and two tri-state theme controls (a
// Light/Device/Dark site picker and an independent Light/Default/Dark
// code-block theme).
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme-without-fonts";
import { h } from "vue";
import ApiSidebar from "./ApiSidebar.vue";
import { initCodeTheme } from "./code-theme";
import { installFavoritesSearchBoost } from "./favorites-client";
import FavoriteStar from "./FavoriteStar.vue";
import FavoritesList from "./FavoritesList.vue";
import LanguageTabs from "./LanguageTabs.vue";
import LanguageToggle from "./LanguageToggle.vue";
import JumpToCurrent from "./JumpToCurrent.vue";
import NavFilter from "./NavFilter.vue";
import NotFound from "./NotFound.vue";
import PageFooterLinks from "./PageFooterLinks.vue";
import { warmSearchIndex } from "./search-client";
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
import "./favorites.css";
import "./api-sidebar.css";
import "./theme-picker.css";
import "./code-theme.css";
import "./nav-controls.css";
import "./outline.css";
import "./home-features.css";
import "./callouts.css";
import "./glyphs.css";

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // The symbol filter belongs in the sidebar rather than the nav header:
      // it is a navigation aid for the API tree beside it. Both children share
      // one wrapper so the block can be made sticky together — see
      // `.sidebar-header` in api-sidebar.css.
      "sidebar-nav-before": () =>
        h("div", { class: "sidebar-header" }, [
          h(NavFilter, null, { "status-actions": () => h(JumpToCurrent) }),
          h(FavoritesList),
        ]),
      "doc-before": () => h(FavoriteStar),
      "doc-after": () => h(PageFooterLinks),
      // The generated Service -> Resource -> Kind tree, fetched once. Inert
      // outside the /api/ section.
      "sidebar-nav-after": () => h(ApiSidebar),
      // Navbar: language slider (multi-language builds only), centered search,
      // and the two tri-state theme pickers behind the gear Settings dropdown.
      // Positioning is flex `order` + centering in nav-controls.css. The
      // aws-cdk-lib version badge sits just left of the gear.
      "nav-bar-content-after": () => [h(LanguageToggle), h(VersionBadge), h(SettingsMenu)],
      "nav-screen-content-after": () => [h(LanguageToggle), h(ThemePicker)],
      // Site-wide footer: community links + AWS legal line. In layout-bottom
      // because themeConfig.footer is hidden by the default theme on sidebar
      // pages (every /api/** page).
      "layout-bottom": () => [h(SiteFooter), h(BackToTop)],
      // Not-found body. Must be the `not-found` SLOT, not the theme's top-level
      // `NotFound` key: the slot renders the body, while the key is only the
      // client router's fallback for a page module it cannot load.
      "not-found": () => h(NotFound),
    }),
  enhanceApp({ app, siteData }) {
    // Client-side language tabs sharing one global language state. Registered
    // globally because generated markdown pages instantiate them directly.
    app.component("LanguageTabs", LanguageTabs);
    // Re-apply a stored decoupled code-block theme choice at client boot.
    // No-op on the server and when the code theme follows the site theme.
    initCodeTheme();
    installTypeTooltips(siteData.value.themeConfig.typeSummariesAsset ?? "");
    installFavoritesSearchBoost();
    // Eagerly initialize Pagefind: the plugin's own idle loader leaves a window
    // where the first search silently returns an empty result. Runs after the
    // favorites trap so the warmed handle still gets filters + boosting.
    warmSearchIndex();
  },
};

export default theme;
