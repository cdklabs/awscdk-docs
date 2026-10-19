/**
 * Agent-oriented Markdown: a second rendering of every generated API page with the site chrome removed.
 *
 * The canonical pages are VitePress-flavored — frontmatter, a breadcrumb `<nav>`, `<Badge>` components,
 * `:::` containers, one `.lang-variant` copy of every signature per enabled language, and member lists
 * and type hierarchies written as inline HTML. This module turns that string into plain Markdown an agent can
 * consume: the canonical (TypeScript) variant only; headings, prose, fenced code, tables and links preserved;
 * member lists rewritten as bullet lists; everything that exists for the browser dropped.
 *
 * It is a transform over the finished page rather than a second renderer so there is one source of truth for the
 * documentation content itself. The HTML is walked with a real parser: the member markup nests spans several deep
 * and a regex cannot pair those tags reliably.
 */
import { DomUtils, ElementType, parseDocument } from 'htmlparser2';
import { tokenizeFences } from './fences.js';
import { DEFAULT_LANGUAGE } from './languages.js';

// Node types come from the parser's own signatures so no second package has to be pinned for them.
type Node = ReturnType<typeof parseDocument>['children'][number];
type Element = NonNullable<ReturnType<typeof DomUtils.findOne>>;
type Text = Extract<Node, { nodeType: 3 }>;

const isText = (n: Node): n is Text => n.type === ElementType.Text;
const isElement = (n: Node): n is Element => n.type === ElementType.Tag;

/**
 * Restores the placeholders `protectCode` planted, for the one renderer that must see real lines before it emits:
 * a member body is indented under its bullet, and a fence that is still a placeholder would get only its opening
 * line indented. Set per transform; the renderer is synchronous.
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

function children(el: Element): string {
  return el.children.map((n) => render(n)).join('');
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

  // Language variants: keep the canonical one's content, drop the rest and the tab wrapper.
  if (cls.has('lang-variant')) {
    return el.attribs['data-lang'] === DEFAULT_LANGUAGE ? children(el) : '';
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
  // Only the canonical variant's name and type take part in the bullet.
  for (const variant of DomUtils.findAll((n) => classes(n).has('lang-variant'), el.children)) {
    if (variant.attribs['data-lang'] !== DEFAULT_LANGUAGE) DomUtils.removeElement(variant);
  }
  const line = DomUtils.findOne((n) => classes(n).has('member-line'), el.children);
  const summary = DomUtils.findOne((n) => classes(n).has('member-summary'), el.children);
  const rest = el.children.filter((n) => n !== line && n !== summary);

  const head = line ? renderMemberLine(line) : '';
  const summaryText = summary ? inline(summary) : '';
  // Restore fences before indenting so every line of a block — content and closer, not just the opener — sits
  // under the bullet; an opener indented alone would leave the closer starting a fence of its own.
  const body = restoreProtected(rest.map((n) => render(n)).join('')).trim();
  const indented = body ? `\n${body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}\n` : '';
  return `- ${head}${summaryText ? ` — ${summaryText}` : ''}\n${indented}`;
}

function renderMemberLine(line: Element): string {
  const parts: string[] = [];
  const name = DomUtils.findOne((n) => classes(n).has('member-name'), line.children);
  const signature = DomUtils.findOne((n) => classes(n).has('member-signature'), line.children);
  const type = DomUtils.findOne((n) => classes(n).has('member-type'), line.children);
  const def = DomUtils.findOne((n) => classes(n).has('member-default'), line.children);
  const flags = DomUtils.findAll(
    (n) => classes(n).has('member-required') || classes(n).has('member-static'),
    line.children,
  );
  if (signature) {
    parts.push(`\`${textOf(signature)}\``);
  } else if (name) {
    parts.push(`\`${textOf(name)}\``);
    if (type) parts.push(`: ${inline(type)}`);
  }
  for (const flag of flags) parts.push(` (${textOf(flag)})`);
  // The visible default is elided for long values; `title` carries the whole thing.
  if (def) parts.push(` ${def.attribs.title ? `= ${def.attribs.title}` : textOf(def)}`);
  return parts.join('');
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
