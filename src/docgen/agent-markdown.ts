/**
 * Agent-oriented Markdown: a second rendering of every generated API page with the site chrome removed.
 *
 * The canonical pages are VitePress-flavored — frontmatter, a breadcrumb `<nav>`, `<Badge>` components, Pagefind
 * markers, `:::` containers, one `.lang-variant` copy of every signature per enabled language, and member lists
 * and type hierarchies written as inline HTML. This module turns that string into plain Markdown an agent can
 * consume: every enabled language's variant — block copies after a language label (a copy docgen filled with the
 * TypeScript source is named on the TypeScript label, not repeated), inline
 * spellings in parentheses where they differ; headings, prose, fenced code, tables and links once; member lists
 * rewritten as bullet lists; everything that exists for the browser dropped.
 *
 * It is a transform over the finished page rather than a second renderer so there is one source of truth for the
 * documentation content itself. The HTML is walked with a real parser: the member markup nests spans several deep
 * and a regex cannot pair those tags reliably.
 */
import { DomUtils, ElementType, parseDocument } from 'htmlparser2';
import { tokenizeFences } from './fences.js';
import { DEFAULT_LANGUAGE, FENCE_LANG, LANGUAGES } from './languages.js';

// Node types come from the parser's own signatures so no second package has to be pinned for them.
type Node = ReturnType<typeof parseDocument>['children'][number];
type Element = NonNullable<ReturnType<typeof DomUtils.findOne>>;
type Text = Extract<Node, { nodeType: 3 }>;

const isText = (n: Node): n is Text => n.type === ElementType.Text;
const isElement = (n: Node): n is Element => n.type === ElementType.Tag;

/**
 * Restores the placeholders `protectCode` planted, for renderers that must see real text before they emit: a member
 * body indented under its bullet (a fence that is still a placeholder would get only its opening line indented), and
 * variant copies compared for equality. Set per transform; the renderer is synchronous.
 */
let restoreProtected: (s: string) => string = (s) => s;

/** Result of transforming one page. */
export interface AgentMarkdown {
  readonly markdown: string;
}

