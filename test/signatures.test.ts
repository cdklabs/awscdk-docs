import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import {
  inlineMethodSignature,
  LinkResolver,
  signatureText,
} from '../src/docgen/signatures.js';

const ROOT = resolve(import.meta.dirname, '..');
const noLinks: LinkResolver = () => undefined;

const str: spec.TypeReference = { primitive: spec.PrimitiveType.String };
const num: spec.TypeReference = { primitive: spec.PrimitiveType.Number };
const named = (fqn: string): spec.TypeReference => ({ fqn });

function method(partial: Partial<spec.Method> & { name: string }): spec.Method {
  return partial as spec.Method;
}

describe('signature formatter', () => {
  test('a signature renders as one inline line', () => {
    const html = inlineMethodSignature(method({
      name: 'grantRead',
      parameters: [
        { name: 'identity', type: named('lib.IGrantable') },
        { name: 'pattern', type: str, optional: true },
      ],
      returns: { type: named('lib.Grant') },
    }), { linkFor: noLinks });
    expect(signatureText(html)).toBe('grantRead(identity: IGrantable, pattern?: string): Grant');
  });

  /*
   * Signatures stay inline however many parameters they carry, and a 3+ member
   * union stays on one line. A member row's header line is one wrapping line,
   * so an aligned multi-line form has nothing to align inside and its literal
   * newlines break the row's flow. There is no multi-line branch, and these
   * two cases are what would notice one arriving.
   */
  test('a long parameter list stays inline instead of breaking per parameter', () => {
    const html = inlineMethodSignature(method({
      name: 'grant',
      parameters: [
        { name: 'principal', type: named('lib.IPrincipal') },
        { name: 'actions', type: str },
        { name: 'resources', type: str, optional: true },
      ],
      returns: { type: named('lib.Grant') },
    }), { linkFor: noLinks });
    expect(signatureText(html))
      .toBe('grant(principal: IPrincipal, actions: string, resources?: string): Grant');
    expect(signatureText(html)).not.toContain('\n');
  });

  test('a wide union stays inline, in the parameter and in the return type', () => {
    const wide: spec.TypeReference = {
      union: { types: [str, num, named('lib.IResolvable')] },
    };
    const html = inlineMethodSignature(method({
      name: 'resolve',
      parameters: [{ name: 'value', type: wide }],
      returns: { type: wide },
    }), { linkFor: noLinks });
    expect(signatureText(html))
      .toBe('resolve(value: string | number | IResolvable): string | number | IResolvable');
    expect(signatureText(html)).not.toContain('\n');
  });

  test('generic type parameters get the type-param class', () => {
    const html = inlineMethodSignature(method({
      name: 'of',
      parameters: [{ name: 'value', type: named('lib.T') }],
      returns: { type: named('lib.T') },
    }), { linkFor: noLinks });
    expect(html).toContain('<span class="type-param">T</span>');
    expect(html).not.toContain('<span class="sig-type">T</span>');
  });

  test('optional params show their @default value inline', () => {
    const html = inlineMethodSignature(method({
      name: 'metric',
      parameters: [{
        name: 'timeout',
        type: named('lib.Duration'),
        optional: true,
        docs: { default: 'Duration.minutes(5)' },
      }],
    }), { linkFor: noLinks });
    expect(signatureText(html)).toBe('metric(timeout?: Duration = Duration.minutes(5)): void');
    expect(html).toContain('<span class="sig-default">Duration.minutes(5)</span>');
  });

  test('defaults are ignored on required params', () => {
    const html = inlineMethodSignature(method({
      name: 'metric',
      parameters: [{ name: 'name', type: str, docs: { default: 'x' } }],
    }), { linkFor: noLinks });
    expect(signatureText(html)).toBe('metric(name: string): void');
  });

  test('methods returning their declaring type are annotated as chainable', () => {
    const html = inlineMethodSignature(method({
      name: 'plus',
      parameters: [{ name: 'rhs', type: named('lib.Duration') }],
      returns: { type: named('lib.Duration') },
    }), { linkFor: noLinks, ownerFqn: 'lib.Duration' });
    expect(html).toContain('<span class="sig-fluent"');
    expect(signatureText(html)).toBe('plus(rhs: Duration): Duration  // chainable');
  });

  test('methods returning an unrelated type are not annotated', () => {
    const html = inlineMethodSignature(method({
      name: 'toSeconds',
      returns: { type: num },
    }), { linkFor: noLinks, ownerFqn: 'lib.Duration' });
    expect(html).not.toContain('sig-fluent');
  });

  test('documented type names become links', () => {
    const linkFor: LinkResolver = (fqn) =>
      (fqn === 'lib.Grant' ? '/api/modules/lib/core/Grant' : undefined);
    const html = inlineMethodSignature(method({
      name: 'grantRead',
      parameters: [{ name: 'identity', type: named('lib.IGrantable') }],
      returns: { type: named('lib.Grant') },
    }), { linkFor });
    expect(html).toContain('<a class="sig-type" href="/api/modules/lib/core/Grant.html">Grant</a>');
    expect(html).toContain('<span class="sig-type">IGrantable</span>');
  });

  test('variadic params and collection types render like TypeScript', () => {
    const html = inlineMethodSignature(method({
      name: 'addOverride',
      parameters: [
        { name: 'path', type: str },
        { name: 'values', type: str, variadic: true },
      ],
      returns: {
        type: {
          collection: { kind: spec.CollectionKind.Map, elementtype: str },
        },
      },
    }), { linkFor: noLinks });
    expect(signatureText(html))
      .toBe('addOverride(path: string, ...values: string[]): { [key: string]: string }');
  });

  test('the inline form carries no block wrapper of its own', () => {
    const html = inlineMethodSignature(method({ name: 'noop' }), { linkFor: noLinks });
    expect(html).not.toContain('<pre');
    // `v-pre` comes from the row container.
    expect(html).not.toContain('v-pre');
  });

  /*
   * The name is indexable and the rest is not. This is the only element
   * carrying a method's name as text once per-member headings are gone, so
   * excluding the whole signature — or the row line around it — takes every
   * method name out of search. The repeated names worth excluding are TYPE
   * names, and those are all inside the parenthesized portion.
   */
  test('the identifier stays outside the index exclusion, the types inside', () => {
    const html = inlineMethodSignature(method({
      name: 'grantRead',
      parameters: [{ name: 'identity', type: named('lib.IGrantable') }],
      returns: { type: named('lib.Grant') },
    }), { linkFor: noLinks });
    const cut = html.indexOf('<span data-pagefind-ignore>');
    expect(cut).toBeGreaterThan(-1);
    const indexable = html.slice(0, cut);
    const excluded = html.slice(cut);
    expect(indexable).toBe('<span class="sig-name">grantRead</span>');
    expect(excluded).toContain('IGrantable');
    expect(excluded).toContain('Grant');
    // Exactly one exclusion, and it runs to the end of the fragment.
    expect(html.match(/data-pagefind-ignore/g)).toHaveLength(1);
    expect(html.endsWith('</span>')).toBe(true);
  });
});

