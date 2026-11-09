import path from 'path';
import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';

let unauthenticatedPage: Page;
let authenticatedPage: Page;

test.describe.serial('Landing page tests', () => {
  test.beforeAll(async ({ browser }) => {
    const authFile = path.resolve(__dirname, '../support/user.json');

    const authenticatedContext = await browser.newContext({
      storageState: authFile,
    });
    authenticatedPage = await authenticatedContext.newPage();

    const guestContext = await browser.newContext();
    unauthenticatedPage = await guestContext.newPage();
  });

  test.afterAll(async () => {
    await authenticatedPage.context().close();
    await unauthenticatedPage.context().close();
  });

  test('Checks the login functionality', async () => {
    await unauthenticatedPage.goto('');
    await expect(unauthenticatedPage.locator('[data-testid="login-button"]')).toBeVisible();
    await expect(unauthenticatedPage.locator('[data-testid="user-dropdown"]')).not.toBeVisible();
  });

  test('Checks the navigation links', async () => {
    await authenticatedPage.goto('');
    // The SideNav is always visible for authenticated users (no menu toggle).
    await expect(authenticatedPage.locator('[data-testid="forms-nav"]')).toBeVisible();
    await expect(authenticatedPage.locator('[data-testid="feedback-nav"]')).toBeVisible();
    await expect(authenticatedPage.locator('[data-testid="help-nav"]')).toBeVisible();
  });
});
