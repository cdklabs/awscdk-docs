import * as spec from '@jsii/spec';

/**
 * Supported documentation languages.
 * Each corresponds to a jsii target language.
 */
export type Language = 'ts' | 'python' | 'java' | 'dotnet' | 'go';

/** Metadata for a supported language. */
export interface LanguageMeta {
  readonly id: Language;
  readonly label: string;
}

/** All supported languages with display metadata. */
export const LANGUAGES: readonly LanguageMeta[] = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'dotnet', label: 'C# / .NET' },
  { id: 'go', label: 'Golang' },
] as const;

/** Default language for the documentation site. */
export const DEFAULT_LANGUAGE: Language = 'ts';

/**
 * Markdown fence language id per documentation language (Shiki ids). Every docgen-emitted code block — authored
 * examples, generated snippets, and generated signatures — uses these ids so all code on a page flows through the
 * one shared `markdown.highlight` pipeline.
 */
export const FENCE_LANG: Record<Language, string> = {
  ts: 'ts',
  python: 'python',
  java: 'java',
  dotnet: 'csharp',
  go: 'go',
};

/**
 * URL prefix of the canonical page tree. The Model B rendering model embeds every enabled language's variants in
 * one page under the `/v2/docs/…` tree, so no language ever appears in a path and the display language is
 * selected client-side (`?lang=`). It is the single declaration of that prefix and has no current readers.
 */
export const CANONICAL_URL_PREFIX: string = DEFAULT_LANGUAGE;

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

