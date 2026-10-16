import { assertValidVersion, isValidVersion, VERSION_PARSE_PATTERN, VERSION_PATTERN } from '../src/docgen/version-format.js';

describe('version format', () => {
  test('accepts the shapes the tracked packages actually publish', () => {
    for (const good of [
      '2.268.0', // aws-cdk-lib
      '2.1141.0', // aws-cdk
      '1.41.0', // @aws-cdk/toolkit-lib
      '54.23.0', // @aws-cdk/cloud-assembly-schema
      '2.268.0-alpha.0', // the alpha cursor
      '2.268.0-rc.1',
      '10.0.0',
    ]) {
      expect(isValidVersion(good)).toBe(true);
    }
  });

  test('rejects anything with text beyond the version', () => {
    for (const bad of [
      '2.268.0 TRAILING-TEXT',
      '2.268.0; INERT-PAYLOAD-MARKER',
      '2.268.0/../../elsewhere',
      '2.268.0\nforged=second-line',
      '2.268.0 ',
      ' 2.268.0',
      '2.268.0.1',
      'v2.268.0', // canonical form takes no v-prefix; dist-tags never carry one
      '2.268',
      'latest',
      '',
    ]) {
      expect(isValidVersion(bad)).toBe(false);
    }
  });

  test('rejects non-strings rather than coercing them', () => {
    for (const bad of [undefined, null, 42, {}, [], ['2.268.0']]) {
      expect(isValidVersion(bad)).toBe(false);
    }
  });

  test('a trailing newline does not satisfy the anchor', () => {
    expect(VERSION_PATTERN.test('2.268.0\n')).toBe(false);
    expect(VERSION_PARSE_PATTERN.test('2.268.0\n')).toBe(false);
  });

  test('both patterns are end-anchored', () => {
    expect(VERSION_PATTERN.source.endsWith('$')).toBe(true);
    expect(VERSION_PARSE_PATTERN.source.endsWith('$')).toBe(true);
  });

  test('the parse pattern tolerates a v-prefix and captures the release parts', () => {
    const match = 'v2.268.0-alpha.0'.match(VERSION_PARSE_PATTERN);
    expect(match?.slice(1, 4)).toEqual(['2', '268', '0']);
  });

  test('assertValidVersion names the offending input and quotes the value', () => {
    expect(() => assertValidVersion('some-file: "key"', '2.268.0 TRAILING-TEXT')).toThrow(
      /some-file: "key" must be a semver version, got "2\.268\.0 TRAILING-TEXT"/,
    );
    expect(assertValidVersion('some-file: "key"', '2.268.0')).toBe('2.268.0');
  });
});
