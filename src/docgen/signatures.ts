import * as spec from '@jsii/spec';
import { escapeAttr, escapeHtml as esc, removeAll } from './escape.js';
import { Language, translateTypeRefParts } from './languages.js';
import { pageHref } from './links.js';
import { PAGEFIND_IGNORE } from './search.js';

/** Resolves a type FQN to its dedicated-page link, if it has one. */
export type LinkResolver = (fqn: string) => string | undefined;

/** `aws-cdk-lib.aws_s3.CfnBucket.PolicyProperty` -> `CfnBucket.PolicyProperty`. */
export function shortName(fqn: string): string {
  const typeSegments = fqn.split('.').filter((s) => /^[A-Z]/.test(s));
  return typeSegments.length > 0 ? typeSegments.join('.') : fqn;
}

export interface SignatureOptions {
  readonly linkFor: LinkResolver;
  /** FQN of the declaring type; enables fluent (chainable) method detection. */
  readonly ownerFqn?: string;
}

/** An HTML fragment paired with its plain-text form. */
interface Fragment {
  readonly html: string;
  readonly text: string;
}

function span(cls: string, text: string): Fragment {
  return { html: `<span class="${cls}">${esc(text)}</span>`, text };
}

function plain(text: string): Fragment {
  return { html: esc(text), text };
}

function concat(...fragments: Fragment[]): Fragment {
  return {
    html: fragments.map((f) => f.html).join(''),
    text: fragments.map((f) => f.text).join(''),
  };
}

function join(fragments: Fragment[], separator: Fragment): Fragment {
  return fragments.length === 0
    ? plain('')
    : fragments.reduce((acc, f) => concat(acc, separator, f));
}

/** Conventional generic type-parameter names: T, K, V, T1, ... */
function isTypeParamName(name: string): boolean {
  return /^[A-Z][0-9]?$/.test(name);
}

/**
 * Render a type reference as syntax-classified HTML. Named types with a
 * dedicated page become links; generic-style type parameters get their
 * own class so CSS can color them distinctly from concrete types.
 */
function renderTypeRef(ref: spec.TypeReference, linkFor: LinkResolver): Fragment {
  if (spec.isPrimitiveTypeReference(ref)) {
    return span('sig-type', ref.primitive);
  }
  if (spec.isNamedTypeReference(ref)) {
    const name = shortName(ref.fqn);
    if (isTypeParamName(name)) {
      return span('type-param', name);
    }
    const link = linkFor(ref.fqn);
    return link
      ? { html: `<a class="sig-type" href="${escapeAttr(pageHref(link))}">${esc(name)}</a>`, text: name }
      : span('sig-type', name);
  }
  if (spec.isCollectionTypeReference(ref)) {
    const element = renderTypeRef(ref.collection.elementtype, linkFor);
    return ref.collection.kind === spec.CollectionKind.Array
      ? concat(element, span('sig-punct', '[]'))
      : concat(
        span('sig-punct', '{ [key: '),
        span('sig-type', 'string'),
        span('sig-punct', ']: '),
        element,
        span('sig-punct', ' }'),
      );
  }
  if (spec.isUnionTypeReference(ref)) {
    return join(ref.union.types.map((t) => renderTypeRef(t, linkFor)), span('sig-punct', ' | '));
  }
  return span('sig-type', 'any');
}

/** HTML rendering of a type reference with cross-links (for layout components). */
export function typeRefHtml(ref: spec.TypeReference, linkFor: LinkResolver): string {
  return renderTypeRef(ref, linkFor).html;
}

/**
 * Plain-text twin of {@link typeRefHtml}, for a `title` on a clamped type.
 * The link resolver is stubbed out because text carries no
 * links.
 */
export function typeRefText(ref: spec.TypeReference): string {
  return renderTypeRef(ref, () => undefined).text;
}

/**
 * HTML rendering of a type reference in a NON-TypeScript language, with the
 * same cross-links.
 *
 * Before this, only the TypeScript variant linked its types and every other
 * language rendered plain text, so four of five supported languages lost the
 * main way readers move around the reference. The link target comes from the
 * jsii FQN, never from the displayed name: the displayed name is the
 * translated one (`typing.List[str]`, `List<String>`), so matching on it would
 * fail exactly where the languages differ.
 *
 * Syntax fragments are escaped, which is load-bearing rather than defensive —
 * Java and .NET generics emit `<` and `>` and would otherwise inject markup.
 * A named type with no generated page stays plain text, because a dead link is
 * worse than no link.
 */
