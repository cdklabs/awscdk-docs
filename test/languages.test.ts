import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import { generateDocs, loadAssembly, loadConfig } from '../src/docgen/index.js';
import {
  camelToPascal,
  camelToSnake,
  DEFAULT_LANGUAGE,
  dotnetCoordinates,
  goCoordinates,
  Language,
  LANGUAGES,
  mavenCoordinates,
  translateImport,
  translateInitializer,
  translateMethodName,
  translateMethodSignature,
  translateModuleName,
  translatePropertyName,
  translateTypeRef,
  translateTypeRefParts,
} from '../src/docgen/languages.js';
import { translatedTypeRefHtml } from '../src/docgen/signatures.js';

const ROOT = resolve(import.meta.dirname, '..');

describe('language utilities', () => {
  test('LanguageToggle is mounted in the nav bar layout slot', () => {
    // A control dropped from the Layout slots fails silently: with only one
    // language generated nothing renders and no unit assertion notices, so
    // only a browser run would catch it. This guards the mount directly.
    const theme = readFileSync(
      resolve(import.meta.dirname, '..', 'docs', '.vitepress', 'theme', 'index.ts'),
      'utf-8',
    );
    // The toggle shares the nav-bar-content-after slot with the theme picker,
    // so assert it is mounted in that slot's array rather than pinning the
    // exact single-child form.
    expect(theme).toMatch(
      /"nav-bar-content-after":\s*\(\)\s*=>\s*\[[^\]]*h\(LanguageToggle\)[^\]]*\]/,
    );
  });

  test('the retired path-based LanguageSwitcher is gone', () => {
    const themeDir = resolve(import.meta.dirname, '..', 'docs', '.vitepress', 'theme');
    expect(existsSync(join(themeDir, 'LanguageSwitcher.vue'))).toBe(false);
    const theme = readFileSync(join(themeDir, 'index.ts'), 'utf-8');
    expect(theme).not.toContain('LanguageSwitcher');
  });

  test('camelToSnake converts camelCase to snake_case', () => {
    expect(camelToSnake('fromBucketArn')).toBe('from_bucket_arn');
    expect(camelToSnake('addLifecycleRule')).toBe('add_lifecycle_rule');
    expect(camelToSnake('URLParser')).toBe('url_parser');
    expect(camelToSnake('name')).toBe('name');
  });

  test('camelToPascal capitalizes the first letter', () => {
    expect(camelToPascal('fromBucketArn')).toBe('FromBucketArn');
    expect(camelToPascal('name')).toBe('Name');
    expect(camelToPascal('Bucket')).toBe('Bucket');
  });

  test('LANGUAGES has all five jsii targets', () => {
    expect(LANGUAGES).toHaveLength(5);
    const ids = LANGUAGES.map(l => l.id);
    expect(ids).toEqual(['ts', 'python', 'java', 'dotnet', 'go']);
  });

  test('DEFAULT_LANGUAGE is TypeScript', () => {
    expect(DEFAULT_LANGUAGE).toBe('ts');
  });
});

describe('method name translation', () => {
  test.each<[Language, string]>([
    ['ts', 'fromBucketArn'],
    ['java', 'fromBucketArn'],
    ['python', 'from_bucket_arn'],
    ['dotnet', 'FromBucketArn'],
    ['go', 'FromBucketArn'],
  ])('%s: fromBucketArn -> %s', (lang, expected) => {
    expect(translateMethodName('fromBucketArn', lang)).toBe(expected);
  });
});

describe('property name translation', () => {
  test.each<[Language, string]>([
    ['ts', 'bucketName'],
    ['java', 'bucketName'],
    ['python', 'bucket_name'],
    ['dotnet', 'BucketName'],
    ['go', 'BucketName'],
  ])('%s: bucketName -> %s', (lang, expected) => {
    expect(translatePropertyName('bucketName', lang)).toBe(expected);
  });
});

