import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as spec from '@jsii/spec';
import {
  canGenerateExample,
  exampleSection,
  generatedExample,
  hasJavaBuilder,
} from '../src/docgen/examples.js';
import { generateDocs } from '../src/docgen/index.js';

const ROOT = resolve(import.meta.dirname, '..');

// Per-language code examples: the `## Example` section is a
// <LanguageTabs> group with one fenced, Shiki-highlighted block per
// enabled language — authored examples on the TypeScript tab where
// present, generated minimal instantiation snippets otherwise.

/** Minimal synthetic assembly with jsii targets for every language. */
const assembly = {
  name: 'aws-cdk-lib',
  version: '2.0.0',
  targets: {
    python: { module: 'aws_cdk', distName: 'aws-cdk-lib' },
    java: { package: 'software.amazon.awscdk', maven: { groupId: 'software.amazon.awscdk', artifactId: 'aws-cdk-lib' } },
    dotnet: { namespace: 'Amazon.CDK', packageId: 'Amazon.CDK.Lib' },
    go: { moduleName: 'github.com/aws/aws-cdk-go', packageName: 'awscdk' },
  },
  submodules: {
    'aws-cdk-lib.aws_sqs': {
      targets: {
        python: { module: 'aws_cdk.aws_sqs' },
        java: { package: 'software.amazon.awscdk.services.sqs' },
        dotnet: { namespace: 'Amazon.CDK.AWS.SQS' },
        go: { moduleName: 'github.com/aws/aws-cdk-go/awscdk/v2', packageName: 'awssqs' },
      },
    },
  },
  types: {
    'aws-cdk-lib.aws_sqs.QueueProps': {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sqs.QueueProps',
      kind: 'interface',
      name: 'QueueProps',
      datatype: true,
    },
  },
} as unknown as spec.Assembly;

const queue: spec.ClassType = {
  assembly: 'aws-cdk-lib',
  fqn: 'aws-cdk-lib.aws_sqs.Queue',
  kind: spec.TypeKind.Class,
  name: 'Queue',
  namespace: 'aws_sqs',
  initializer: {
    parameters: [
      { name: 'scope', type: { fqn: 'constructs.Construct' } },
      { name: 'id', type: { primitive: spec.PrimitiveType.String } },
      { name: 'props', optional: true, type: { fqn: 'aws-cdk-lib.aws_sqs.QueueProps' } },
    ],
  },
};

