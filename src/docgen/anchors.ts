import * as spec from '@jsii/spec';
import type { TypeIndex } from './constructs.js';

/**
 * Every anchor a generated page carries is set explicitly from the API, never derived from heading text, so a
 * heading can be reworded without moving a deep link. Member and props anchors live beside their renderers
 * (`memberAnchor`, `propsAnchor`); this module owns the page-title and section anchors.
 */

/** Section anchors of generated pages. The values are part of the public URL contract. */
export const SECTION_ANCHORS = {
  example: 'example',
  initializer: 'initializer',
  properties: 'properties',
  methods: 'methods',
  members: 'members',
  referencedBy: 'referenced-by',
  usedAsPropsBy: 'used-as-props-by',
  // Module overview sections sit below README prose, whose own headings (a README `## Types`) take the plain slugs.
  submodules: 'module-submodules',
  types: 'module-types',
} as const;

/** A markdown heading with an explicit anchor (markdown-it-attrs `{#id}` syntax). */
export function anchoredHeading(level: number, text: string, id: string): string {
  return `${'#'.repeat(level)} ${text} {#${id}}`;
}

const CONSTRUCT_BASE_FQN = 'constructs.Construct';
const MIXIN_SUFFIX = 'mixin';
const CONSTRUCT_SUFFIX = 'construct';

/**
 * Title anchor of a type page, in the shape the previous reference used so existing deep links resolve:
 * `class-<name>`, `class-<name>-construct`, `class-<name>-mixin`, `interface-<name>` or `enum-<name>`, where
 * `<name>` is the lowercased type name without its enclosing type.
 */
export function titleAnchor(type: spec.Type, index: TypeIndex, mixinClass: boolean): string {
  const name = type.name.toLowerCase();
  if (spec.isEnumType(type)) {
    return `enum-${name}`;
  }
  if (spec.isInterfaceType(type)) {
    return `interface-${name}`;
  }
  const cls = type as spec.ClassType;
  if (isInstantiableConstruct(cls, index)) {
    return `class-${name}-${CONSTRUCT_SUFFIX}`;
  }
  return mixinClass ? `class-${name}-${MIXIN_SUFFIX}` : `class-${name}`;
}

/**
 * A class the previous reference labeled "(construct)": a concrete subclass of `constructs.Construct` whose public
 * initializer takes a `scope` first. Abstract bases, `Construct` itself and `App` (no scope) were plain classes.
 */
function isInstantiableConstruct(type: spec.ClassType, index: TypeIndex): boolean {
  if (type.abstract || type.fqn === CONSTRUCT_BASE_FQN) {
    return false;
  }
  const init = type.initializer;
  if (!init || init.protected || init.parameters?.[0]?.name !== 'scope') {
    return false;
  }
  let current = type.base;
  while (current) {
    if (current === CONSTRUCT_BASE_FQN) {
      return true;
    }
    const entry = index.get(current);
    current = entry && spec.isClassType(entry.type) ? entry.type.base : undefined;
  }
  return false;
}

/** Anchor of an enum member row: the member name lowercased, as the previous reference used. */
export function enumMemberAnchor(name: string): string {
  return name.toLowerCase();
}

const TRAILING_ATTRS = / \{#[^}\n]*\}$/;

/** Pin the anchor of a page's first H1 line. */
export function pinTitleAnchor(markdown: string, id: string): string {
  const lines = markdown.split('\n');
  const h1 = lines.findIndex((line) => line.startsWith('# '));
  if (h1 === -1) {
    return markdown;
  }
  lines[h1] = `${lines[h1].replace(TRAILING_ATTRS, '')} {#${id}}`;
  return lines.join('\n');
}

/** Insert inline content at the end of a heading line, before its `{#id}` anchor when it has one. */
export function appendToHeading(line: string, content: string): string {
  const attrs = TRAILING_ATTRS.exec(line);
  return attrs ? `${line.slice(0, attrs.index)} ${content}${attrs[0]}` : `${line} ${content}`;
}