describe('signatures on real assemblies', () => {
  test('Duration.plus is detected as chainable', () => {
    const assembly = spec.loadAssemblyFromPath(
      join(ROOT, 'node_modules', 'aws-cdk-lib'), false, [...spec.ALL_SPEC_FEATURES],
    );
    const duration = assembly.types!['aws-cdk-lib.Duration'] as spec.ClassType;
    const plus = duration.methods!.find((m) => m.name === 'plus')!;
    const html = inlineMethodSignature(plus, {
      linkFor: noLinks,
      ownerFqn: duration.fqn,
    });
    expect(signatureText(html)).toContain('// chainable');
  });
});

describe('signature theme styles', () => {
  const css = readFileSync(
    resolve(ROOT, 'docs/.vitepress/theme/signatures.css'), 'utf-8',
  );

  test('theme entry loads the signature styles', () => {
    const entry = readFileSync(
      resolve(ROOT, 'docs/.vitepress/theme/index.ts'), 'utf-8',
    );
    expect(entry).toContain('./signatures.css');
  });

  test.each(['--sig-c-type', '--sig-c-type-param', '--sig-c-keyword', '--sig-c-muted'])(
    'token color %s is defined for both light and dark mode',
    (variable) => {
      const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
      const darkBlock = css.slice(css.indexOf('.dark {'), css.indexOf('pre.signature'));
      expect(lightBlock).toContain(`${variable}:`);
      expect(darkBlock).toContain(`${variable}:`);
    },
  );

  test.each(['sig-name', 'sig-keyword', 'sig-param', 'sig-type', 'type-param', 'sig-default', 'sig-punct', 'sig-fluent'])(
    'token class %s is styled',
    (cls) => {
      expect(css).toContain(`.${cls}`);
    },
  );
});
