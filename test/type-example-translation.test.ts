import * as spec from '@jsii/spec';
import { exampleSection } from '../src/docgen/examples.js';
import { Language } from '../src/docgen/languages.js';
import { EMPTY_TABLET, parseTablet } from '../src/docgen/rosetta.js';

/**
 * Type example translation: a non-TypeScript tab on a type page must show the rosetta tablet's
 * translation of the authored example, not a synthetic instantiation stub, and must fall back to that stub only
 * for a language the tablet has no translation for.
 */

const LANGS: Language[] = ['ts', 'python', 'go'];

const AUTHORED = "const layer = new lambda.LayerVersion(this, 'MyLayer', { removalPolicy: RemovalPolicy.RETAIN });";

const PYTHON = 'lambda_.LayerVersion(self, "MyLayer",\n    removal_policy=RemovalPolicy.RETAIN\n)';

const GO = 'lambda.NewLayerVersion(this, jsii.String("MyLayer"), &lambda.LayerVersionProps{\n})';

/** A tablet holding one `type` snippet, with the languages named in `translations`. */
function tabletFor(fqn: string, translations: Record<string, string>): string {
  return JSON.stringify({
    version: '2',
    toolVersion: '5.9.56',
    snippets: {
      t1: {
        location: { api: { api: 'type', fqn } },
        translations: Object.fromEntries(
          Object.entries({ $: AUTHORED, ...translations }).map(([k, source]) => [k, { source, version: '1' }]),
        ),
      },
    },
  });
}

const layerVersion: spec.ClassType = {
  kind: spec.TypeKind.Class,
  assembly: 'fake',
  fqn: 'fake.LayerVersion',
  name: 'LayerVersion',
  docs: { example: AUTHORED },
  initializer: { parameters: [{ name: 'scope', type: { fqn: 'constructs.Construct' } }, { name: 'id', type: { primitive: spec.PrimitiveType.String } }] },
} as spec.ClassType;

const assembly: spec.Assembly = {
  name: 'fake',
  version: '1.0.0',
  types: { 'fake.LayerVersion': layerVersion },
  targets: {
    python: { module: 'fake_py' },
    go: { moduleName: 'github.com/fake/fake' },
    dotnet: { packageId: 'Fake.Pkg', namespace: 'Fake.Ns' },
  },
} as unknown as spec.Assembly;

describe('parseTablet type snippets', () => {
  test('indexes a type snippet by fqn', () => {
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { python: PYTHON }));
    expect(tablet.translationsForType('fake.LayerVersion')?.python).toBe(PYTHON);
    expect(tablet.translationsForType('fake.Other')).toBeUndefined();
  });

  test('an empty tablet misses every type', () => {
    expect(EMPTY_TABLET.translationsForType('fake.LayerVersion')).toBeUndefined();
  });

  test('a type snippet is not reachable as a README example', () => {
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { python: PYTHON }));
    expect(tablet.translationsFor('fake', AUTHORED)).toBeUndefined();
  });
});

describe('exampleSection with a tablet', () => {
  test('renders the tablet translation on a non-TypeScript tab', () => {
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { python: PYTHON, go: GO }));
    const out = exampleSection(layerVersion, assembly, LANGS, { construct: true, tablet }).join('\n');
    expect(out).toContain(PYTHON);
    expect(out).toContain(GO);
    // The stub's shape, which the translation replaces.
    expect(out).not.toContain('layer_version = LayerVersion(self, "MyLayerVersion")');
  });

  test('keeps the authored example on the TypeScript tab', () => {
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { python: PYTHON }));
    const out = exampleSection(layerVersion, assembly, LANGS, { construct: true, tablet }).join('\n');
    expect(out).toContain(AUTHORED);
  });

  test('falls back to the generated stub only for a language the tablet lacks', () => {
    // Python translated, Go absent: Go alone keeps the stub.
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { python: PYTHON }));
    const out = exampleSection(layerVersion, assembly, LANGS, { construct: true, tablet }).join('\n');
    expect(out).toContain(PYTHON);
    expect(out).not.toContain(GO);
    expect(out).toContain('NewLayerVersion');
  });

  test('a type with no tablet entry keeps the generated stub in every language', () => {
    const tablet = parseTablet(tabletFor('fake.Unrelated', { python: PYTHON }));
    const out = exampleSection(layerVersion, assembly, LANGS, { construct: true, tablet }).join('\n');
    expect(out).not.toContain(PYTHON);
    expect(out).toContain('LayerVersion(self, "MyLayerVersion")');
  });

  test('no tablet renders the generated stub in every language', () => {
    const out = exampleSection(layerVersion, assembly, LANGS, { construct: true }).join('\n');
    expect(out).toContain('LayerVersion(self, "MyLayerVersion")');
  });

  test('a translated C# tab keeps its NuGet install line', () => {
    const csharp = 'using Fake.Ns;\n\nvar layer = new LayerVersion(this, "MyLayer");';
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { csharp }));
    const out = exampleSection(layerVersion, assembly, ['ts', 'dotnet'], { construct: true, tablet }).join('\n');
    expect(out).toContain('// Install: dotnet add package Fake.Pkg');
    expect(out).toContain('var layer = new LayerVersion(this, "MyLayer");');
  });

  test('a translated Go tab keeps its go get line', () => {
    const tablet = parseTablet(tabletFor('fake.LayerVersion', { go: GO }));
    const out = exampleSection(layerVersion, assembly, ['ts', 'go'], { construct: true, tablet }).join('\n');
    expect(out).toContain('// Install: go get github.com/fake/fake');
    expect(out).toContain(GO);
  });
});