export function translatedTypeRefHtml(
  ref: spec.TypeReference,
  lang: Language,
  linkFor: LinkResolver,
): string {
  return translateTypeRefParts(ref, lang)
    .map((part) => {
      const text = esc(part.text);
      if (!part.fqn) {
        return text;
      }
      const link = linkFor(part.fqn);
      return link ? `<a class="sig-type" href="${escapeAttr(pageHref(link))}">${text}</a>` : text;
    })
    .join('');
}

interface RenderedParam {
  /** Display name including modifiers: `props?`, `...args`. */
  readonly prefix: string;
  /** Inline rendering of the parameter type. */
  readonly type: Fragment;
  /** `@default` doc value, shown inline for optional parameters. */
  readonly defaultValue?: string;
}

function renderParam(param: spec.Parameter, linkFor: LinkResolver): RenderedParam {
  const prefix = param.variadic
    ? `...${param.name}`
    : `${param.name}${param.optional ? '?' : ''}`;
  const base = renderTypeRef(param.type, linkFor);
  const type = param.variadic ? concat(base, span('sig-punct', '[]')) : base;
  const defaultValue = param.optional ? param.docs?.default?.trim() : undefined;
  return { prefix, type, defaultValue };
}

function defaultFragment(value: string): Fragment {
  return concat(span('sig-punct', ' = '), span('sig-default', value));
}

/** Inline parameter list: `a: T, b?: U = x`. */
function inlineParams(rendered: RenderedParam[]): Fragment {
  const parts = rendered.map((r) => {
    const pieces = [span('sig-param', r.prefix), span('sig-punct', ': '), r.type];
    if (r.defaultValue) {
      pieces.push(defaultFragment(r.defaultValue));
    }
    return concat(...pieces);
  });
  return join(parts, span('sig-punct', ', '));
}

/** True when the method returns its declaring type (fluent/builder API). */
function isFluent(method: spec.Method, ownerFqn?: string): boolean {
  const ret = method.returns?.type;
  return ownerFqn !== undefined
    && ret !== undefined
    && spec.isNamedTypeReference(ret)
    && ret.fqn === ownerFqn;
}

function fluentBadge(): Fragment {
  return {
    html: '  <span class="sig-fluent" title="Returns the declaring type, so calls can be chained">// chainable</span>',
    text: '  // chainable',
  };
}

function returnFragment(method: spec.Method, options: SignatureOptions): Fragment {
  const ret = method.returns?.type;
  const type = ret ? renderTypeRef(ret, options.linkFor) : span('sig-type', 'void');
  const frag = concat(span('sig-punct', ': '), type);
  return isFluent(method, options.ownerFqn) ? concat(frag, fluentBadge()) : frag;
}

/**
 * The same signature as a single inline fragment, for a member row's header
 * line. No `<pre>` wrapper and never the multiline branch: the
 * row header is one wrapping line, so the aligned multi-line form has nothing
 * to align inside and its literal newlines would break the row's flow. Every
 * parameter type and the return type stays its own link, which is the point —
 * each gets its own hover card.
 *
 * The parameter and return portion is excluded from the Pagefind index and the
 * identifier is NOT. Repeated type names are what made a page match `bucket`,
 * and this is now the only element carrying a method's name as
 * indexable text — the `###` heading that used to carry it is gone, and
 * the symbol index lists types rather than members, so excluding the whole
 * signature would make a method name unfindable by any route.
 */
export function inlineMethodSignature(method: spec.Method, options: SignatureOptions): string {
  const params = method.parameters ?? [];
  const rendered = params.map((p) => renderParam(p, options.linkFor));
  const rest = concat(
    span('sig-punct', '('),
    inlineParams(rendered),
    span('sig-punct', ')'),
    returnFragment(method, options),
  );
  return span('sig-name', method.name).html
    + `<span ${PAGEFIND_IGNORE}>${rest.html}</span>`;
}

/**
 * Plain-text form of a signature (for tests and search contexts). Accepts a
 * bare inline fragment or a `<pre class="signature">` block: the generator
 * emits only the former now.
 */
export function signatureText(html: string): string {
  const stripped = removeAll(
    html
      .replace(/^<pre v-pre class="signature[^"]*"[^>]*><code>/, '')
      .replace(/<\/code><\/pre>$/, ''),
    /<[^>]+>/g,
  );
  return stripped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
