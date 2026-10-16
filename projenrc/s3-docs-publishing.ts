import { Component, github, typescript } from 'projen';
import { VERSION_PARSE_PATTERN } from '../src/docgen/version-format.js';

/**
 * The GitHub environment holding the publishing configuration
 * (AWS_ROLE_TO_ASSUME_FOR_ACCOUNT, DOCS_BUCKET_NAME,
 * PUBLISH_CDK_REF_DOCS_ROLE_ARN). The OIDC role trust is conditioned on
 * this environment claim.
 */
const PUBLISH_ENVIRONMENT = 'release';

export interface S3DocsPublishingProps {
  /**
   * The docs stream to publish to.
   */
  readonly docsStream: string;

  /**
   * The path to the site zip within the downloaded `docs-site` artifact.
   */
  readonly artifactPath: string;

  /**
   * The role arn (or github expression) for OIDC to assume to do the actual publishing.
   */
  readonly roleToAssume: string;

  /**
   * The bucket name (or github expression) to publish to.
   */
  readonly bucketName: string;

  /**
   * The path prefix for the versioned docs artifacts
   *
   * @example "foobar" -> "foobar-v1.2.3.zip"
   * @default - sanitized package name
   */
  readonly s3PathPrefix?: string;

  /**
   * Zip-internal path of the site's versions.json endpoint. The dist tree
   * mirrors the hosted URL (#150), so this is the site base plus
   * `api/versions.json` — not the zip root.
   */
  readonly versionsJsonPath: string;
}

/**
 * Publishes a versioned zip of the docs site to S3 from the deploy-and-release workflow. The site zip is produced
 * by the `build` job (`docs-site` artifact). The artifact is versioned by
 * the documented aws-cdk-lib, read at publish time from the `api/versions.json` the built site carries inside
 * the zip, so the manifest can never disagree with the artifact it describes.
 *
 * The `latest-<docsStream>` marker is a v2 manifest:
 *
 * ```
 * #manifest-version:2
 * artifact_path=awscdk-docs/awscdk-docs-v1.2.3.zip
 * version=1.2.3
 * published=2026-09-09T07:59:16Z
 * rebuild_nonce=<commit sha>
 * ```
 *
 * The same version can be republished (a rebuild): uploads overwrite and the nonce tells consumers the artifact
 * changed. The marker never moves to an older version: a run documenting an older aws-cdk-lib uploads its
 * artifact but leaves `latest` alone.
 */
export class S3DocsPublishing extends Component {
  private readonly github: github.GitHub;
  private readonly props: S3DocsPublishingProps;

  constructor(project: typescript.TypeScriptProject, props: S3DocsPublishingProps) {
    super(project);

    if (!project.github) {
      throw new Error('This project does not have a GitHub instance');
    }
    this.github = project.github;
    this.props = props;
  }

