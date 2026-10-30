import { expect, test } from '@playwright/test';
import { QUEUE_ENCRYPTION_PAGE, QUEUE_PAGE, QUEUE_PROPS_PAGE } from './fixture.js';

const STORAGE_KEY = 'cdk-docs-language';

function navSlider(page: import('@playwright/test').Page) {
  return page.getByRole('radiogroup', { name: 'Select programming language' });
}

// Real generated type pages must carry no in-page language tab strips
// either -- the variant groups there are the docgen-emitted signatures,
// install/import and example blocks.
test.describe('no in-page tab strips (generated page)', () => {
  test('type page has variant groups but zero tab bars or tab roles', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    await expect(page.locator('.lang-tabs').first()).toBeAttached();
    await expect(page.locator('.lang-tabs .lang-tabs-bar')).toHaveCount(0);
    await expect(page.locator('.lang-tabs [role="tablist"]')).toHaveCount(0);
    await expect(page.locator('.lang-tabs [role="tab"]')).toHaveCount(0);

    // Hidden non-active variants stay in the DOM (Model B toggling and the
    // Pagefind-ignore marking both depend on the markup being present).
    const pythonVariant = page.locator('.lang-variant[data-lang="python"]').first();
    await expect(pythonVariant).toBeAttached();
    await expect(pythonVariant).toBeHidden();
  });
});

// `## Example` variants on REAL generated pages must stay hydrated.
// Non-canonical inert variants are
// `v-pre` to keep hydration chunks small, but the example fences compile
// into Shiki blocks whose copy-code button the theme wires up at runtime —
// under `v-pre` the button would ship dead on every non-canonical variant
// while the TypeScript one kept a working one. Unit tests only check the
// attribute string; this drives the built, hydrated page (AGENTS.md rule 7).
test.describe('code-example copy button (generated page)', () => {
  test('copy button works on the non-canonical (python) example variant', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(QUEUE_PAGE);

    // The example group: the variant group whose variants are fenced blocks.
    const group = page.locator('.lang-tabs', {
      has: page.locator('.lang-variant[data-lang="python"] div[class*="language-"]'),
    }).first();
    await navSlider(page).getByRole('radio', { name: 'Python' }).click();

    const pyBlock = group.locator('.lang-variant[data-lang="python"] div[class*="language-"]');
    await expect(pyBlock).toBeVisible();
    await expect(pyBlock.locator('pre.shiki code')).toBeVisible();

    // The copy button must be LIVE, not just present: VitePress flips it
    // into its `copied` state only after the runtime click handler actually
    // copied — a dead (v-pre'd) button never gets there.
    const copy = pyBlock.locator('button.copy');
    await expect(copy).toBeAttached();
    await pyBlock.hover();
    await copy.click();
    await expect(copy).toHaveClass(/copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Queue');
  });
});