/** Convert camelCase to snake_case. */
export function camelToSnake(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** Convert camelCase to PascalCase. */
export function camelToPascal(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------------------------------------------------------------------------
// Name transliteration
// ---------------------------------------------------------------------------

/**
 * Translate a type name (class, interface, enum) to the target language.
 * PascalCase is preserved in all languages.
 */
export function translateTypeName(name: string, _lang: Language): string {
  return name;
}

/**
 * Translate a method name to the target language.
 * - TS/Java: camelCase (unchanged)
 * - Python: snake_case
 * - .NET/Go: PascalCase
 */
export function translateMethodName(name: string, lang: Language): string {
  switch (lang) {
    case 'ts':
    case 'java':
      return name;
    case 'python':
      return camelToSnake(name);
    case 'dotnet':
    case 'go':
      return camelToPascal(name);
  }
}

/**
 * Translate a property name to the target language.
 * Same rules as method names.
 */
export function translatePropertyName(name: string, lang: Language): string {
  switch (lang) {
    case 'ts':
    case 'java':
      return name;
    case 'python':
      return camelToSnake(name);
    case 'dotnet':
    case 'go':
      return camelToPascal(name);
  }
}

/**
 * Translate a parameter name to the target language.
 * - Python: snake_case
 * - Go: PascalCase (jsii's generated struct-style params)
 * - TS/Java/.NET: camelCase (unchanged — .NET conventions PascalCase
 *   methods/properties but NOT parameters, and jsii's C# bindings
 *   follow suit)
 */
export function translateParameterName(name: string, lang: Language): string {
  switch (lang) {
    case 'python':
      return camelToSnake(name);
    case 'go':
      return camelToPascal(name);
    case 'ts':
    case 'java':
    case 'dotnet':
      return name;
  }
}

// ---------------------------------------------------------------------------
// Module / package resolution
// ---------------------------------------------------------------------------

/**
 * Resolve submodule FQN from a type FQN.
 * E.g. 'aws-cdk-lib.aws_s3.Bucket' -> 'aws-cdk-lib.aws_s3'
 */
function resolveSubmoduleFqn(typeFqn: string, assembly: spec.Assembly): string | undefined {
  const submodules = Object.keys(assembly.submodules ?? {});
  // Find the longest matching submodule prefix
  let best: string | undefined;
  for (const sub of submodules) {
    if (typeFqn.startsWith(sub + '.')) {
      if (!best || sub.length > best.length) {
        best = sub;
      }
    }
  }
  return best;
}

/**
 * The full published Go module path for an assembly, per jsii-pacmak's
 * layout: `<targets.go.moduleName>/<packageName>` plus the Go semantic
 * import versioning `/v<major>` suffix for major versions >= 2 (e.g.
 * `github.com/aws/aws-cdk-go` + `awscdk` + `/v2`;
 * `github.com/aws/constructs-go` + `constructs` + `/v10`). The package
 * name defaults to the sanitized assembly name when `targets.go` does
 * not declare one — the same default pacmak applies.
 */
function goModulePath(assembly: spec.Assembly): string | undefined {
  const go = assembly.targets?.go;
  if (!go?.moduleName) {
    return undefined;
  }
  const pkg = ((go.packageName as string | undefined) ?? assembly.name)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const major = parseInt(assembly.version?.split('.')[0] ?? '', 10);
  const suffix = major >= 2 ? `/v${major}` : '';
  return `${go.moduleName}/${pkg}${suffix}`;
}

/**
 * Translate a module/package path for a type FQN.
 * Uses assembly.targets and submodule targets overrides.
 */
export function translateModuleName(
  fqn: string,
  assembly: spec.Assembly,
  lang: Language,
): string {
  const subFqn = resolveSubmoduleFqn(fqn, assembly);
  const targets = assembly.targets;

  switch (lang) {
    case 'ts': {
      // TypeScript uses the jsii module name directly
      if (subFqn) {
        const parts = subFqn.split('.');
        return `${assembly.name}/${parts.slice(1).join('/')}`;
      }
      return assembly.name;
    }

    case 'python': {
      if (subFqn && assembly.submodules?.[subFqn]?.targets?.python) {
        return assembly.submodules[subFqn].targets!.python!.module;
      }
      if (targets?.python) {
        const baseModule = targets.python.module;
        if (subFqn) {
          // Derive submodule: aws-cdk-lib.aws_s3 -> aws_cdk.aws_s3
          const subName = subFqn.split('.').slice(1).join('.');
          return `${baseModule}.${subName}`;
        }
        return baseModule;
      }
      return fqn.split('.')[0];
    }

    case 'java': {
      if (subFqn && assembly.submodules?.[subFqn]?.targets?.java) {
        return assembly.submodules[subFqn].targets!.java!.package;
      }
      if (targets?.java) {
        const basePackage = targets.java.package;
        if (subFqn) {
          const subName = subFqn.split('.').slice(1).join('.');
          return `${basePackage}.${subName}`;
        }
        return basePackage;
      }
      return fqn.split('.')[0];
    }

    case 'dotnet': {
      if (subFqn && assembly.submodules?.[subFqn]?.targets?.dotnet) {
        return assembly.submodules[subFqn].targets!.dotnet!.namespace;
      }
      if (targets?.dotnet) {
        const baseNs = targets.dotnet.namespace;
        if (subFqn) {
          // Convert aws_s3 -> AWS.S3
          const subParts = subFqn.split('.').slice(1);
          const nsParts = subParts.map(p =>
            p.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('.'),
          );
          return `${baseNs}.${nsParts.join('.')}`;
        }
        return baseNs;
      }
      return fqn.split('.')[0];
    }

    case 'go': {
      const base = goModulePath(assembly);
      if (base) {
        if (subFqn) {
          // Resolve the submodule package name. An explicit
          // `submodules[].targets.go.packageName` wins (jsii commonly
          // declares only packageName, no moduleName — e.g. aws_ecr.mixins
          // -> { packageName: 'awsecrmixins' }); otherwise derive it from
          // the submodule name (aws_s3 -> awss3, lowercase, underscores
          // removed).
          const subGo = assembly.submodules?.[subFqn]?.targets?.go;
          const subName = subFqn.split('.').slice(1).pop() ?? '';
          const pkgName = (subGo?.packageName as string | undefined)
            ?? subName.replace(/_/g, '').toLowerCase();
          // Nest under the versioned parent module path. A submodule only
          // sits under a *different* root when it declares its own
          // `moduleName`; the far more common packageName-only override
          // must stay under the versioned parent path
          // (github.com/aws/aws-cdk-go/awscdk/v2/awsecrmixins), never a
          // bare `undefined/` or an unversioned root.
          const root = (subGo?.moduleName as string | undefined) ?? base;
          return `${root}/${pkgName}`;
        }
        return base;
      }
      return fqn.split('.')[0];
    }
  }
}

// ---------------------------------------------------------------------------
// Sidebar module labels
// ---------------------------------------------------------------------------

/**
 * Per-language display names for a (sub)module, as sidebar `labels` input: what the reader knows the module as in
 * each enabled language (`aws-cdk-lib/aws_sqs` in TypeScript, `aws_cdk.aws_sqs` in Python, the target
 * package/namespace in Java/.NET/Go) — the same {@link translateModuleName} resolution the on-page import blocks
 * use, so nav and page always agree. Returns undefined with fewer than two languages, so a single-language build
 * emits no labels.
 */
export function sidebarModuleLabels(
  assembly: spec.Assembly,
  submodule: string,
  languages: readonly Language[],
): Partial<Record<Language, string>> | undefined {
  if (languages.length < 2) {
    return undefined;
  }
  // translateModuleName resolves from a TYPE fqn; probe with a synthetic
  // member of the (sub)module so submodule targets are honored.
  const probe = submodule ? `${assembly.name}.${submodule}.__probe` : `${assembly.name}.__probe`;
  const out: Partial<Record<Language, string>> = {};
  for (const lang of languages) {
    out[lang] = translateModuleName(probe, assembly, lang);
  }
  return out;
}

// ---------------------------------------------------------------------------
// .NET (NuGet) coordinates
// ---------------------------------------------------------------------------

/** NuGet coordinates for a jsii assembly, derived from `targets.dotnet`. */
export interface DotnetCoordinates {
  /** NuGet package id (e.g. `Amazon.CDK.Lib`) — install unit. */
  readonly packageId: string;
  /**
   * C# namespace for the type's (sub)module (e.g. `Amazon.CDK.AWS.SQS`),
   * honoring per-submodule `targets.dotnet.namespace` overrides.
   */
  readonly namespace: string;
}

/**
 * Derive NuGet coordinates from the jsii assembly metadata: the package id comes from the assembly-level
 * `targets.dotnet.packageId` (NuGet packages are per-assembly — submodules ship inside the same package), the
 * namespace from the same submodule-aware resolution the `using` import uses. Returns undefined when the assembly
 * declares no dotnet target — coordinates are never string-munged from the npm name.
 */
export function dotnetCoordinates(
  assembly: spec.Assembly,
  typeFqn?: string,
): DotnetCoordinates | undefined {
  const dotnet = assembly.targets?.dotnet;
  if (!dotnet?.packageId || !dotnet.namespace) {
    return undefined;
  }
  return {
    packageId: dotnet.packageId,
    namespace: typeFqn ? translateModuleName(typeFqn, assembly, 'dotnet') : dotnet.namespace,
  };
}

// Maven coordinates
// ---------------------------------------------------------------------------

/** Maven coordinates of an assembly's published Java artifact. */
export interface MavenCoordinates {
  readonly groupId: string;
  readonly artifactId: string;
}

/**
 * Derive the Maven coordinates for an assembly from its jsii `targets.java.maven` metadata — never from class-name
 * munging. Returns undefined when the assembly declares no Java target, in which case callers (e.g. the install
 * block) omit the Maven surface entirely.
 */
export function mavenCoordinates(assembly: spec.Assembly): MavenCoordinates | undefined {
  const maven = assembly.targets?.java?.maven;
  if (!maven) {
    return undefined;
  }
  return { groupId: maven.groupId, artifactId: maven.artifactId };
}

// ---------------------------------------------------------------------------
// Go coordinates
// ---------------------------------------------------------------------------

/** Go coordinates of an assembly's published Go bindings. */
export interface GoCoordinates {
  /**
   * Go module path (e.g. `github.com/aws/aws-cdk-go/awscdk/v2`) — the
   * `go get` install unit. Go modules are per-assembly; submodule
   * packages ship inside the same module.
   */
  readonly moduleName: string;
  /**
   * Import path for the type's (sub)module package (e.g.
   * `github.com/aws/aws-cdk-go/awscdk/v2/awssqs`), honoring
   * per-submodule `targets.go` overrides.
   */
  readonly importPath: string;
}

/**
 * Derive the Go coordinates for an assembly from its jsii `targets.go` metadata — never from package-name munging.
 * The module path is the full published path incl. the semantic-import-versioning suffix ({@link goModulePath});
 * the import path comes from the same submodule-aware resolution the `import` block uses. Returns undefined when the
 * assembly declares no Go target, in which case callers (e.g. the install/import block) omit the Go surface entirely.
 */
export function goCoordinates(
  assembly: spec.Assembly,
  typeFqn?: string,
): GoCoordinates | undefined {
  const modulePath = goModulePath(assembly);
  if (!modulePath) {
    return undefined;
  }
  return {
    moduleName: modulePath,
    importPath: typeFqn ? translateModuleName(typeFqn, assembly, 'go') : modulePath,
  };
}

// ---------------------------------------------------------------------------
// Import statement generation
// ---------------------------------------------------------------------------

/**
 * Generate a full import statement for a type.
 */
export function translateImport(
  typeFqn: string,
  assembly: spec.Assembly,
  lang: Language,
): string {
  const typeName = typeFqn.split('.').pop()!;
  const modulePath = translateModuleName(typeFqn, assembly, lang);

  switch (lang) {
    case 'ts': {
      const subFqn = resolveSubmoduleFqn(typeFqn, assembly);
      if (subFqn) {
        const subParts = subFqn.split('.').slice(1);
        return `import { ${typeName} } from '${assembly.name}/${subParts.join('/')}';`;
      }
      return `import { ${typeName} } from '${assembly.name}';`;
    }

    case 'python':
      return `from ${modulePath} import ${typeName}`;

    case 'java':
      return `import ${modulePath}.${typeName};`;

    case 'dotnet':
      return `using ${modulePath};`;

    case 'go': {
      const subFqn = resolveSubmoduleFqn(typeFqn, assembly);
      if (subFqn) {
        const subName = subFqn.split('.').slice(1).pop() ?? '';
        const alias = subName.replace(/_/g, '').toLowerCase();
        return `import "${modulePath}" // ${alias}`;
      }
      return `import "${modulePath}"`;
    }
  }
}

// ---------------------------------------------------------------------------
// Type reference translation
// ---------------------------------------------------------------------------

/** Primitive type mapping per language. */
const PRIMITIVE_MAP: Record<Language, Record<string, string>> = {
  ts: {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    any: 'any',
    void: 'void',
    date: 'Date',
    json: 'any',
  },
  python: {
    string: 'str',
    number: 'int | float',
    boolean: 'bool',
    any: 'Any',
    void: 'None',
    date: 'datetime',
    json: 'Any',
  },
  java: {
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    any: 'Object',
    void: 'void',
    date: 'Instant',
    json: 'Object',
  },
  dotnet: {
    string: 'string',
    number: 'double',
    boolean: 'bool',
    any: 'object',
    void: 'void',
    date: 'DateTime',
    json: 'object',
  },
  go: {
    string: '*string',
    number: '*float64',
    boolean: '*bool',
    any: 'interface{}',
    void: '',
    date: '*time.Time',
    json: 'interface{}',
  },
};

/**
 * One fragment of a translated type reference. `fqn` is set only when the fragment NAMES a jsii type, which is what
 * lets a consumer link it — the surrounding syntax is language-specific punctuation and must never be treated as a
 * type name.
 */
export interface TypeRefPart {
  readonly text: string;
  readonly fqn?: string;
}

/**
 * Translate a jsii TypeReference into per-language fragments.
 *
 * This is the single walker over the language's own type syntax. It exists in structured form so a consumer can
 * link the named fragments without a second copy of the syntax rules: {@link translateTypeRef} joins the text,
 * while the HTML consumer escapes syntax and wraps names in anchors, so `typing.List[...]` vs `List<...>` cannot
 * drift across two walkers.
 */
export function translateTypeRefParts(ref: spec.TypeReference, lang: Language): TypeRefPart[] {
  if (spec.isPrimitiveTypeReference(ref)) {
    return [{ text: PRIMITIVE_MAP[lang][ref.primitive] ?? ref.primitive }];
  }

  if (spec.isNamedTypeReference(ref)) {
    const name = ref.fqn.split('.').pop()!;
    return [{ text: translateTypeName(name, lang), fqn: ref.fqn }];
  }

  if (spec.isCollectionTypeReference(ref)) {
    const element = translateTypeRefParts(ref.collection.elementtype, lang);
    switch (ref.collection.kind) {
      case spec.CollectionKind.Array:
        switch (lang) {
          case 'ts': return [...element, { text: '[]' }];
          case 'python': return [{ text: 'typing.List[' }, ...element, { text: ']' }];
          case 'java': return [{ text: 'List<' }, ...element, { text: '>' }];
          case 'dotnet': return [...element, { text: '[]' }];
          case 'go': return [{ text: '*[]' }, ...element];
        }
        break;
      case spec.CollectionKind.Map:
        switch (lang) {
          case 'ts': return [{ text: '{ [key: string]: ' }, ...element, { text: ' }' }];
          case 'python': return [{ text: 'typing.Mapping[str, ' }, ...element, { text: ']' }];
          case 'java': return [{ text: 'Map<String, ' }, ...element, { text: '>' }];
          case 'dotnet': return [{ text: 'IDictionary<string, ' }, ...element, { text: '>' }];
          case 'go': return [{ text: '*map[string]' }, ...element];
        }
        break;
    }
  }

  if (spec.isUnionTypeReference(ref)) {
    const types = ref.union.types.map((t) => translateTypeRefParts(t, lang));
    const joined = (sep: string): TypeRefPart[] =>
      types.flatMap((parts, i) => (i === 0 ? parts : [{ text: sep }, ...parts]));
    switch (lang) {
      case 'ts': return joined(' | ');
      case 'python': return [{ text: 'typing.Union[' }, ...joined(', '), { text: ']' }];
      case 'java': return types[0]; // Java doesn't have union types; use first
      case 'dotnet': return types[0]; // Same for .NET
      case 'go': return [{ text: 'interface{}' }]; // Go uses empty interface for unions
    }
  }

  return [{ text: 'any' }];
}

/**
 * Translate a jsii TypeReference to a language-specific type string.
 */
export function translateTypeRef(ref: spec.TypeReference, lang: Language): string {
  return translateTypeRefParts(ref, lang).map((part) => part.text).join('');
}

// ---------------------------------------------------------------------------
// Signature translation
// ---------------------------------------------------------------------------

/** Translate a parameter to language-specific syntax. */
function translateParam(param: spec.Parameter, lang: Language): string {
  const name = translateParameterName(param.name, lang);
  const type = param.type ? translateTypeRef(param.type, lang) : 'any';
  const optional = param.optional ? '?' : '';

  switch (lang) {
    case 'ts':
      return `${name}${optional}: ${type}`;
    case 'python':
      return param.optional ? `${name}: typing.Optional[${type}] = None` : `${name}: ${type}`;
    case 'java':
      return `${type} ${name}`;
    case 'dotnet':
      return param.optional ? `${type}? ${name} = null` : `${type} ${name}`;
    case 'go':
      return `${name} ${type}`;
  }
}

/**
 * Translate a constructor/initializer call.
 */
export function translateInitializer(
  className: string,
  params: spec.Parameter[],
  lang: Language,
): string {
  const translatedParams = params.map(p => translateParam(p, lang)).join(', ');
  const name = translateTypeName(className, lang);

  switch (lang) {
    case 'ts':
      return `new ${name}(${translatedParams})`;
    case 'python':
      return `${name}(${translatedParams})`;
    case 'java':
      return `new ${name}(${translatedParams})`;
    case 'dotnet':
      return `new ${name}(${translatedParams})`;
    case 'go': {
      // Go uses New<Type> pattern with package prefix
      return `New${name}(${translatedParams})`;
    }
  }
}

/**
 * Translate a method signature (not a call — the declaration form).
 */
export function translateMethodSignature(method: spec.Method, lang: Language): string {
  const name = translateMethodName(method.name!, lang);
  const params = (method.parameters ?? []).map(p => translateParam(p, lang)).join(', ');
  const returnType = method.returns?.type
    ? translateTypeRef(method.returns.type, lang)
    : PRIMITIVE_MAP[lang].void;

  switch (lang) {
    case 'ts': {
      const staticKw = method.static ? 'static ' : '';
      return `${staticKw}${name}(${params}): ${returnType}`;
    }

    case 'python': {
      const decorator = method.static ? '@staticmethod\n' : '';
      const selfParam = method.static ? '' : 'self, ';
      const retAnnotation = returnType !== 'None' ? ` -> ${returnType}` : ' -> None';
      return `${decorator}def ${name}(${selfParam}${params})${retAnnotation}`;
    }

    case 'java': {
      const staticKw = method.static ? 'static ' : '';
      return `public ${staticKw}${returnType} ${name}(${params})`;
    }

    case 'dotnet': {
      const staticKw = method.static ? 'static ' : '';
      return `public ${staticKw}${returnType} ${name}(${params})`;
    }

    case 'go': {
      const retStr = returnType ? ` ${returnType}` : '';
      return `func ${name}(${params})${retStr}`;
    }
  }
}