/** Produce the agent-oriented twin of a generated VitePress page. */
export function toAgentMarkdown(page: string): AgentMarkdown {
  const { text, restore } = protectCode(stripFrontmatter(page));
  restoreProtected = restore;
  // `<Badge … />` is a Vue component, self-closed in the source; without the flag the parser would open it and
  // swallow the rest of the page. Tag names keep their case so an unknown one can be put back verbatim.
  const doc = parseDocument(text, {
    decodeEntities: true,
    recognizeSelfClosing: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
  });
  let out = doc.children.map((n) => render(n)).join('');
  out = restore(out);
  out = unwrapContainers(out);
  // Explicit heading anchors (`## Title {#id}`) are markdown-it-attrs syntax, not Markdown.
  out = out.replace(/^(#{1,6} .*?) \{#[^}\n]*\}$/gm, '$1');
  out = out.replace(/[ \t]+$/gm, '');
  return { markdown: `${collapseBlankLines(out).trim()}\n` };
}

/**
 * Add one string-valued key to a page's frontmatter, opening a block when the page has none. Frontmatter must stay
 * the very first thing in the file or VitePress ignores it, so the key is inserted directly after the opening `---`.
 */
export function withFrontmatterKey(page: string, key: string, value: string): string {
  const line = `${key}: ${JSON.stringify(value)}`;
  return page.startsWith('---\n')
    ? `---\n${line}\n${page.slice(4)}`
    : `---\n${line}\n---\n\n${page}`;
}

function stripFrontmatter(s: string): string {
  return s.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/**
 * Documentation text legitimately contains `<`: generics and placeholders in code (`add<Event>Notification`,
 * `<CloudFront distribution ID>`), CommonMark autolinks (`<https://…>`) and bare placeholders (`<Stack>`) in README
 * prose, which reaches the page verbatim. Fenced and indented code, and every angle-bracketed token that is not a
 * tag this site emits, are swapped for placeholders before the HTML parse and put back afterwards, byte for byte.
 * Fences come from the shared tokenizer every other fence-aware pass uses; a fence's info string keeps only its
 * language tag, dropping the `type-links=…` attribute that drives hover links.
 */
function protectCode(s: string): { text: string; restore: (out: string) => string } {
  const slots: string[] = [];
  const keep = (literal: string): string => {
    slots.push(literal);
    return `\u0000${slots.length - 1}\u0000`;
  };
  const text = tokenizeFences(s)
    .map((span) => {
      if (span.kind === 'code') {
        const [opener, ...rest] = span.text.split('\n');
        const lang = (span.info ?? '').trim().split(/\s+/)[0] ?? '';
        const fence = span.info ? opener.slice(0, opener.length - span.info.length) + lang : opener;
        return keep([fence, ...rest].join('\n'));
      }
      return span.text
        // Indented code blocks: a run of lines indented four columns after a blank line (or the span start). Docgen
        // escapes docstring prose without recognizing this form, so the block is decoded back to what was written.
        .replace(/(^|\n\n)((?:(?: {4}|\t)[^\n]*(?:\n|$))+)/g, (_m, lead: string, block: string) =>
          lead + keep(decodeEntities(block)))
        // Anything in angle brackets that is not a tag docgen or the theme emits is text: autolinks, placeholders,
        // generics inside code spans. Code spans themselves stay in the parse so escaped text in them is decoded.
        .replace(/<(\/?[^\s<>/][^<>]*)>/g, (m, inner: string) => (isKnownTag(inner) ? m : keep(m)));
    })
    .join('\n');
  const restore = (out: string): string => out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => slots[Number(i)]);
  return { text, restore };
}

function collapseBlankLines(s: string): string {
  return s.replace(/\n{3,}/g, '\n\n');
}

/** `::: kind Title` … `:::` containers become blockquotes with the title in bold. */
function unwrapContainers(s: string): string {
  const container = /^::: *(\w+)(?: +(.*))?\n([\s\S]*?)^:::\s*$/gm;
  return s.replace(container, (_m, _kind: string, title: string | undefined, body: string) => {
    const lines = body.trim().split('\n').map((l) => (l ? `> ${l}` : '>'));
    return title ? [`> **${title}**`, '>', ...lines].join('\n') : lines.join('\n');
  });
}

// ---------------------------------------------------------------------------------------------------------------
// DOM → Markdown

const classes = (el: Element): Set<string> => new Set((el.attribs.class ?? '').split(/\s+/).filter(Boolean));

const LANGUAGE_LABEL = new Map<string, string>(LANGUAGES.map((l) => [l.id, l.label]));
const isVariant = (n: Node): n is Element => isElement(n) && classes(n).has('lang-variant');
const languageLabel = (variant: Element): string =>
  LANGUAGE_LABEL.get(variant.attribs['data-lang']) ?? variant.attribs['data-lang'] ?? '';

/**
 * The run of sibling `.lang-variant` elements that starts at `el`: docgen emits one per enabled language, in the
 * site's language order, side by side. Whitespace between them is skipped. A language seen twice starts the next run.
 */
function variantGroup(el: Element): Element[] {
  const siblings = el.parent?.children ?? [el];
  const group: Element[] = [];
  for (let i = siblings.indexOf(el); i < siblings.length; i++) {
    const n = siblings[i];
    if (isVariant(n)) {
      if (group.some((v) => v.attribs['data-lang'] === n.attribs['data-lang'])) break;
      group.push(n);
    } else if (!(isText(n) && n.data.trim() === '')) {
      break;
    }
  }
  return group;
}

/**
 * Whether `el` opens its run of variants: the first variant docgen emits is the canonical one, TypeScript when it is
 * enabled and otherwise the first enabled language.
 */
function startsVariantGroup(el: Element): boolean {
  const siblings = el.parent?.children ?? [el];
  // Walk back to the first variant of the contiguous run, then step through its groups.
  let start = siblings.indexOf(el);
  for (let i = start - 1; i >= 0; i--) {
    const n = siblings[i];
    if (isVariant(n)) start = i;
    else if (!(isText(n) && n.data.trim() === '')) break;
  }
  let head = siblings[start] as Element;
  while (head !== el) {
    const group = variantGroup(head);
    if (group.includes(el)) return false;
    const next = group[group.length - 1];
    head = siblings.slice(siblings.indexOf(next) + 1).find(isVariant)!;
  }
  return true;
}

/**
 * One group of language variants. A block variant (an example) is repeated once per language, each copy after a
 * plain label line naming its language (see `renderBlockGroup`). An inline variant (a name in prose or a parameter
 * list) keeps the canonical text and adds, in parentheses, the other spellings where they differ, with the
 * languages that share a spelling listed together.
 */
function renderVariantGroup(group: Element[]): string {
  if (group.length === 1) return children(group[0]);
  // Each copy is rendered once. Protected code is a placeholder per occurrence, so copies are compared, and fences
  // read, only once restored.
  const copies = new Map(group.map((v) => {
    const raw = children(v).trim();
    return [v, { raw, text: restoreProtected(raw) }] as const;
  }));
  if (group[0].name.toLowerCase() === 'div') {
    return renderBlockGroup(group, copies);
  }
  const first = copies.get(group[0])!;
  const byText = new Map<string, { raw: string; labels: string[] }>();
  for (const v of group.slice(1)) {
    const { raw, text } = copies.get(v)!;
    if (text === first.text) continue;
    const entry = byText.get(text) ?? { raw, labels: [] };
    entry.labels.push(languageLabel(v));
    byText.set(text, entry);
  }
  const others = [...byText.values()].map(({ raw, labels }) => `${labels.join(', ')}: ${raw}`);
  return others.length ? `${first.raw} (${others.join('; ')})` : first.raw;
}

function children(el: Element): string {
  return el.children.map((n) => render(n)).join('');
}

/**
 * A block group (examples), one copy per language in the site's language order. A copy in another language whose
 * first fence is tagged `ts` is the TypeScript source docgen fills in for a snippet that was not translated; the
 * TypeScript copy itself is never one, whatever its fences. That fallback is never labeled as its own language. With
 * TypeScript enabled,
 * the TypeScript copy's label names the languages that fall back on it (`TypeScript (also shown for Python):`) and
 * the fallbacks are not repeated. Without TypeScript, one fallback copy stands in, at the position of the first
 * language that uses it, labeled `TypeScript (shown for Python):`.
 */
function renderBlockGroup(group: Element[], copies: Map<Element, { raw: string; text: string }>): string {
  const fenceLang = (v: Element) => /^ {0,3}(?:`{3,}|~{3,})([^\s`]*)/m.exec(copies.get(v)!.text)?.[1];
  // Only a `ts` fence in another language's copy is the fill; a copy that leads with a shell or JSON fence is its own.
  const isFallback = (v: Element) => v.attribs['data-lang'] !== DEFAULT_LANGUAGE
    && fenceLang(v) === FENCE_LANG[DEFAULT_LANGUAGE];
  const fallbacks = group.filter(isFallback);
  const fallbackSet = new Set(fallbacks);
  const block = (label: string, v: Element) => `\n${label}:\n\n${copies.get(v)!.raw}\n`;
  const names = fallbacks.map(languageLabel).join(', ');
  const tsFirst = group[0].attribs['data-lang'] === DEFAULT_LANGUAGE;
  const typescript = LANGUAGE_LABEL.get(DEFAULT_LANGUAGE) ?? DEFAULT_LANGUAGE;
  const blocks: string[] = [];
  for (const v of group) {
    if (!fallbackSet.has(v)) {
      const label = tsFirst && v === group[0] && fallbacks.length
        ? `${languageLabel(v)} (also shown for ${names})`
        : languageLabel(v);
      blocks.push(block(label, v));
    } else if (!tsFirst && v === fallbacks[0]) {
      blocks.push(block(`${typescript} (shown for ${names})`, v));
    }
  }
  return blocks.join('\n');
}

/** Plain text of a subtree, with links and code rendered as Markdown. */
function inline(el: Element): string {
  return children(el).replace(/\s+/g, ' ').trim();
}

function render(node: Node): string {
  if (isText(node)) {
    return node.data;
  }
  if (!isElement(node)) {
    return '';
  }
  const el = node;
  const cls = classes(el);
  const tag = el.name.toLowerCase();
  if (!KNOWN_TAGS.has(tag)) {
    return literalTag(el);
  }

  // Language variants: the first of each group renders the whole group; the others are rendered with it.
  if (cls.has('lang-variant')) {
    return startsVariantGroup(el) ? renderVariantGroup(variantGroup(el)) : '';
  }
  if (tag === 'languagetabs') {
    return `\n${children(el)}\n`;
  }

  // Chrome with nothing to say in text.
  if (cls.has('type-breadcrumb') || cls.has('member-permalink') || tag === 'badge' || 'hidden' in el.attribs) {
    return '';
  }

  if (cls.has('inheritance-chain')) {
    return renderInheritance(el);
  }
  if (cls.has('type-metadata')) {
    return renderMetadata(el);
  }
  if (cls.has('member-row')) {
    return renderMemberRow(el);
  }
  if (cls.has('member-signature')) {
    return `\`${textOf(el)}\``;
  }

  switch (tag) {
    case 'a': {
      const text = inline(el);
      const href = el.attribs.href;
      return href && !href.startsWith('#') ? `[${text}](${href})` : text;
    }
    case 'code':
      return `\`${textOf(el)}\``;
    case 'br':
      return ' ';
    case 'summary':
      return '';
    case 'li':
      return `- ${inline(el)}\n`;
    case 'dt':
      return `- ${inline(el)}: `;
    case 'dd':
      return `${inline(el)}\n`;
    case 'p':
    case 'ul':
    case 'ol':
    case 'dl':
    case 'div':
    case 'details':
    case 'nav':
    case 'section':
      return `\n${children(el)}\n`;
    default:
      return children(el);
  }
}

/** Text content only — no Markdown link syntax — for code spans. */
function textOf(el: Element): string {
  return DomUtils.textContent(el).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The character references docgen's prose escaping emits, plus numeric ones generally. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      return String.fromCodePoint(ref[1].toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? m;
  });
}

