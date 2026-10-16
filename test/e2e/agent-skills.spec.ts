import { expect, test } from '@playwright/test';

// The agent skills page and the home feature card that reaches it. These are
// theme-rendered assertions — the feature-card link and the copy
// button VitePress attaches to a fenced block — so they belong here rather
// than in a Jest unit test (AGENTS.md rule 7). The command string itself is
// pinned in test/skills.test.ts.
const INSTALL_COMMAND =
  'npx skills add https://github.com/aws/agent-toolkit-for-aws --skill aws-cdk';

test.describe('agent skills page', () => {
  test('the home feature card navigates to the page', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.VPFeature', { hasText: 'Agent Skills' });
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page).toHaveURL(/\/skills(\.html)?$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Agent Skills' }),
    ).toBeVisible();
  });

  test('the navbar reaches the page without growing the control row', async ({ page }) => {
    // Both halves matter: the link is reachable, and the row still holds three
    // entries, which is what keeps nav-controls.spec.ts valid.
    await page.goto('/');
    await expect(
      page.locator('.VPNavBar').getByRole('link', { name: 'Skills' }),
    ).toHaveCount(1);
    await expect(page.locator('.VPNavBarMenu .VPNavBarMenuLink')).toHaveCount(3);
    await expect(
      page.locator('.VPNavBarMenu').getByRole('link', { name: 'Home' }),
    ).toHaveCount(0);
  });

  test('the site title still navigates to the homepage', async ({ page }) => {
    // Guards the assumption the `Home` removal rests on.
    await page.goto('/skills.html');
    await page.locator('.VPNavBarTitle a').first().click();
    await expect(page).toHaveURL(/\/(index\.html)?$/);
  });

  test('the install command is in a copyable code block', async ({ page }) => {
    await page.goto('/skills.html');
    // The command must be one unbroken line a reader can paste.
    const block = page.locator('div[class*="language-bash"]').first();
    await expect(block).toBeVisible();
    await expect(block.locator('code')).toHaveText(INSTALL_COMMAND);
    // VitePress renders its copy button into the language container; it is
    // the reason this is a page and not a bare outbound nav link.
    await expect(block.locator('button.copy')).toHaveCount(1);
  });

  test('the page links out and vendors nothing', async ({ page }) => {
    await page.goto('/skills.html');
    const content = page.locator('.VPDoc');
    await expect(
      content.locator(
        'a[href="https://github.com/aws/agent-toolkit-for-aws/tree/main/skills/core-skills/aws-cdk"]',
      ),
    ).toHaveCount(1);
    await expect(
      content.locator(
        'a[href="https://github.com/aws/agent-toolkit-for-aws/tree/main/skills"]',
      ),
    ).toHaveCount(1);
  });
});
