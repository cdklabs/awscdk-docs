/**
 * Where a generated overview page's prose actually came from.
 *
 * The doc-footer edit link should point at the upstream `README.md` owned
 * by the package that ships the module, not at this repository's
 * `src/docgen` directory — a reader who spotted a typo can only edit the
 * former.
 *
 * Provenance is already in the jsii assembly, so nothing new is fetched:
 *
 * - `assembly.repository` gives the owning repository and the package's
 *   directory inside it (`packages/aws-cdk-lib`,
 *   `packages/@aws-cdk/aws-bedrock-alpha`), so a standalone or alpha
 *   package resolves to its own repository rather than a hardcoded one.
 * - a submodule's `symbolId` names the source path it was declared in
 *   (`aws-s3/index:`), whose directory is the one holding that
 *   submodule's README. This is the assembly's own answer, so no naming
 *   convention has to be assumed.
 *
 * The URL is pinned to `HEAD` rather than to the assembly's version tag:
 * an edit link should land on the branch a change can be made against,
 * and the alpha assemblies carry a version (`2.266.0-alpha.0`) for which
 * no upstream tag exists, so a tag-pinned link would be dead for every
 * alpha package. GitHub resolves `HEAD` to the repository's default
 * branch, so this works without knowing what a third-party repo calls it.
 */

import * as spec from '@jsii/spec';

/** Ref used in generated URLs — GitHub resolves it to the default branch. */
const DEFAULT_REF = 'HEAD';

/**
 * The only repository URL shape this will turn into a link: an absolute
 * `https://` URL with no character that could break out of an attribute.
 *
 * `repository.url` is package metadata — untrusted input that ends up bound
 * into an `href` on hundreds of pages, and Vue does not sanitize a bound
 * `href`. So this is the same trust boundary `SAFE_HREF` guards in
 * `docs/.vitepress/type-links.ts`, and it fails the same way: anything that
 * is not plainly an https URL yields no link at all. That covers a
 * `javascript:` URL, which would otherwise render an executing anchor, and
 * equally the SSH and npm-shorthand forms npm permits
 * (`git@github.com:aws/aws-cdk.git`, `ssh://…`, `github:owner/repo`),
 * which would produce a link that silently 404s. Both fail closed into the
 * no-repository path.
 */
const SAFE_REPO_URL = /^https:\/\/[\w\-.]+(?::\d+)?(?:\/[\w\-./@]*)?$/;

/**
 * Repository base URL with the git decorations removed, e.g.
 * `git+https://github.com/aws/aws-cdk.git` -> `https://github.com/aws/aws-cdk`.
 * `undefined` when the assembly declares no repository URL or declares one
 * this will not render, in which case nothing can be linked.
 */
function repoBase(assembly: spec.Assembly): string | undefined {
  const url = assembly.repository?.url;
  if (!url) {
    return undefined;
  }
  const base = url.replace(/^git\+/, '').replace(/\.git$/, '');
  return SAFE_REPO_URL.test(base) ? base : undefined;
}

/** One repository path segment: a plain file or directory name, never `.` or `..`. */
const PATH_SEGMENT = /^(?!\.{1,2}$)[\w.@-]+$/;

/**
 * A repository-relative directory as URL path data: `''` for the root, the `/`-joined segments otherwise, or
 * `undefined` when any segment is not a plain name (the caller then emits no link).
 */
function pathDir(dir: string): string | undefined {
  const segments = dir.split('/').filter((seg) => seg !== '');
  return segments.every((seg) => PATH_SEGMENT.test(seg)) ? segments.join('/') : undefined;
}

/** Directory prefix of the package inside its repository, `''` when at the root, `undefined` when not a plain path. */
function packageDir(assembly: spec.Assembly): string | undefined {
  const dir = pathDir(assembly.repository?.directory ?? '');
  return dir === undefined ? undefined : dir ? `${dir}/` : '';
}

/**
 * Directory a submodule's README lives in, read off its `symbolId`.
 *
 * `symbolId` is `<source path>:<symbol>` with the symbol empty for a
 * submodule, so `aws-s3/index:` means the submodule was declared in
 * `aws-s3/index.ts` and its README sits beside it at `aws-s3/README.md`.
 * A submodule declared at the package root would leave nothing here, so
 * an empty result is returned as `''` and the caller still produces a
 * valid path.
 */
export function submoduleDir(symbolId: string | undefined): string | undefined {
  if (!symbolId) {
    return undefined;
  }
  const source = symbolId.replace(/:.*$/, '');
  const slash = source.lastIndexOf('/');
  return slash === -1 ? '' : pathDir(source.slice(0, slash));
}

/**
 * Upstream `README.md` URL for a module id, or `undefined` when the
 * module has no README in the assembly — in which case the caller must
 * render no edit link at all rather than a misleading fallback.
 *
 * `id` is the same module id used everywhere else: `<assemblyName>` for a
 * package root, `<assemblyName>.<submodule>` for a submodule.
 */
export function upstreamReadmeUrl(assembly: spec.Assembly, id: string): string | undefined {
  const base = repoBase(assembly);
  const dir = packageDir(assembly);
  if (!base || dir === undefined) {
    return undefined;
  }
  const prefix = `${base}/blob/${DEFAULT_REF}/${dir}`;

  if (id === assembly.name) {
    return assembly.readme?.markdown ? `${prefix}README.md` : undefined;
  }

  const sub = assembly.submodules?.[id];
  if (!sub?.readme?.markdown) {
    return undefined;
  }
  const subDir = submoduleDir(sub.symbolId);
  if (subDir === undefined) {
    return undefined;
  }
  return subDir ? `${prefix}${subDir}/README.md` : `${prefix}README.md`;
}