/** True when `<inner>` opens or closes a tag docgen or the theme emits. */
function isKnownTag(inner: string): boolean {
  const name = inner.replace(/^\//, '').split(/[\s/]/)[0].toLowerCase();
  return KNOWN_TAGS.has(name);
}

/** Tags docgen or the theme emit. Anything else was documentation text that happened to look like a tag. */
const KNOWN_TAGS = new Set([
  'a', 'br', 'code', 'dd', 'details', 'div', 'dl', 'dt', 'li', 'nav', 'ol', 'p', 'section', 'span', 'summary', 'ul',
  'languagetabs', 'badge',
]);

/** Put an unrecognized tag back the way the author wrote it (`<REGION>`, `<CloudFront distribution ID>`). */
function literalTag(el: Element): string {
  const attrs = Object.entries(el.attribs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`)).join('');
  return `<${el.name}${attrs}>${children(el)}`;
}

/** Type hierarchy `<nav>`: one line for the chain above the type, one per relation row (implements, …). */
function renderInheritance(el: Element): string {
  const lines: string[] = [];
  for (const child of el.children) {
    if (!isElement(child)) continue;
    const cls = classes(child);
    if (cls.has('chain-line')) {
      const items = DomUtils.findAll((n) => classes(n).has('chain-item'), child.children).map((n) => inline(n));
      lines.push(`Extends: ${items.join(' › ')}`);
    } else if (cls.has('chain-row')) {
      const label = DomUtils.findOne((n) => classes(n).has('chain-label'), child.children);
      const items = DomUtils.findAll((n) => classes(n).has('chain-item'), child.children).map((n) => inline(n));
      lines.push(`${label ? `${capitalize(textOf(label))}: ` : ''}${items.join(', ')}`);
    }
  }
  return `\n${lines.join('  \n')}\n`;
}

/** Type metadata `<dl>`: one bullet per label/value pair. */
function renderMetadata(el: Element): string {
  const lines: string[] = [];
  let label = '';
  for (const child of el.children) {
    if (!isElement(child)) continue;
    if (child.name.toLowerCase() === 'dt') label = inline(child);
    if (child.name.toLowerCase() === 'dd') lines.push(`- ${label}: ${inline(child)}`);
  }
  return `\n${lines.join('\n')}\n`;
}

/**
 * One member (property, prop, method, …): a bullet with the name, type or signature and default, the summary on
 * the same line, and any longer description or disclosure content indented beneath it.
 */
function renderMemberRow(el: Element): string {
  const line = DomUtils.findOne((n) => classes(n).has('member-line'), el.children);
  const summary = DomUtils.findOne((n) => classes(n).has('member-summary'), el.children);
  const rest = el.children.filter((n) => n !== line && n !== summary);

  // The bullet carries the canonical name and type; each other language whose name or type reads differently
  // gets one labeled sub-bullet under it, with that language's name and type only. Flags and the default stay on the
  // head: the default is the jsii `@default` text, written in TypeScript. The canonical spelling is the first
  // variant, as docgen emits it: that is TypeScript when it is enabled, and otherwise the first enabled language, so a
  // build without TypeScript reads the same way.
  const variants = line ? DomUtils.findAll(isVariant, line.children) : [];
  const canonical = variants[0];
  const head = line ? renderMemberLine(line, canonical) : '';
  const headIdentity = canonical ? renderMemberIdentity(canonical) : '';
  // Languages that spell the member the same way share one sub-bullet, as inline spellings do.
  const byIdentity = new Map<string, string[]>();
  for (const v of variants.slice(1)) {
    const text = renderMemberIdentity(v);
    if (!text || text === headIdentity) continue;
    byIdentity.set(text, [...(byIdentity.get(text) ?? []), languageLabel(v)]);
  }
  const spellings = [...byIdentity].map(([text, labels]) => `- ${labels.join(', ')}: ${text}`);
  const summaryText = summary ? inline(summary) : '';
  // Restore fences before indenting so every line of a block — content and closer, not just the opener — sits
  // under the bullet; an opener indented alone would leave the closer starting a fence of its own.
  const body = [spellings.join('\n'), restoreProtected(rest.map((n) => render(n)).join('')).trim()]
    .filter(Boolean)
    .join('\n\n');
  const indented = body ? `\n${body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}\n` : '';
  return `- ${head}${summaryText ? ` — ${summaryText}` : ''}\n${indented}`;
}

/**
 * One language's name and type (or signature) of a member, from that language's variant alone. The type is plain
 * code: the head bullet already links it, and a code span keeps a generic such as `List<String>` from reading as a
 * tag.
 */
function renderMemberIdentity(variant: Element): string {
  const find = (cls: string) => DomUtils.findOne((n) => classes(n).has(cls), variant.children);
  const signature = find('member-signature');
  if (signature) return `\`${textOf(signature)}\``;
  const name = find('member-name');
  const type = find('member-type');
  return name ? `\`${textOf(name)}\`${type ? `: \`${textOf(type)}\`` : ''}` : '';
}

/**
 * The bullet head of a member line: name and type (or signature) from `variant` when the line has per-language
 * variants, flags and default from the line itself.
 */
function renderMemberLine(line: Element, variant?: Element): string {
  const parts: string[] = [];
  const scope = variant ? variant.children : line.children;
  // Flags and defaults sit outside the variants; a lookup must not pick them up from another language's copy.
  const shared = line.children.filter((n) => !isVariant(n));
  const find = (cls: string) =>
    DomUtils.findOne((n) => classes(n).has(cls), scope) ?? DomUtils.findOne((n) => classes(n).has(cls), shared);
  const name = find('member-name');
  const signature = find('member-signature');
  const type = find('member-type');
  const def = find('member-default');
  const flagOf = (n: Element) => classes(n).has('member-required') || classes(n).has('member-static');
  const flags = [...DomUtils.findAll(flagOf, scope), ...(variant ? DomUtils.findAll(flagOf, shared) : [])];
  if (signature) {
    parts.push(`\`${textOf(signature)}\``);
  } else if (name) {
    parts.push(`\`${textOf(name)}\``);
    // A TypeScript head keeps its type links. Another language's type is a code span, so a generic such as
    // `List<String>` does not read as a tag.
    const tsHead = !variant || variant.attribs['data-lang'] === DEFAULT_LANGUAGE;
    if (type) parts.push(tsHead ? `: ${inline(type)}` : `: \`${textOf(type)}\``);
  }
  for (const flag of flags) parts.push(` (${textOf(flag)})`);
  // The visible default is elided for long values; `title` carries the whole thing.
  if (def) parts.push(` ${def.attribs.title ? `= ${def.attribs.title}` : textOf(def)}`);
  return parts.join('');
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