describe('type reference translation', () => {
  test('primitive types map correctly per language', () => {
    const ref: spec.TypeReference = { primitive: spec.PrimitiveType.String };
    expect(translateTypeRef(ref, 'ts')).toBe('string');
    expect(translateTypeRef(ref, 'python')).toBe('str');
    expect(translateTypeRef(ref, 'java')).toBe('String');
    expect(translateTypeRef(ref, 'dotnet')).toBe('string');
    expect(translateTypeRef(ref, 'go')).toBe('*string');
  });

  test('boolean type maps correctly', () => {
    const ref: spec.TypeReference = { primitive: spec.PrimitiveType.Boolean };
    expect(translateTypeRef(ref, 'ts')).toBe('boolean');
    expect(translateTypeRef(ref, 'python')).toBe('bool');
    expect(translateTypeRef(ref, 'java')).toBe('Boolean');
    expect(translateTypeRef(ref, 'go')).toBe('*bool');
  });

  test('named type references extract the short name', () => {
    const ref: spec.TypeReference = { fqn: 'aws-cdk-lib.aws_s3.Bucket' };
    expect(translateTypeRef(ref, 'ts')).toBe('Bucket');
    expect(translateTypeRef(ref, 'python')).toBe('Bucket');
    expect(translateTypeRef(ref, 'java')).toBe('Bucket');
  });

  test('array collections map per language', () => {
    const ref: spec.TypeReference = {
      collection: {
        kind: spec.CollectionKind.Array,
        elementtype: { primitive: spec.PrimitiveType.String },
      },
    };
    expect(translateTypeRef(ref, 'ts')).toBe('string[]');
    expect(translateTypeRef(ref, 'python')).toBe('typing.List[str]');
    expect(translateTypeRef(ref, 'java')).toBe('List<String>');
    expect(translateTypeRef(ref, 'dotnet')).toBe('string[]');
    expect(translateTypeRef(ref, 'go')).toBe('*[]*string');
  });

  test('map collections map per language', () => {
    const ref: spec.TypeReference = {
      collection: {
        kind: spec.CollectionKind.Map,
        elementtype: { primitive: spec.PrimitiveType.Number },
      },
    };
    expect(translateTypeRef(ref, 'ts')).toBe('{ [key: string]: number }');
    expect(translateTypeRef(ref, 'python')).toBe('typing.Mapping[str, int | float]');
    expect(translateTypeRef(ref, 'java')).toBe('Map<String, Number>');
  });
});

describe('type links on non-TypeScript variants', () => {
  // Every language variant links its types. Linking only the TypeScript one
  // would leave four of the five supported languages rendering plain text,
  // without the main way readers navigate the reference.
  const linkFor = (fqn: string) =>
    fqn === 'aws-cdk-lib.aws_s3.Bucket' ? 'v2/docs/aws-cdk-lib.aws_s3.Bucket' : undefined;

  test('a named type links on every language, not just TypeScript', () => {
    const ref: spec.TypeReference = { fqn: 'aws-cdk-lib.aws_s3.Bucket' };
    for (const lang of ['python', 'java', 'dotnet', 'go'] as Language[]) {
      const html = translatedTypeRefHtml(ref, lang, linkFor);
      expect(html).toContain('<a class="sig-type"');
      expect(html).toContain('aws-cdk-lib.aws_s3.Bucket.html');
      expect(html).toContain('>Bucket</a>');
    }
  });

  test('a primitive stays plain text', () => {
    const ref: spec.TypeReference = { primitive: spec.PrimitiveType.String };
    expect(translatedTypeRefHtml(ref, 'python', linkFor)).toBe('str');
    expect(translatedTypeRefHtml(ref, 'go', linkFor)).toBe('*string');
  });

  test('a named type with no generated page stays plain text, not a dead link', () => {
    // A dead link is worse than no link: it looks navigable and is not.
    const ref: spec.TypeReference = { fqn: 'aws-cdk-lib.aws_s3.NotGenerated' };
    expect(translatedTypeRefHtml(ref, 'python', linkFor)).toBe('NotGenerated');
  });

  test('the link resolves from the jsii reference, not the displayed name', () => {
    // The Python spelling of an array shares no text with the TypeScript one,
    // so anything matching on the rendered name would fail here. The element
    // links while the language's own syntax is preserved around it.
    const ref: spec.TypeReference = {
      collection: {
        kind: spec.CollectionKind.Array,
        elementtype: { fqn: 'aws-cdk-lib.aws_s3.Bucket' },
      },
    };
    const html = translatedTypeRefHtml(ref, 'python', linkFor);
    expect(html).toBe(
      'typing.List[<a class="sig-type" href="/v2/docs/aws-cdk-lib.aws_s3.Bucket.html">Bucket</a>]',
    );
  });

  test('generic syntax is escaped, so Java and .NET cannot inject markup', () => {
    // Load-bearing rather than defensive: these languages emit angle brackets
    // in their generic syntax, and the plain-text path relied on its CALLER
    // escaping. Emitting HTML without escaping would put raw `<` in the page.
    const ref: spec.TypeReference = {
      collection: {
        kind: spec.CollectionKind.Array,
        elementtype: { fqn: 'aws-cdk-lib.aws_s3.Bucket' },
      },
    };
    const java = translatedTypeRefHtml(ref, 'java', linkFor);
    expect(java).toContain('List&lt;');
    expect(java).toContain('&gt;');
    expect(java).not.toMatch(/List</);

    const map: spec.TypeReference = {
      collection: {
        kind: spec.CollectionKind.Map,
        elementtype: { primitive: spec.PrimitiveType.String },
      },
    };
    expect(translatedTypeRefHtml(map, 'dotnet', linkFor)).toBe('IDictionary&lt;string, string&gt;');
  });

  test('the parts walker is the only source of language syntax', () => {
    // The plain translation is derived from the same fragments, so the two can
    // never disagree about `typing.List[...]` vs `List<...>`. If this drifts,
    // a second copy of the syntax rules has been introduced.
    const ref: spec.TypeReference = {
      collection: {
        kind: spec.CollectionKind.Map,
        elementtype: { fqn: 'aws-cdk-lib.aws_s3.Bucket' },
      },
    };
    for (const { id: lang } of LANGUAGES) {
      const joined = translateTypeRefParts(ref, lang).map((p) => p.text).join('');
      expect(joined).toBe(translateTypeRef(ref, lang));
    }
  });
});

