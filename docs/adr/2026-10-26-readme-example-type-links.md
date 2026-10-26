# Type Links in README Code Examples

## Status

Accepted

Extends the "Link type names inside example code" section of
[markdown rendering](./2026-10-15-markdown-rendering.md) from type-page
examples to README examples. The `type-links=Name:href,…` fence attribute,
the one `applyTypeLinks` hook that draws the links and its name and href
validation all stand.

## Context

Signature fences and the Example section on type pages link their types, but
README code examples and inline code in README prose did not. A README
example draws on many modules, so the type-page rule (a display name of the
page's own assembly) would guess. The choices below were settled with the
maintainer before the work started.

## Decision

- **Resolve from the example's imports.** `src/docgen/readme-links.ts` reads
  an example's import statements and binds each local name to the jsii fqn it
  stands for: a named import (`import { App } from 'aws-cdk-lib'`), an alias
  (`aws_s3 as s3`), a namespace (`import * as s3 from 'aws-cdk-lib/aws-s3'`)
  and `import s3 = require(…)`. Import paths map to the documented packages
  and their top-level submodules, spelled with dashes (`aws-cdk-lib/aws-s3`).
- **The compiled imports count.** Most README examples show no imports;
  rosetta compiles them with fixture imports. The tablet keeps the import
  statements of each example's fixtured `fullSource`
  (`RosettaTablet.compiledFor`), and those are resolved alongside the visible
  ones.
- **Chains resolve step by step.** In `cdk.aws_s3.Bucket` or
  `s3.CfnBucket.LoggingConfigurationProperty`, each step that is a type with
  a page links; a member such as `fromBucketName` does not.
- **Never guess.** A name that is not imported, has no page, is declared by
  the example itself (`class MyStack`, `const App = …`), sits in a string or
  comment, or would resolve to two different pages stays plain.
- **One attribute per example, on every tab.** A translated example's tabs
  are the same compiled example, so the TypeScript example's resolution is
  stamped on each language's fence. Python and Java keep the type names, so
  they link the same names. C# keeps them too. Go spells constructors
  `NewBucket`, so only its struct names (`BucketProps`) match.
- **Untranslated fences link too.** A TypeScript fence left in the prose
  carries the same attribute, from its visible imports and, when rosetta
  compiled it, its fixture imports.
- **Inline code.** In README prose, an inline code span that is exactly a
  type name of the README's own module links to that type
  (`` `Queue` `` in the `aws_sqs` README). Prose has no imports, so that is
  the only safe resolution: names from other modules, members and longer
  expressions stay plain, as do spans in headings and inside link text.
- **Unchanged:** syntax colors, the copy button text, the search index, page
  routes and anchors. The links reuse the `code-type-link` style, now with a
  focus ring.

## Consequences

- Every README example and inline code span that names a documented type
  links to it, and the hover preview works on those links.
- The TypeScript, Python, Java and C# tabs are covered; Go only for struct
  names.
- `test/readme-type-links.test.ts` covers the import forms, a name that is
  not imported, a name with no page, a name declared locally, chains, strings
  and comments, conflicting resolutions, fixture imports, and on built pages
  the aws-cdk-lib README example and that every added link targets an
  existing page. `test/e2e/readme-type-links.spec.ts` checks clicking,
  the hover preview, the copy button, inline code and the focus ring.