  public preSynthesize() {
    const releaseWf = this.github.tryFindWorkflow('deploy-and-release');
    if (!releaseWf) {
      throw new Error('Could not find deploy-and-release workflow');
    }

    const safePackageName = this.project.name.replace('@', '').replace('/', '-');
    const docsStreamId = `${safePackageName}-${this.props.docsStream.toLowerCase()}`;
    const s3PathPrefix = this.props.s3PathPrefix ? `${this.props.s3PathPrefix}-v` : `${safePackageName}-v`;

    releaseWf.addJob(`release_docs_${this.props.docsStream}`, {
      name: `Publish docs ${this.props.docsStream} to S3`,
      environment: PUBLISH_ENVIRONMENT,
      // The site zip comes from `build`; `release` is needed for the gate only. Never publish a version that is
      // already tagged, never publish on a dry run, and only publish from main.
      needs: ['release', 'build'],
      if: "needs.release.outputs.tag_exists != 'true' && !inputs.dry_run && github.ref == 'refs/heads/main'",
      runsOn: ['ubuntu-latest'],
      permissions: {
        idToken: github.workflows.JobPermission.WRITE,
        contents: github.workflows.JobPermission.READ,
      },
      steps: [
        {
          name: 'Download docs site',
          uses: github.ActionRefs.ACTIONS_DOWNLOAD_ARTIFACT,
          with: {
            name: 'docs-site',
            path: 'dist',
          },
        },
        {
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: github.ActionRefs.AWS_ACTIONS_CONFIGURE_AWS_CREDENTIALS,
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': '${{ vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT }}',
            'role-session-name': `s3-${docsStreamId}-docs-publishing`,
            'mask-aws-account-id': true,
          },
        },
        {
          name: 'Assume the publishing role',
          id: 'publishing-creds',
          uses: github.ActionRefs.AWS_ACTIONS_CONFIGURE_AWS_CREDENTIALS,
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': this.props.roleToAssume,
            'role-session-name': `s3-${docsStreamId}-docs-publishing`,
            'mask-aws-account-id': true,
            'role-chaining': true,
          },
        },
        {
          name: `Publish docs ${this.props.docsStream}`,
          env: {
            BUCKET_NAME: this.props.bucketName,
            DOCS_STREAM: this.props.docsStream,
            ARTIFACT: `dist/${this.props.artifactPath}`,
            VERSIONS_JSON: this.props.versionsJsonPath,
            // The validated version shape from src/docgen/version-format.ts, kept in lockstep by synth.
            VERSION_PATTERN: VERSION_PARSE_PATTERN.source,
          },
          run: [
            `echo "Uploading ${docsStreamId} to S3"`,
            'echo "::add-mask::$BUCKET_NAME"',
            '',
            // The documented aws-cdk-lib version and its publish timestamp, from the versions.json endpoint the
            // site ships inside the zip. Fails rather than publishing a garbage key or manifest when the
            // endpoint is missing or malformed.
            'CDK_META=$(unzip -p "$ARTIFACT" "$VERSIONS_JSON" | node -e "',
            '  const data = JSON.parse(require(\'fs\').readFileSync(0, \'utf-8\'));',
            '  const lib = data.packages.find((p) => p.package === \'aws-cdk-lib\');',
            '  if (!lib) throw new Error(\'versions.json has no aws-cdk-lib entry\');',
            '  const published = new Date(lib.date).toISOString().replace(/\\.\\d{3}Z$/, \'Z\');',
            '  console.log(lib.version, published);',
            '")',
            'CDK_VERSION=$(echo "$CDK_META" | cut -d\' \' -f1)',
            'CDK_PUBLISHED=$(echo "$CDK_META" | cut -d\' \' -f2)',
            'if [ -z "$CDK_VERSION" ] || [ -z "$CDK_PUBLISHED" ]; then',
            '  echo "::error::could not resolve the documented aws-cdk-lib version from the site zip"',
            '  exit 1',
            'fi',
            // The version is parsed against the shared pattern here, before it reaches the object key below.
            'if ! node -e "',
            '  const pattern = new RegExp(process.env.VERSION_PATTERN);',
            '  if (!pattern.test(process.argv[1])) process.exit(1);',
            '" "$CDK_VERSION"; then',
            '  echo "::error::the documented aws-cdk-lib version is not a valid version: $CDK_VERSION"',
            '  exit 1',
            'fi',
            'echo "Documented aws-cdk-lib: $CDK_VERSION (published $CDK_PUBLISHED)"',
            '',
            `S3_PATH="$DOCS_STREAM/${s3PathPrefix}$CDK_VERSION.zip"`,
            `LATEST="latest-${this.props.docsStream}"`,
            '',
            // No --if-none-match: a rebuild of the same documented version
            // overwrites the artifact; the manifest nonce signals the change.
            'aws s3api put-object \\',
            '  --bucket "$BUCKET_NAME" \\',
            '  --key "$S3_PATH" \\',
            '  --body "$ARTIFACT"',
            '',
            'echo "Artifact uploaded, checking the latest marker"',
            '',
            // The pointer must never move backwards. The versioned artifact above is just a historical copy,
            // so it always uploads; only the marker write is ordered. Presence comes from head-object so that
            // only a missing key reads as the first publish — any other read failure fails the step.
            'MARKER_EXISTS=false',
            'if HEAD_ERR=$(aws s3api head-object --bucket "$BUCKET_NAME" --key "$LATEST" 2>&1 >/dev/null); then',
            '  MARKER_EXISTS=true',
            'elif ! echo "$HEAD_ERR" | grep -q "(404)"; then',
            '  echo "::error::could not read the existing $LATEST marker: $HEAD_ERR"',
            '  exit 1',
            'fi',
            'EXISTING_VERSION=""',
            'if [ "$MARKER_EXISTS" = "true" ]; then',
            '  if ! EXISTING_MARKER=$(aws s3 cp "s3://$BUCKET_NAME/$LATEST" -); then',
            '    echo "::error::could not read the existing $LATEST marker"',
            '    exit 1',
            '  fi',
            '  EXISTING_VERSION=$(echo "$EXISTING_MARKER" | grep "^version=" | cut -d= -f2- || true)',
            'fi',
            'MARKER_ORDER=$(node -e "',
            '  const pattern = new RegExp(process.env.VERSION_PATTERN);',
            '  const parts = (v) => (v.match(pattern) || []).slice(1, 4).map(Number);',
            '  const [current, existing, markerExists] = process.argv.slice(1);',
            '  const cur = parts(current);',
            '  if (cur.length !== 3) { console.error(\'not a valid version: \' + current); process.exit(1); }',
            '  if (markerExists !== \'true\') { console.log(\'absent\'); process.exit(0); }',
            '  const prev = parts(existing);',
            '  if (prev.length !== 3) { console.log(\'invalid\'); process.exit(0); }',
            '  const diff = cur.map((n, i) => n - prev[i]).find((d) => d !== 0) || 0;',
            '  console.log(diff > 0 ? \'newer\' : diff < 0 ? \'older\' : \'equal\');',
            '" "$CDK_VERSION" "$EXISTING_VERSION" "$MARKER_EXISTS")',
            '',
            'if [ "$MARKER_ORDER" = "older" ]; then',
            '  echo "::warning::not updating $LATEST: it points at $EXISTING_VERSION, newer than this build\'s $CDK_VERSION. The artifact is still available at $S3_PATH."',
            '  exit 0',
            'fi',
            'if [ "$MARKER_ORDER" = "invalid" ]; then',
            '  echo "::warning::existing $LATEST marker has no parseable version; overwriting with a valid manifest"',
            'fi',
            '',
            'echo "Updating latest marker ($MARKER_ORDER)"',
            'printf \'#manifest-version:2\\nartifact_path=%s\\nversion=%s\\npublished=%s\\nrebuild_nonce=%s\\n\' \\',
            '  "$S3_PATH" "$CDK_VERSION" "$CDK_PUBLISHED" "$GITHUB_SHA" \\',
            '  | aws s3 cp - "s3://$BUCKET_NAME/$LATEST"',
          ].join('\n'),
        },
      ],
    });
  }
}