describe('module name translation', () => {
  let assembly: spec.Assembly;

  beforeAll(() => {
    // loadAssembly memoizes the parse, so both suites share one ~1s parse
    assembly = loadAssembly(join(ROOT, 'node_modules', 'aws-cdk-lib'));
  });

  test('TypeScript uses slash-separated module paths', () => {
    expect(translateModuleName('aws-cdk-lib.aws_s3.Bucket', assembly, 'ts'))
      .toBe('aws-cdk-lib/aws_s3');
  });

  test('Python uses dot-separated module paths', () => {
    const result = translateModuleName('aws-cdk-lib.aws_s3.Bucket', assembly, 'python');
    expect(result).toMatch(/aws_cdk.*aws_s3/);
  });

  test('Java uses package notation', () => {
    const result = translateModuleName('aws-cdk-lib.aws_s3.Bucket', assembly, 'java');
    expect(result).toMatch(/software\.amazon\.awscdk/);
  });

  test('.NET uses namespace notation', () => {
    const result = translateModuleName('aws-cdk-lib.aws_s3.Bucket', assembly, 'dotnet');
    expect(result).toMatch(/Amazon\.CDK/);
  });

  test('Go uses module/package notation', () => {
    const result = translateModuleName('aws-cdk-lib.aws_s3.Bucket', assembly, 'go');
    expect(result).toMatch(/aws-cdk-go/);
  });
});

describe('import statement translation', () => {
  let assembly: spec.Assembly;

  beforeAll(() => {
    // loadAssembly memoizes the parse, so both suites share one ~1s parse
    assembly = loadAssembly(join(ROOT, 'node_modules', 'aws-cdk-lib'));
  });

  test('TypeScript imports use curly braces', () => {
    const result = translateImport('aws-cdk-lib.aws_s3.Bucket', assembly, 'ts');
    expect(result).toContain("import { Bucket } from 'aws-cdk-lib/aws_s3'");
  });

  test('Python imports use from ... import', () => {
    const result = translateImport('aws-cdk-lib.aws_s3.Bucket', assembly, 'python');
    expect(result).toMatch(/from .+ import Bucket/);
  });

  test('Java imports use package.ClassName', () => {
    const result = translateImport('aws-cdk-lib.aws_s3.Bucket', assembly, 'java');
    expect(result).toMatch(/import .+\.Bucket;/);
  });

  test('.NET imports use using namespace', () => {
    const result = translateImport('aws-cdk-lib.aws_s3.Bucket', assembly, 'dotnet');
    expect(result).toMatch(/using .+;/);
  });

  test('Go imports use package path', () => {
    const result = translateImport('aws-cdk-lib.aws_s3.Bucket', assembly, 'go');
    expect(result).toContain('import "');
  });
});

