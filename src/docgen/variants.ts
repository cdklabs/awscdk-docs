import * as spec from '@jsii/spec';
import { codeFence } from './fences.js';
import {
  DEFAULT_LANGUAGE,
  FENCE_LANG,
  Language,
  LANGUAGES,
  translateInitializer,
} from './languages.js';
import { pageHref } from './links.js';
import { ignoreBlock, PAGEFIND_IGNORE } from './search.js';
import { SignatureOptions } from './signatures.js';

/**
 * Model B variant embedding: every page carries the language-variant regions — signatures, member names, type
 * references — for EVERY enabled language, toggled client-side by the shared `<LanguageTabs>` state.
 * Language-neutral prose (summaries, remarks, property descriptions) stays single-copy.
 *
 * Canonical identity rule: URL slugs and member heading anchors always use the language-stable (jsii/TypeScript)
 * name — only display text flips — so a `#member` deep link resolves in every language and survives a client-side
 * language switch.
 *
 * With a single enabled language every helper returns that language's canonical rendering with no wrapper.
 */

/** Enabled languages in canonical display order, deduplicated. */
export function orderedLanguages(languages: readonly Language[]): Language[] {
  return LANGUAGES.map((l) => l.id).filter((id) => languages.includes(id));
}

/** Variant embedding is active only when 2+ languages are enabled. */
export function isMultiLanguage(languages: readonly Language[]): boolean {
  return orderedLanguages(languages).length >= 2;
}

/**
 * The canonical language for a set of enabled languages: the site default when enabled, else the first enabled
 * language in canonical order. Search indexing keys off this: only the canonical variant of each region is indexed
 * by Pagefind, so the index carries one language's identifiers per symbol regardless of how many the page embeds.
 */