describe('generated minimal instantiation snippets', () => {
  test('construct form per language: import + idiomatic scope/id call', () => {
    expect(generatedExample(queue, assembly, 'ts', { construct: true })).toBe([
      "import { Queue } from 'aws-cdk-lib/aws_sqs';",
      '',
      "const queue = new Queue(this, 'MyQueue');",
    ].join('\n'));
    expect(generatedExample(queue, assembly, 'python', { construct: true })).toBe([
      'from aws_cdk.aws_sqs import Queue',
      '',
      'queue = Queue(self, "MyQueue")',
    ].join('\n'));
    // Java: jsii emits a Builder for classes whose last initializer
    // parameter is a struct (QueueProps), so the idiomatic form is
    // Builder.create(scope, id)…build().
    expect(generatedExample(queue, assembly, 'java', { construct: true })).toBe([
      'import software.amazon.awscdk.services.sqs.Queue;',
      '',
      'Queue queue = Queue.Builder.create(this, "MyQueue").build();',
    ].join('\n'));
    expect(generatedExample(queue, assembly, 'dotnet', { construct: true })).toBe([
      // NuGet package id from the assembly-level targets.dotnet, namespace
      // from the submodule override.
      '// Install: dotnet add package Amazon.CDK.Lib',
      'using Amazon.CDK.AWS.SQS;',
      '',
      'var queue = new Queue(this, "MyQueue");',
    ].join('\n'));
    // Go: jsii `New*` functions take every parameter, so the optional
    // props param becomes nil and the string id needs jsii.String. The
    // go get line carries the module path from targets.go.
    expect(generatedExample(queue, assembly, 'go', { construct: true })).toBe([
      '// Install: go get github.com/aws/aws-cdk-go/awscdk/v2',
      'import (',
      '\t"github.com/aws/jsii-runtime-go"',
      '\t"github.com/aws/aws-cdk-go/awscdk/v2/awssqs"',
      ')',
      '',
      'queue := awssqs.NewQueue(this, jsii.String("MyQueue"), nil)',
    ].join('\n'));
  });

  test('non-construct classes reference required params by (translated) name', () => {
    const widget: spec.ClassType = {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.Widget',
      kind: spec.TypeKind.Class,
      name: 'Widget',
      initializer: {
        parameters: [
          { name: 'maxCount', type: { primitive: spec.PrimitiveType.Number } },
          { name: 'label', optional: true, type: { primitive: spec.PrimitiveType.String } },
        ],
      },
    };
    expect(generatedExample(widget, assembly, 'ts'))
      .toContain('const widget = new Widget(maxCount);');
    expect(generatedExample(widget, assembly, 'python'))
      .toContain('widget = Widget(max_count)');
    expect(generatedExample(widget, assembly, 'go'))
      .toContain('.NewWidget(maxCount, nil)');
    // The non-construct Go form also leads with the go get line.
    expect(generatedExample(widget, assembly, 'go'))
      .toContain('// Install: go get github.com/aws/aws-cdk-go/awscdk/v2');
  });

  test('Java builder form only where jsii lifts a trailing struct', () => {
    // Queue's last initializer param is QueueProps, a struct resolvable in
    // the fixture assembly's types map — jsii emits a Builder for it.
    expect(hasJavaBuilder(queue, assembly)).toBe(true);

    // A class without a trailing struct gets no Builder: constructor form.
    const plain: spec.ClassType = {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.Widget',
      kind: spec.TypeKind.Class,
      name: 'Widget',
      initializer: {
        parameters: [
          { name: 'maxCount', type: { primitive: spec.PrimitiveType.Number } },
        ],
      },
    };
    expect(hasJavaBuilder(plain, assembly)).toBe(false);
    expect(generatedExample(plain, assembly, 'java'))
      .toContain('Widget widget = new Widget(maxCount);');

    // A struct from another assembly is not resolvable via assembly.types —
    // conservatively keep the constructor form rather than guess a Builder.
    const foreign: spec.ClassType = {
      ...plain,
      initializer: {
        parameters: [
          { name: 'props', type: { fqn: 'other-lib.WidgetProps' } },
        ],
      },
    };
    expect(hasJavaBuilder(foreign, assembly)).toBe(false);
  });

  test('Java builder create() takes required params preceding the struct', () => {
    // Non-construct class with a trailing struct: create() gets the
    // required leading params by placeholder name.
    const job: spec.ClassType = {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sqs.Job',
      kind: spec.TypeKind.Class,
      name: 'Job',
      initializer: {
        parameters: [
          { name: 'jobName', type: { primitive: spec.PrimitiveType.String } },
          { name: 'props', optional: true, type: { fqn: 'aws-cdk-lib.aws_sqs.QueueProps' } },
        ],
      },
    };
    expect(generatedExample(job, assembly, 'java'))
      .toContain('Job job = Job.Builder.create(jobName).build();');
  });

  test('canGenerateExample: only concrete classes with a public initializer', () => {
    expect(canGenerateExample(queue)).toBe(true);
    expect(canGenerateExample({ ...queue, abstract: true })).toBe(false);
    expect(canGenerateExample({ ...queue, initializer: undefined })).toBe(false);
    expect(canGenerateExample({
      ...queue, initializer: { ...queue.initializer, protected: true },
    })).toBe(false);
    const enumType: spec.EnumType = {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sqs.QueueEncryption',
      kind: spec.TypeKind.Enum,
      name: 'QueueEncryption',
      members: [{ name: 'UNENCRYPTED' }],
    };
    expect(canGenerateExample(enumType)).toBe(false);
  });
});