// Member/method display names flip with the active language while the
// heading anchor stays canonical: the docgen emitters wrap
// each `## Methods` section in a tabs group and embed one name span per
// language in the heading, with the `#anchor` pinned to the TS slug.
test.describe('member names (generated page)', () => {
  test('switching to Python transliterates method headings; deep links stay canonical', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    // Queue inherits addToResourcePolicy; its ROW id is the canonical
    // (TS-derived) slug regardless of language — the same slug the removed
    // heading produced, which is what keeps existing deep links resolving.
    const heading = page.locator('#addtoresourcepolicy');
    await expect(heading).toBeVisible();
    // The row's variant carries the whole SIGNATURE, not a bare heading name
    // — so the display claim is that the canonical variant opens with the
    // TypeScript spelling of the member.
    await expect(heading.locator('.lang-variant[data-lang="ts"]'))
      .toHaveText(/^addToResourcePolicy\(/);
    await expect(heading.locator('.lang-variant[data-lang="python"]')).toBeHidden();

    // The permalink's accessible name is the clean canonical member name, and
    // it comes from the ROW rather than from a heading anchor: docgen emits it
    // directly with the canonical name, so it does not depend on VitePress
    // deriving a label from heading source.
    await expect(heading.locator('a.member-permalink')).toHaveAttribute(
      'aria-label',
      'Permalink to addToResourcePolicy',
    );

    // Switch via the navbar slider: the displayed name flips to snake_case.
    const slider = page.getByRole('radiogroup', { name: 'Select programming language' });
    await slider.getByRole('radio', { name: 'Python' }).click();
    await expect(heading.locator('.lang-variant[data-lang="python"]'))
      .toHaveText(/^def add_to_resource_policy\(/);
    await expect(heading.locator('.lang-variant[data-lang="ts"]')).toBeHidden();

    // A canonical `#member` deep link resolves in a non-TS language too.
    await page.goto(`${QUEUE_PAGE}?lang=python#addtoresourcepolicy`);
    await expect(page.locator('#addtoresourcepolicy .lang-variant[data-lang="python"]')).toBeVisible();
  });
});

// C# variants on REAL generated pages: with dotnet enabled in
// docgen.config.json the fixture build emits a dotnet variant in every
// group. Per AGENTS.md rule 7 the language variants are a named
// interactive feature, so the language moves with browser coverage:
// variant visibility, ?lang= persistence, and a LIVE copy button carrying
// the NuGet install line examples.ts leads C# snippets with. Selection
// happens through the navbar slider.
test.describe('C# variant (generated page)', () => {
  test('switching to C# shows the dotnet variant, hides the others, and persists', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    const group = page.locator('.lang-tabs', {
      has: page.locator('.lang-variant[data-lang="dotnet"] div[class*="language-"]'),
    }).first();
    await navSlider(page).getByRole('radio', { name: 'C# / .NET' }).click();

    // The dotnet variant is shown; the other language variants are hidden.
    await expect(group).toHaveAttribute('data-active', 'dotnet');
    await expect(group.locator('.lang-variant[data-lang="dotnet"]')).toBeVisible();
    await expect(group.locator('.lang-variant[data-lang="ts"]')).toBeHidden();
    await expect(group.locator('.lang-variant[data-lang="python"]')).toBeHidden();

    // The choice persists into ?lang=dotnet + localStorage, path untouched.
    await expect(page).toHaveURL(/[?&]lang=dotnet/);
    await expect(page).toHaveURL(/\/v2\/docs\/aws-cdk-lib\.aws_sqs\.Queue/);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('dotnet');
  });

  test('copy button works on the C# example variant and copies the NuGet install line', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(QUEUE_PAGE);

    const group = page.locator('.lang-tabs', {
      has: page.locator('.lang-variant[data-lang="dotnet"] div[class*="language-"]'),
    }).first();
    await navSlider(page).getByRole('radio', { name: 'C# / .NET' }).click();

    const csBlock = group.locator('.lang-variant[data-lang="dotnet"] div[class*="language-"]');
    await expect(csBlock).toBeVisible();
    await expect(csBlock.locator('pre.shiki code')).toBeVisible();

    // The button must be LIVE (v-pre'd non-canonical variants would ship a
    // dead one), and the copied text must lead with the NuGet install
    // command derived from the assembly's targets.dotnet coordinates.
    const copy = csBlock.locator('button.copy');
    await expect(copy).toBeAttached();
    await csBlock.hover();
    await copy.click();
    await expect(copy).toHaveClass(/copied/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('// Install: dotnet add package');
    expect(copied).toContain('Queue');
  });
});