export function canonicalLanguage(languages: readonly Language[]): Language {
  const langs = orderedLanguages(languages);
  return langs.includes(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : (langs[0] ?? DEFAULT_LANGUAGE);
}

/**
 * Attributes for one `.lang-variant` element. Non-canonical variants carry `data-pagefind-ignore` so Pagefind
 * indexes each region once — in the canonical language — instead of once per enabled language.
 */
function variantAttrs(lang: Language, canonical: Language, hydrated = false): string {
  // A non-canonical INERT variant is static transliterated markup shown or hidden purely by the `<LanguageTabs>`
  // scoped CSS, never read as vnodes. Mark it `v-pre` so the Vue SSR compiler skips it instead of re-encoding it
  // into the page's hydration chunk; those chunks are the dominant artifact cost at scale, and `v-pre` keeps the
  // merged site under the 1 GB GitHub Pages artifact limit. The canonical variant stays hydrated so its cross-linked
  // TypeScript signatures and type tooltips keep working. (`v-pre` is compile-time, consumed during SSR, so it
  // never appears in the emitted HTML.)
  //
  // `v-pre` is scoped to inert regions ONLY: a variant whose markup the theme wires up at runtime — the `## Example`
  // fenced code blocks, which compile into Shiki `language-<lang>` divs with the copy-code button — must stay
  // hydrated (`hydrated: true`), or the button ships dead on every non-canonical tab. The Pagefind ignore attribute
  // applies to every non-canonical variant either way.
  const ignore = lang === canonical ? '' : ` ${PAGEFIND_IGNORE}`;
  const pre = lang === canonical || hydrated ? '' : ' v-pre';
  return `class="lang-variant" data-lang="${lang}"${pre}${ignore}`;
}

/** Opening tag of a `<LanguageTabs>` group for the given languages. */
export function languageTabsOpen(langs: readonly Language[]): string {
  return `<LanguageTabs :langs="[${langs.map((l) => `'${l}'`).join(', ')}]">`;
}

/** Options for {@link languageVariantBlocks}. */
export interface VariantBlockOptions {
  /**
   * Keep non-canonical variants hydrated — no `v-pre`. Required whenever the variant markup is wired up by the theme
   * at runtime rather than being inert: the code-example fences (examples.ts) compile into Shiki `language-<lang>`
   * divs carrying VitePress's copy-code button, which `v-pre` would ship dead on every non-canonical tab. Defaults
   * to false: inert regions (signatures, property spans) stay `v-pre` to keep the artifact under the 1 GB Pages limit.
   */
  readonly hydrated?: boolean;
}

/**
 * Emit one block variant per enabled language inside a `<LanguageTabs>`
 * group (single language: the bare canonical rendering, no wrapper).
 * The blank lines around each variant keep markdown-it parsing any
 * markdown content inside the plain-div children (the same type-6
 * HTML-block pattern the expandable props rows use).
 */
export function languageVariantBlocks(
  languages: readonly Language[],
  render: (lang: Language) => string[],
  options: VariantBlockOptions = {},
): string[] {
  const langs = orderedLanguages(languages);
  if (langs.length <= 1) {
    return render(langs[0] ?? DEFAULT_LANGUAGE);
  }
  const canonical = canonicalLanguage(langs);
  const lines: string[] = [languageTabsOpen(langs)];
  for (const lang of langs) {
    lines.push(`<div ${variantAttrs(lang, canonical, options.hydrated)}>`, '', ...render(lang), '', '</div>');
  }
  lines.push('</LanguageTabs>', '');
  return lines;
}

/**
 * Inline variant spans, one per enabled language (single language: the
 * bare rendering, no wrapper). Used where a variant is a fragment of a
 * shared, single-copy structure (a props row, a table cell) rather than
 * a whole block. Only meaningful inside a surrounding `<LanguageTabs>`
 * group (see {@link wrapLanguageTabs}), whose active language drives
 * which span is visible.
 */
export function languageVariantSpans(
  languages: readonly Language[],
  render: (lang: Language) => string,
): string {
  const langs = orderedLanguages(languages);
  if (langs.length <= 1) {
    return render(langs[0] ?? DEFAULT_LANGUAGE);
  }
  const canonical = canonicalLanguage(langs);
  return langs
    .map((lang) => `<span ${variantAttrs(lang, canonical)}>${render(lang)}</span>`)
    .join('');
}

/**
 * Wrap shared markup that carries inline {@link languageVariantSpans}
 * in a `<LanguageTabs>` group, so the shared language state reaches the
 * spans (the component hides every `.lang-variant` not matching the
 * active language). Single language: the lines pass through untouched.
 */
export function wrapLanguageTabs(languages: readonly Language[], lines: string[]): string[] {
  const langs = orderedLanguages(languages);
  if (langs.length <= 1) {
    return lines;
  }
  return [languageTabsOpen(langs), '', ...lines, '', '</LanguageTabs>', ''];
}

/**
 * Language-stable anchor slug for a member: matches VitePress's slugify (@mdit-vue/shared) output for the canonical
 * (jsii/TypeScript) member name, so `#member` deep links resolve byte-for-byte. Mirrors the slugify subset relevant
 * to jsii identifiers: non-alphanumeric runs collapse to `-`, edges trimmed, leading digit guarded, then lowercased.
 */
export function memberAnchor(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

/**
 * Initializer signature variants, emitted as REAL fenced code blocks so they flow through the same markdown-it ->
 * Shiki pipeline as authored `## Example` blocks, making an initializer and an example in the same language visually
 * indistinguishable. The fence inherits the shared memoized `markdown.highlight` hook, the `vp-code` class, `v-pre`
 * on the `<pre>`, and VitePress's copy button.
 *
 * The whole section stays out of the Pagefind index via the surrounding `ignoreBlock`, which excludes every
 * language's signature.
 *
 * `hydrated: true` for the same reason as the example fences: the Shiki output carries the runtime-wired copy-code
 * button, which `v-pre` on the variant wrapper would ship dead on non-canonical tabs.
 *
 * Inline type links survive the move to fences: the fence info line carries a `type-links=Name:href,…` attribute
 * mapping every linkable named parameter type (PascalCase is language-invariant, so one map serves every variant)
 * to its page, and the shared highlight hook wraps those identifiers in `<a>` tags — see `applyTypeLinks` in
 * `docs/.vitepress/config.mts`.
 *
 * Initializers are single-line in every language; long signatures scroll horizontally like example code.
 */
export function initializerSignatureVariants(
  type: spec.ClassType,
  languages: readonly Language[],
  options: SignatureOptions,
): string[] {
  const params = [...(type.initializer?.parameters ?? [])];
  const links = typeLinksAttr(params, options.linkFor);
  const fenceInfo = (lang: Language) => `${FENCE_LANG[lang]}${links ? ` ${links}` : ''}`;
  return ignoreBlock(
    languageVariantBlocks(
      languages,
      (lang) => codeFence(translateInitializer(type.name, params, lang), fenceInfo(lang)),
      { hydrated: true },
    ),
  );
}

/**
 * Build the `type-links=Name:href,…` fence attribute for a parameter
 * list: every named type reachable from the parameters (through
 * collections and unions) that resolves to a page, keyed by the display
 * name `translateTypeRef` emits (the trailing PascalCase segment of the
 * FQN — identical in every language). The attribute must stay a single
 * whitespace-free token: markdown-it hands the fence info to the
 * highlight hook with inner whitespace stripped. Names are jsii
 * identifiers and hrefs are site paths, so `:` and `,` are safe
 * separators; an ambiguous name (two FQNs sharing a display name in one
 * signature) is dropped rather than linked to the wrong page.
 */
export function typeLinksAttr(
  params: readonly spec.Parameter[],
  linkFor: SignatureOptions['linkFor'],
): string {
  const byName = new Map<string, string | undefined>();
  const visit = (ref: spec.TypeReference): void => {
    if (spec.isNamedTypeReference(ref)) {
      const href = linkFor(ref.fqn);
      if (!href) {
        return;
      }
      const name = ref.fqn.split('.').pop()!;
      if (byName.has(name) && byName.get(name) !== href) {
        byName.set(name, undefined); // ambiguous — drop
      } else {
        byName.set(name, href);
      }
      return;
    }
    if (spec.isCollectionTypeReference(ref)) {
      visit(ref.collection.elementtype);
      return;
    }
    if (spec.isUnionTypeReference(ref)) {
      ref.union.types.forEach(visit);
    }
  };
  for (const param of params) {
    visit(param.type);
  }
  const pairs = [...byName.entries()]
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !/[\s,:]/.test(entry[1]))
    .map(([name, href]) => `${name}:${pageHref(href)}`);
  return pairs.length > 0 ? `type-links=${pairs.join(',')}` : '';
}
