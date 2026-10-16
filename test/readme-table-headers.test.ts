import { labelEmptyTableHeaders, renderOverviewPage } from '../src/docgen';

describe('README table headers', () => {
  const table = [
    '| | Strong | Weak |',
    '| --- | --- | --- |',
    '| Same region | Export | Lookup |',
  ].join('\n');

  test('labels a blank leading header without changing visible columns', () => {
    expect(labelEmptyTableHeaders(table)).toBe([
      '| <span class="visually-hidden">Row</span> | Strong | Weak |',
      '| --- | --- | --- |',
      '| Same region | Export | Lookup |',
    ].join('\n'));
  });

  test('emits the label as markup after README prose escaping', () => {
    const page = renderOverviewPage({ title: 'fake.sub', types: [], readme: table });

    expect(page).toContain('<span class="visually-hidden">Row</span>');
    expect(page).not.toContain('&lt;span class="visually-hidden">');
  });

  test('leaves named headers, blank data cells, and fenced examples unchanged', () => {
    const markdown = [
      '| Name | Value |',
      '| --- | --- |',
      '| | Empty name |',
      '```md',
      '| | Example |',
      '| --- | --- |',
      '```',
    ].join('\n');

    expect(labelEmptyTableHeaders(markdown)).toBe(markdown);
  });
});