describe('Maven coordinate derivation', () => {
  test('coordinates come from assembly targets.java.maven, not name munging', () => {
    // The real aws-cdk-lib assembly: groupId/artifactId as published.
    const assembly = loadAssembly(join(ROOT, 'node_modules', 'aws-cdk-lib'));
    const coords = mavenCoordinates(assembly);
    expect(coords).toEqual({ groupId: 'software.amazon.awscdk', artifactId: 'aws-cdk-lib' });
  });

  test('fixture assembly: exact passthrough of declared coordinates', () => {
    const fixture = {
      name: 'my-lib',
      targets: {
        java: {
          package: 'com.example.mylib',
          maven: { groupId: 'com.example', artifactId: 'my-lib-java' },
        },
      },
    } as unknown as spec.Assembly;
    expect(mavenCoordinates(fixture)).toEqual({ groupId: 'com.example', artifactId: 'my-lib-java' });
  });

  test('assembly without a Java target yields undefined', () => {
    const noJava = { name: 'ts-only', targets: {} } as unknown as spec.Assembly;
    expect(mavenCoordinates(noJava)).toBeUndefined();
    expect(mavenCoordinates({ name: 'bare' } as unknown as spec.Assembly)).toBeUndefined();
  });
});

describe('Go coordinate derivation', () => {
  test('coordinates come from assembly targets.go, not name munging', () => {
    // The real aws-cdk-lib assembly: module path as published.
    const assembly = loadAssembly(join(ROOT, 'node_modules', 'aws-cdk-lib'));
    const coords = goCoordinates(assembly);
    expect(coords?.moduleName).toBe('github.com/aws/aws-cdk-go/awscdk/v2');
    expect(coords?.importPath).toMatch(/^github\.com\/aws\/aws-cdk-go\/awscdk\/v2/);
  });

  test('import path honors submodule resolution for a type FQN', () => {
    const assembly = loadAssembly(join(ROOT, 'node_modules', 'aws-cdk-lib'));
    const coords = goCoordinates(assembly, 'aws-cdk-lib.aws_sqs.Queue');
    expect(coords?.moduleName).toBe('github.com/aws/aws-cdk-go/awscdk/v2');
    expect(coords?.importPath).toBe('github.com/aws/aws-cdk-go/awscdk/v2/awssqs');
  });

  test('fixture assembly: versioned module path from moduleName + packageName + major', () => {
    // jsii-pacmak publishes <moduleName>/<packageName>/v<major> for
    // majors >= 2 (Go semantic import versioning).
    const fixture = {
      name: 'my-lib',
      version: '3.1.0',
      targets: {
        go: { moduleName: 'github.com/example/my-lib-go', packageName: 'mylib' },
      },
    } as unknown as spec.Assembly;
    expect(goCoordinates(fixture)).toEqual({
      moduleName: 'github.com/example/my-lib-go/mylib/v3',
      importPath: 'github.com/example/my-lib-go/mylib/v3',
    });
  });

  test('major < 2 gets no version suffix; packageName defaults to the assembly name', () => {
    // The real constructs assembly declares no packageName — pacmak
    // defaults it to the (sanitized) assembly name.
    const constructs = loadAssembly(join(ROOT, 'node_modules', 'constructs'));
    const coords = goCoordinates(constructs);
    expect(coords?.moduleName).toMatch(/^github\.com\/aws\/constructs-go\/constructs\/v\d+$/);
    const v1 = {
      name: 'my-lib',
      version: '1.4.0',
      targets: { go: { moduleName: 'github.com/example/my-lib-go', packageName: 'mylib' } },
    } as unknown as spec.Assembly;
    expect(goCoordinates(v1)?.moduleName).toBe('github.com/example/my-lib-go/mylib');
  });

  test('assembly without a Go target yields undefined', () => {
    const noGo = { name: 'ts-only', targets: {} } as unknown as spec.Assembly;
    expect(goCoordinates(noGo)).toBeUndefined();
    expect(goCoordinates({ name: 'bare' } as unknown as spec.Assembly)).toBeUndefined();
  });

  test('submodule targets.go with packageName only nests under the versioned parent path', () => {
    // 304 of 642 aws-cdk-lib submodules declare
    // an explicit submodules[].targets.go with ONLY a packageName (no
    // moduleName) — e.g. aws_ecr.mixins -> { packageName: 'awsecrmixins' }.
    // The package must nest under the parent's versioned module path, never
    // under a bare `undefined/` root and never outside the /v2 suffix.
    const fixture = {
      name: 'aws-cdk-lib',
      version: '2.100.0',
      targets: { go: { moduleName: 'github.com/aws/aws-cdk-go', packageName: 'awscdk' } },
      submodules: {
        'aws-cdk-lib.aws_ecr.mixins': { targets: { go: { packageName: 'awsecrmixins' } } },
      },
    } as unknown as spec.Assembly;
    expect(
      translateModuleName('aws-cdk-lib.aws_ecr.mixins.RepositoryAutoDeleteImages', fixture, 'go'),
    ).toBe('github.com/aws/aws-cdk-go/awscdk/v2/awsecrmixins');
    // And the generated import statement must not contain `undefined`.
    const imp = translateImport(
      'aws-cdk-lib.aws_ecr.mixins.RepositoryAutoDeleteImages',
      fixture,
      'go',
    );
    expect(imp).toContain('github.com/aws/aws-cdk-go/awscdk/v2/awsecrmixins');
    expect(imp).not.toContain('undefined');
  });

  test('submodule targets.go with an explicit moduleName overrides the parent root', () => {
    const fixture = {
      name: 'my-lib',
      version: '2.0.0',
      targets: { go: { moduleName: 'github.com/example/my-lib-go', packageName: 'mylib' } },
      submodules: {
        'my-lib.sub': {
          targets: { go: { moduleName: 'github.com/example/other-go', packageName: 'othersub' } },
        },
      },
    } as unknown as spec.Assembly;
    expect(translateModuleName('my-lib.sub.Thing', fixture, 'go'))
      .toBe('github.com/example/other-go/othersub');
  });
});

