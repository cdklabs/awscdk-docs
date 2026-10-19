// Site search: MiniSearch over the JSON index docgen writes at build time.
//
// Search runs as plain JavaScript in the browser — no WebAssembly — so it works
// under a Content Security Policy that forbids `wasm-unsafe-eval`. The index is
// one static asset (`/search/index.<hash>.json`, one entry per API page) fetched
// on the first search and indexed client-side; the engine and the index are then
// cached for the rest of the session.
//
// Filters: `module:aws-s3` / `kind:construct` tokens in the query text are
// parsed out and applied as exact-match filters on the entries' `module` and
// `kind` fields, so queries can be scoped (`bucket module:aws-s3 kind:construct`).
import MiniSearch from "minisearch";

/** One indexed page, as docgen wrote it (see `SearchIndexEntry` in src/docgen/search.ts). */
export interface SearchDocument {
  readonly link: string;
  readonly title: string;
  readonly kind: string;
  readonly module: string;
  readonly summary: string;
}

/** One ranked result. */
export interface SearchHit extends SearchDocument {
  readonly score: number;
}

/** Filter keys recognized in the query text. Unknown keys stay in the text. */
const FILTER_KEYS = new Set(["module", "kind"]);

/** Most results a query returns; the dialog shows them all. */
export const MAX_RESULTS = 25;

/**
 * Field boosts, tuned for an API reference where the signal is "this page IS
 * about the term" (its title names it) rather than "this page mentions the
 * term": a title hit outranks any summary hit, and the module slug counts a
 * little so `s3` surfaces the S3 pages before pages that merely mention S3.
 */
export const FIELD_BOOST = { title: 6, module: 1.5, summary: 1 } as const;

/** Multiplier for a page whose title equals the query term exactly. */
export const EXACT_TITLE_BOOST = 3;

export interface ParsedSearchQuery {
  /** Query text with recognized filter tokens removed. */
  text: string;
  /** Recognized filters, e.g. { module: ["aws-s3"], kind: ["construct"] }. */
  filters: Record<string, string[]>;
}

/**
 * Split `module:` / `kind:` tokens out of a raw query string. Tokens
 * with an empty value ("module:") and unknown keys ("foo:bar") are left
 * in the text untouched.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const filters: Record<string, string[]> = {};
  const rest: string[] = [];
  for (const word of raw.split(/\s+/)) {
    const m = /^([a-z]+):(.+)$/i.exec(word);
    const key = m?.[1].toLowerCase();
    if (m && key && FILTER_KEYS.has(key)) {
      (filters[key] ??= []).push(m[2].toLowerCase());
    } else if (word) {
      rest.push(word);
    }
  }
  return { text: rest.join(" "), filters };
}

/** Whether a document satisfies every parsed filter (each filter key accepts any of its listed values). */
export function matchesFilters(doc: SearchDocument, filters: Record<string, string[]>): boolean {
  return Object.entries(filters).every(([key, values]) => {
    const actual = key === "module" ? doc.module : key === "kind" ? doc.kind : undefined;
    return actual !== undefined && values.includes(actual.toLowerCase());
  });
}

/**
 * MiniSearch tokenizer tuned for API identifiers: splits on whitespace and
 * punctuation like the default, and additionally breaks camelCase so that
 * `PythonFunction` is found by `function` and `BucketProps` by `props`. The
 * whole identifier is kept as a token too, so an exact name still matches best.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/[\s\-_/.,:;()[\]{}<>"'`|@#&*+=!?]+/)) {
    if (!word) {
      continue;
    }
    tokens.push(word);
    const parts = word.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    if (parts.length > 1) {
      tokens.push(...parts);
    }
  }
  return tokens;
}

/**
 * A loaded search index: the MiniSearch engine plus the documents it was built
 * from, so a filter-only query ("module:aws-s3") can list pages without a term.
 */
export class SiteSearch {
  private readonly engine: MiniSearch<SearchDocument>;

  constructor(readonly documents: readonly SearchDocument[]) {
    this.engine = new MiniSearch<SearchDocument>({
      idField: "link",
      fields: ["title", "summary", "module"],
      storeFields: ["link", "title", "kind", "module", "summary"],
      tokenize,
      processTerm: (term) => term.toLowerCase(),
      searchOptions: {
        boost: FIELD_BOOST,
        prefix: true,
        fuzzy: 0.15,
        combineWith: "AND",
        // A page whose title IS the term (`Bucket` for `bucket`) outranks pages whose title merely contains or
        // extends it (`BucketProps`), which prefix matching would otherwise score alike.
        boostDocument: (_id, term, stored) => {
          const title = String((stored as SearchDocument | undefined)?.title ?? "").toLowerCase();
          return title === term ? EXACT_TITLE_BOOST : 1;
        },
      },
    });
    this.engine.addAll(documents as SearchDocument[]);
  }

  /** Ranked hits for a raw query, filter tokens applied; empty for an empty query. */
  search(raw: string, limit = MAX_RESULTS): SearchHit[] {
    const { text, filters } = parseSearchQuery(raw);
    const hasFilters = Object.keys(filters).length > 0;
    if (!text) {
      if (!hasFilters) {
        return [];
      }
      // Filter-only browse: every page matching the filters, titles in order.
      return this.documents
        .filter((doc) => matchesFilters(doc, filters))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, limit)
        .map((doc) => ({ ...doc, score: 0 }));
    }
    const results = this.engine.search(text, {
      filter: hasFilters ? (result) => matchesFilters(result as unknown as SearchDocument, filters) : undefined,
    });
    return results.slice(0, limit).map((result) => ({
      link: result.link as string,
      title: result.title as string,
      kind: result.kind as string,
      module: result.module as string,
      summary: result.summary as string,
      score: result.score,
    }));
  }
}

let loading: Promise<SiteSearch> | undefined;

/**
 * Fetch and index the search asset once per session. `url` is the site-absolute,
 * base-prefixed path of the JSON index; an empty url means docgen has not run
 * (dev server without generated docs) and yields an empty index.
 */
export function loadSiteSearch(url: string): Promise<SiteSearch> {
  if (!loading) {
    loading = (async () => {
      if (!url) {
        return new SiteSearch([]);
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`search index ${url}: HTTP ${response.status}`);
      }
      const documents = (await response.json()) as SearchDocument[];
      return new SiteSearch(documents);
    })().catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}