// Non-instantiable types (structs, enums) show their authored example's rosetta tablet translation in the reader's
// language, like class pages: the `## Example` section is a variant group even though nothing can be generated for
// these types. Drives the built pages, per AGENTS.md rule 7.
test.describe('struct and enum example variants (generated page)', () => {
  /** The `## Example` group: the variant group whose variants are fenced code blocks. */
  function exampleGroup(page: import('@playwright/test').Page) {
    return page.locator('.lang-tabs', {
      has: page.locator('.lang-variant[data-lang="python"] div[class*="language-"]'),
    }).first();
  }

  for (const [name, path] of [['QueueProps', QUEUE_PROPS_PAGE], ['QueueEncryption', QUEUE_ENCRYPTION_PAGE]] as const) {
    test(`${name}: choosing Python shows the Python example and hides the TypeScript one`, async ({ page }) => {
      await page.goto(path);
      const group = exampleGroup(page);
      await expect(group).toBeAttached();
      await navSlider(page).getByRole('radio', { name: 'Python' }).click();

      await expect(group).toHaveAttribute('data-active', 'python');
      await expect(group.locator('.lang-variant[data-lang="python"] pre.shiki code')).toBeVisible();
      await expect(group.locator('.lang-variant[data-lang="ts"]')).toBeHidden();
    });

    test(`${name}: ?lang=java shows the Java example`, async ({ page }) => {
      await page.goto(`${path}?lang=java`);
      const group = exampleGroup(page);
      await expect(group).toHaveAttribute('data-active', 'java');
      await expect(group.locator('.lang-variant[data-lang="java"] pre.shiki code')).toBeVisible();
      await expect(group.locator('.lang-variant[data-lang="ts"]')).toBeHidden();
    });
  }

  test('copy button works on the Python example variant of QueueProps', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(QUEUE_PROPS_PAGE);
    await navSlider(page).getByRole('radio', { name: 'Python' }).click();

    const pyBlock = exampleGroup(page).locator('.lang-variant[data-lang="python"] div[class*="language-"]');
    await expect(pyBlock).toBeVisible();
    const copy = pyBlock.locator('button.copy');
    await expect(copy).toBeAttached();
    await pyBlock.hover();
    await copy.click();
    await expect(copy).toHaveClass(/copied/);
    // The tablet's Python translation, not the authored TypeScript.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('sqs.');
    expect(copied).not.toContain('new ');
  });
});

