import { expect, test, type Page } from '@playwright/test';
import { TOPIC_PAGE } from './fixture.js';

// Short nav labels for nested types: a nested type name like
// `CfnTopic.SubscriptionProperty` DISPLAYS only its last FQN segment in
// the API sidebar — the owning type is already visible as the enclosing
// resource group — while the entry's identity is untouched: its link is
// the unchanged canonical URL and the in-sidebar filter still matches
// the full owner-qualified name.
test.describe('sidebar short type labels', () => {
  async function openSidebar(page: Page) {
    await page.goto(TOPIC_PAGE);
    await expect(page.locator('.api-sidebar-nav')).toBeVisible();
  }

  function filterInput(page: Page) {
    return page.getByRole('textbox', { name: 'Filter API symbols in the sidebar' });
  }

  test('nested types display only the last FQN segment, keeping the canonical link', async ({ page }) => {
    await openSidebar(page);

    // Typing the OWNER prefix must still surface the nested entries:
    // filter matching uses the full canonical name, not the short label.
    await filterInput(page).fill('CfnTopic.Subscription');

    const entry = page.locator(
      '.api-sidebar a.api-sidebar-link[href$=".aws_sns.CfnTopic.SubscriptionProperty"]',
    );
    await expect(entry).toBeVisible();

    // Display is the bare type name — no `CfnTopic.` prefix.
    await expect(entry).toHaveText('SubscriptionProperty');

    // The accessible name keeps the full owner-qualified FQN: the short
    // visible text is compensated by `title` + `aria-label` on the link.
    await expect(entry).toHaveAttribute('title', 'CfnTopic.SubscriptionProperty');
    await expect(entry).toHaveAttribute('aria-label', 'CfnTopic.SubscriptionProperty');

    // Identity preserved: the unchanged canonical URL resolves (the
    // fixture keeps the full aws-sns page tree).
    await entry.click();
    await expect(page).toHaveURL(/aws_sns\.CfnTopic\.SubscriptionProperty/);
    await expect(page.locator('h1').first()).toContainText('SubscriptionProperty');
  });

  test('non-nested types keep their full displayed name', async ({ page }) => {
    await openSidebar(page);
    await filterInput(page).fill('CfnTopicPolicy');

    const entry = page.locator(
      '.api-sidebar a.api-sidebar-link[href$=".aws_sns.CfnTopicPolicy"]',
    );
    await expect(entry).toBeVisible();
    // The NAME element, since an L1 construct's link also carries its level
    // tag; the point here is the name is not shortened.
    await expect(entry.locator('.api-sidebar-name')).toHaveText('CfnTopicPolicy');

    // No shortening happened, so no compensating `title` either.
    await expect(entry).not.toHaveAttribute('title');
    // It does carry an aria-label, but for the level rather than the
    // owner qualifier — the name itself is unabbreviated, and
    // the level is appended, so nothing here is compensating for a
    // shortened display.
    await expect(entry).toHaveAttribute('aria-label', 'CfnTopicPolicy (L1 construct)');
  });
});