describe('exampleSection', () => {
  const authored = { ...queue, docs: { example: "new Queue(this, 'Queue', {\n  fifo: true,\n});" } };

  test('single language: no tabs and no generated section', () => {
    // Authored example: the bare ```ts fence, unchanged.
    expect(exampleSection(authored, assembly, ['ts'], { construct: true }))
      .toEqual(['## Example {#example}', '', '```ts', authored.docs!.example, '```', '']);
    // No authored example: no section at all (live ts-only site unchanged).
    expect(exampleSection(queue, assembly, ['ts'], { construct: true })).toEqual([]);
  });

  test('multi-language: one fenced block per language in a LanguageTabs group', () => {
    const out = exampleSection(queue, assembly, ['ts', 'python', 'go'], { construct: true }).join('\n');
    expect(out).toContain('## Example');
    expect(out).toContain('<LanguageTabs :langs="[\'ts\', \'python\', \'go\']">');
    // Example variants stay HYDRATED (no v-pre): each fence compiles into a
    // Shiki div with the runtime-wired copy-code button, which v-pre would
    // ship dead on non-canonical tabs. Pagefind still indexes only the
    // canonical variant.
    expect(out).toContain('<div class="lang-variant" data-lang="python" data-pagefind-ignore>');
    expect(out).not.toContain('v-pre');
    // Per-language fence ids drive Shiki highlighting (+ the copy button).
    expect(out).toContain('```ts');
    expect(out).toContain('```python');
    expect(out).toContain('```go');
    expect(out).toContain('queue = Queue(self, "MyQueue")');
  });

  test('multi-language: authored example takes the TypeScript tab, snippets fill the rest', () => {
    const out = exampleSection(authored, assembly, ['ts', 'python'], { construct: true }).join('\n');
    expect(out).toContain('fifo: true');
    expect(out).toContain('queue = Queue(self, "MyQueue")');
  });

  test('multi-language, non-instantiable type with no tablet: authored example stays a bare ts fence', () => {
    const struct: spec.InterfaceType = {
      assembly: 'aws-cdk-lib',
      fqn: 'aws-cdk-lib.aws_sqs.QueueProps',
      kind: spec.TypeKind.Interface,
      name: 'QueueProps',
      datatype: true,
      docs: { example: '{ fifo: true }' },
    };
    const out = exampleSection(struct, assembly, ['ts', 'python']);
    expect(out).toEqual(['## Example {#example}', '', '```ts', '{ fifo: true }', '```', '']);
    // And with no authored example there is no section.
    expect(exampleSection({ ...struct, docs: {} }, assembly, ['ts', 'python'])).toEqual([]);
  });
});

describe('generated pages', () => {
  let multiDir: string;
  let tsOnlyDir: string;

  beforeAll(() => {
    multiDir = mkdtempSync(join(tmpdir(), 'code-examples-multi-'));
    tsOnlyDir = mkdtempSync(join(tmpdir(), 'code-examples-ts-'));
    generateDocs(
      { modules: ['constructs'] },
      { outDir: multiDir, packageRoot: ROOT, languages: ['ts', 'python'] },
    );
    generateDocs(
      { modules: ['constructs'] },
      { outDir: tsOnlyDir, packageRoot: ROOT, languages: ['ts'] },
    );
  });

  afterAll(() => {
    rmSync(multiDir, { recursive: true, force: true });
    rmSync(tsOnlyDir, { recursive: true, force: true });
  });

  test('multi-language class pages carry a per-language Example section', () => {
    const page = readFileSync(join(multiDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    expect(page).toContain('## Example');
    expect(page).toContain('```python');
    expect(page).toContain('from constructs import Construct');
  });

  test('ts-only pages are unchanged: no generated Example section', () => {
    const page = readFileSync(join(tsOnlyDir, 'docs', 'constructs.Construct.md'), 'utf-8');
    expect(page).not.toContain('## Example');
    expect(page).not.toContain('LanguageTabs');
  });
});