// Initializer signature fences: the `## Initializer` block on a
// generated construct page is emitted as a REAL fenced code block per
// language variant, flowing through the same markdown-it -> Shiki pipeline
// as the `## Example` fences — which makes it a hydrated interactive
// surface (copy button, language-tab toggling) that AGENTS.md rule 7
// requires browser coverage for. Mirrors the example-fence copy test above.
test.describe('initializer signature fences (generated page)', () => {
  test('initializer renders as a Shiki fence per language', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    // The initializer group is the variant group inside the
    // Pagefind-ignored container that follows the ## Initializer heading.
    const group = page.locator('h2#initializer + div[data-pagefind-ignore] .lang-tabs');
    await expect(group).toBeAttached();

    // (a) Each language variant is a real highlighted fence: Shiki
    // `language-<lang>` div wrapping `pre.shiki code`, not the retired
    // hand-rolled <pre class="signature"> markup.
    const tsBlock = group.locator('.lang-variant[data-lang="ts"] div[class*="language-"]');
    await expect(tsBlock).toBeVisible();
    await expect(tsBlock.locator('pre.shiki code')).toBeVisible();
    await expect(group.locator('pre.signature')).toHaveCount(0);

    const pyBlock = group.locator('.lang-variant[data-lang="python"] div[class*="language-"]');
    await expect(pyBlock.locator('pre.shiki code')).toBeAttached();
    await expect(pyBlock).toBeHidden();

    // Switching language via the navbar swaps which fence is visible.
    await navSlider(page).getByRole('radio', { name: 'Python' }).click();
    await expect(pyBlock).toBeVisible();
    await expect(pyBlock.locator('pre.shiki code')).toBeVisible();
    await expect(tsBlock).toBeHidden();
  });

  test('parameter types stay linked to their pages inside the fence', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    const group = page.locator('h2#initializer + div[data-pagefind-ignore] .lang-tabs');
    // The retired hand-rolled renderer cross-linked every parameter type;
    // the fence path keeps that via the type-links attr the highlight hook
    // resolves into anchors — inside the Shiki token markup, on every
    // language variant.
    const tsLink = group.locator('.lang-variant[data-lang="ts"] pre.shiki a.code-type-link', { hasText: 'QueueProps' });
    await expect(tsLink).toBeVisible();
    await expect(tsLink).toHaveAttribute('href', /aws-cdk-lib\.aws_sqs\.QueueProps/);
    const construct = group.locator('.lang-variant[data-lang="ts"] pre.shiki a.code-type-link', { hasText: 'Construct' });
    await expect(construct).toHaveAttribute('href', /constructs\.Construct/);

    // The link actually navigates to the type's page.
    await tsLink.click();
    await expect(page).toHaveURL(/aws-cdk-lib\.aws_sqs\.QueueProps/);

    // Non-canonical variants carry the same links (PascalCase type names
    // are language-invariant).
    await page.goBack();
    await navSlider(page).getByRole('radio', { name: 'Python' }).click();
    const pyLink = group.locator('.lang-variant[data-lang="python"] pre.shiki a.code-type-link', { hasText: 'QueueProps' });
    await expect(pyLink).toBeVisible();
  });

  test('copy button works on the non-canonical (python) initializer variant', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(QUEUE_PAGE);

    const group = page.locator('h2#initializer + div[data-pagefind-ignore] .lang-tabs');
    await navSlider(page).getByRole('radio', { name: 'Python' }).click();

    const pyBlock = group.locator('.lang-variant[data-lang="python"] div[class*="language-"]');
    await expect(pyBlock).toBeVisible();

    // (b) The copy button must be LIVE, not just present: the initializer
    // fences are `hydrated: true` exactly so the runtime-wired copy handler
    // works on non-canonical tabs — a v-pre'd variant would ship it dead,
    // and only VitePress's real click handler flips the `copied` state.
    const copy = pyBlock.locator('button.copy');
    await expect(copy).toBeAttached();
    await pyBlock.hover();
    await copy.click();
    await expect(copy).toHaveClass(/copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Queue');
  });
});

// Narrow-viewport wrap: a generated initializer signature has 3+ typed
// parameters nobody can shorten, so on a phone it must WRAP instead of
// scrolling sideways. The initializer is a Shiki fence, so the wrap rule
// lives on the initializer's Pagefind-ignored container (responsive.css) --
// scoped there so authored `## Example` fences keep the standard horizontal
// scroll.
test.describe('initializer signature wraps on narrow viewports', () => {
  test.use({ viewport: { width: 375, height: 720 } });

  test('initializer fence wraps; example fence keeps horizontal scroll', async ({ page }) => {
    await page.goto(QUEUE_PAGE);

    const initCode = page.locator('h2#initializer + div[data-pagefind-ignore] .lang-variant[data-lang="ts"] pre.shiki code');
    await expect(initCode).toBeVisible();
    await expect(initCode).toHaveCSS('white-space', 'pre-wrap');

    // Wrapping means the fence needs no sideways scroll on a 375px phone.
    const initPre = page.locator('h2#initializer + div[data-pagefind-ignore] .lang-variant[data-lang="ts"] pre.shiki');
    const overflow = await initPre.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // The scoping matters: an authored example fence on the same page
    // keeps the default no-wrap behavior (scrolls sideways when long).
    // The `## Example` section precedes `## Initializer`, so the first
    // matching fence is the example one (`.last()` would pick the
    // initializer fence, which legitimately wraps).
    const exampleCode = page.locator('.lang-tabs .lang-variant[data-lang="ts"] pre.shiki code').first();
    await expect(exampleCode).not.toHaveCSS('white-space', 'pre-wrap');
  });
});

