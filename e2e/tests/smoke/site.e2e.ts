// The public pages answer and say what they should, in both languages.
// Read-only: the local build runs against the live database.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('the home page greets a first visit in English', async ({ app, browser }) => {
  await app.open('/');
  await expect(browser.locator('html')).toHaveAttribute('lang', 'en');
  await expect(browser.locator('h1')).toContainText(
    'Welcome to the Chinese American Association of Central Illinois',
  );
});

test('the Chinese home page lives under /zh/', async ({ app, browser }) => {
  await app.open('/zh/');
  await expect(browser.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(browser.locator('h1')).toContainText('伊利诺伊中部华人协会');
});

test('the language pill switches English to Chinese', async ({ app, browser }) => {
  await app.open('/');
  await browser.locator('header button[title="Switch Language / 切换语言"]').click();
  await expect(browser).toHaveURL(/\/zh\/$/);
  await expect(browser.locator('h1')).toContainText('伊利诺伊中部华人协会');
});

test('the membership page lists every tier', async ({ app, screen }) => {
  await app.open('/membership/');
  await expect(
    screen.getByRole('heading', { name: 'Membership Tiers & Annual Dues' }),
  ).toBeVisible();
  for (const tier of ['Free', 'Student', 'Individual', 'Family', 'Business']) {
    await expect(screen.getByRole('heading', { name: `${tier} Membership` })).toBeVisible();
  }
});

test('the events page opens', async ({ app, screen }) => {
  await app.open('/events/');
  await expect(
    screen.getByRole('heading', { name: 'Events & Community Happenings' }),
  ).toBeVisible();
});

test('the account page sends a signed-out visitor to Log In', async ({ app, browser }) => {
  await app.open('/account/');
  await expect(browser).toHaveTitle(/^Login \|/);
});

test('an unknown address says the page was not found', async ({ app, screen }) => {
  await app.open('/no-such-page-e2e/');
  await expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