describe('method signature translation', () => {
  const method: spec.Method = {
    name: 'addLifecycleRule',
    parameters: [
      { name: 'rule', type: { fqn: 'aws-cdk-lib.aws_s3.LifecycleRule' } },
    ],
  };

  test('TypeScript signature', () => {
    const sig = translateMethodSignature(method, 'ts');
    expect(sig).toBe('addLifecycleRule(rule: LifecycleRule): void');
  });

  test('Python signature', () => {
    const sig = translateMethodSignature(method, 'python');
    expect(sig).toContain('def add_lifecycle_rule(self, rule: LifecycleRule)');
  });

  test('Java signature', () => {
    const sig = translateMethodSignature(method, 'java');
    expect(sig).toBe('public void addLifecycleRule(LifecycleRule rule)');
  });

  test('.NET signature', () => {
    // PascalCase method, camelCase parameter — .NET conventions (and
    // jsii's C# bindings) PascalCase members but not parameters.
    const sig = translateMethodSignature(method, 'dotnet');
    expect(sig).toBe('public void AddLifecycleRule(LifecycleRule rule)');
  });

  test('Go signature', () => {
    const sig = translateMethodSignature(method, 'go');
    expect(sig).toBe('func AddLifecycleRule(Rule LifecycleRule)');
  });
});

describe('initializer translation', () => {
  const params: spec.Parameter[] = [
    { name: 'scope', type: { fqn: 'constructs.Construct' } },
    { name: 'id', type: { primitive: spec.PrimitiveType.String } },
    { name: 'props', type: { fqn: 'aws-cdk-lib.aws_s3.BucketProps' }, optional: true },
  ];

  test('TypeScript constructor', () => {
    expect(translateInitializer('Bucket', params, 'ts'))
      .toBe('new Bucket(scope: Construct, id: string, props?: BucketProps)');
  });

  test('Python constructor', () => {
    const result = translateInitializer('Bucket', params, 'python');
    expect(result).toContain('Bucket(');
    expect(result).toContain('scope: Construct');
    expect(result).toContain('id: str');
    expect(result).toContain('props: typing.Optional[BucketProps] = None');
  });

  test('Java constructor', () => {
    const result = translateInitializer('Bucket', params, 'java');
    expect(result).toBe('new Bucket(Construct scope, String id, BucketProps props)');
  });

  test('Go constructor uses New prefix', () => {
    const result = translateInitializer('Bucket', params, 'go');
    expect(result).toContain('NewBucket(');
  });
});

