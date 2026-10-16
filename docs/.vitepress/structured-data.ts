// The per-page JSON-LD the config emits. No VitePress imports, so Jest can test the produced object directly.

import { contentRevised } from "../../src/page-history";
import { pageHistoryOf } from "./page-history";
import { pageUrl } from "./page-url";

/** The page fields the graph is built from — the subset of VitePress `PageData` this module reads. */
export interface StructuredDataPage {
  readonly relativePath: string;
  readonly title?: string;
  readonly description?: string;
  readonly frontmatter: Record<string, unknown>;
}

/** The publisher, shared by both page kinds. `sameAs` carries the canonical AWS entity URLs. */
export const PUBLISHER = {
  "@type": "Organization",
  name: "Amazon Web Services",
  url: "https://aws.amazon.com/",
  sameAs: ["https://en.wikipedia.org/wiki/Amazon_Web_Services", "https://www.wikidata.org/wiki/Q2401749"],
} as const;

export const SITE_NAME = "AWS CDK API Reference";

function website(siteUrl: string): Record<string, unknown> {
  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  return {
    "@type": "WebSite",
    "@id": `${base}#website`,
    name: SITE_NAME,
    url: base,
    publisher: PUBLISHER,
  };
}

/**
 * One schema.org node per page: `WebSite` on the home page, `TechArticle` elsewhere.
 *
 * `dateModified` is the release that last changed the page, read from the same version-history ledger the footer and
 * the `cdk-docs-*` metas use.
 */
export function structuredData(page: StructuredDataPage, siteUrl: string): Record<string, unknown> {
  const site = website(siteUrl);
  const revised = contentRevised(pageHistoryOf(page.frontmatter));
  if (page.relativePath === "index.md") {
    return { "@context": "https://schema.org", ...site, dateModified: revised.at };
  }
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title ?? "",
    ...(page.description ? { description: page.description } : {}),
    url: pageUrl(page.relativePath, siteUrl),
    isPartOf: { "@id": site["@id"] },
    publisher: PUBLISHER,
    dateModified: revised.at,
  };
}

/** The `<script type="application/ld+json">` entry, shaped as a VitePress `HeadConfig` tuple. */
export function structuredDataHead(
  page: StructuredDataPage,
  siteUrl: string,
): [string, Record<string, string>, string] {
  return ["script", { type: "application/ld+json" }, scriptJson(structuredData(page, siteUrl))];
}

/**
 * JSON for an HTML script element: `<`, `>`, `&`, U+2028 and U+2029 are written as JSON `\uXXXX` escapes, so the
 * text parses to the same object and cannot close the element.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
