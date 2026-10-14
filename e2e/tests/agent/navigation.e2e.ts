// Agent steps: a goal in plain words, checked with a locator afterwards so the
// replay cache can record it. Needs ANTHROPIC_API_KEY. Read-only, like the
// smoke suite: never sign up, submit a form or start a checkout here.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('a visitor finds the student dues from the home page', async ({ app, agent, browser }) => {
  await app.open('/');

  await agent.act('open the membership page from the top navigation');
  await expect(browser).toHaveURL(/\/membership\/$/);

  await agent.assert('the page shows a yearly price for Student Membership');
});

test('a Chinese reader reaches the events page in Chinese', async ({ app, agent, browser }) => {
  await app.open('/zh/');

  await agent.act('open the upcoming events page from the top navigation');
  await expect(browser).toHaveURL(/\/zh\/events\/$/);
  await expect(browser.locator('html')).toHaveAttribute('lang', 'zh-CN');
});