describe('NuGet coordinate derivation', () => {
  // Fixture assembly mirroring aws-cdk-lib's targets.dotnet shape.
  const fixture = {
    name: 'aws-cdk-lib',
    targets: {
      dotnet: { namespace: 'Amazon.CDK', packageId: 'Amazon.CDK.Lib' },
    },
    submodules: {
      'aws-cdk-lib.aws_sqs': {
        targets: {
          dotnet: { namespace: 'Amazon.CDK.AWS.SQS' },
        },
      },
    },
  } as unknown as spec.Assembly;

  test('package id comes from the assembly-level targets.dotnet.packageId', () => {
    const coords = dotnetCoordinates(fixture);
    expect(coords).toEqual({ packageId: 'Amazon.CDK.Lib', namespace: 'Amazon.CDK' });
  });

  test('namespace honors the submodule targets.dotnet override for a type fqn', () => {
    const coords = dotnetCoordinates(fixture, 'aws-cdk-lib.aws_sqs.Queue');
    expect(coords).toEqual({
      // NuGet packages are per-assembly: the submodule keeps the
      // assembly's package id while its namespace comes from the
      // submodule's own targets.dotnet.
      packageId: 'Amazon.CDK.Lib',
      namespace: 'Amazon.CDK.AWS.SQS',
    });
  });

  test('undefined when the assembly declares no dotnet target', () => {
    const bare = { name: 'no-dotnet', targets: { python: { module: 'x', distName: 'x' } } } as unknown as spec.Assembly;
    expect(dotnetCoordinates(bare)).toBeUndefined();
    expect(dotnetCoordinates({ name: 'no-targets' } as unknown as spec.Assembly)).toBeUndefined();
  });

  test('real aws-cdk-lib assembly resolves NuGet coordinates from metadata', () => {
    const assembly = loadAssembly(join(ROOT, 'node_modules', 'aws-cdk-lib'));
    const coords = dotnetCoordinates(assembly, 'aws-cdk-lib.aws_s3.Bucket')!;
    expect(coords.packageId).toBe(assembly.targets!.dotnet!.packageId);
    expect(coords.namespace).toMatch(/Amazon\.CDK/);
  });
});

describe('multi-language page generation (single canonical tree)', () => {
  let outDir: string;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'multilang-'));
    const config = loadConfig(join(ROOT, 'docgen.config.json'));
    generateDocs(config, { outDir, packageRoot: ROOT, languages: ['ts', 'python'] });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('generates ONLY the canonical tree — no per-language duplicates', () => {
    expect(existsSync(join(outDir, 'docs', 'aws-cdk-lib-readme.md'))).toBe(true);
    for (const lang of ['python', 'java', 'dotnet', 'go']) {
      expect(existsSync(join(outDir, lang))).toBe(false);
    }
  });

  test('emits exactly one sidebar.json, in the canonical tree', () => {
    expect(existsSync(join(outDir, 'sidebar.json'))).toBe(true);
    expect(existsSync(join(outDir, 'python', 'sidebar.json'))).toBe(false);
  });

  test('all links use the canonical /v2/ prefix', () => {
    const sidebar = JSON.parse(readFileSync(join(outDir, 'sidebar.json'), 'utf-8'));
    // Sections sit inside the Framework/Services groupings.
    const sections = sidebar.flatMap((top: any) => top.items);
    const s3 = sections.find((s: any) => s.text === 'S3');
    const bucket = s3.items.find((i: any) => i.text === 'Bucket');
    // Construct leaves sit flat inside their resource.
    const bucketLink = bucket.items.find((i: any) => i.text === 'Bucket' && i.link);
    expect(bucketLink.link).toContain('/v2/docs/');
  });

  test('the canonical page embeds every enabled language, not a path tree', () => {
    const page = readFileSync(join(outDir, 'docs', 'aws-cdk-lib.aws_s3.Bucket.md'), 'utf-8');
    // Canonical (ts) content is present — the initializer fence…
    expect(page).toMatch(/```ts type-links=\S+\nnew Bucket\(/);
    // …and the python variant lives IN the same page under Model B, rather
    // than in a per-language path tree.
    expect(page).toContain('data-lang="python"');
  });

  test('the enabled-language set never changes the tree shape', () => {
    const threeLangDir = mkdtempSync(join(tmpdir(), 'threelang-'));
    try {
      generateDocs({ modules: ['constructs'] }, {
        outDir: threeLangDir, packageRoot: ROOT, languages: ['ts', 'java', 'go'],
      });
      expect(existsSync(join(threeLangDir, 'docs', 'constructs-readme.md'))).toBe(true);
      for (const lang of ['python', 'java', 'dotnet', 'go']) {
        expect(existsSync(join(threeLangDir, lang))).toBe(false);
      }
    } finally {
      rmSync(threeLangDir, { recursive: true, force: true });
    }
  });
});
