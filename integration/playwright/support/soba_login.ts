import { expect, type Page } from '@playwright/test';
import { authenticator } from '@otplib/preset-default';
export function formsettings() {
  if (!process.env.KEYCLOAK_USERNAME || !process.env.KEYCLOAK_PASSWORD || !process.env.MFA_CODE) {
    throw new Error(
      'Missing env variables: KEYCLOAK_USERNAME, KEYCLOAK_PASSWORD, and MFA_CODE are required',
    );
  }

  return {
    depEnv: process.env.DEP_ENV,
    username: process.env.KEYCLOAK_USERNAME,
    password: process.env.KEYCLOAK_PASSWORD,
    mfaCode: process.env.MFA_CODE,
  };
}

export async function login(page: Page) {
  const { username, password, mfaCode } = formsettings();

  await page.getByTestId('login-button').click();

  const idirButton = page.locator('#social-azureidir, a:has-text("IDIR - MFA")').first();
  const bceidButton = page.locator('#social-bceidbusiness, a:has-text("Business BCeID")').first();

  await expect(idirButton).toBeVisible({ timeout: 20000 });
  await expect(bceidButton).toBeVisible({ timeout: 20000 });

  await idirButton.click();
  await page.fill('input[type="email"]', username);
  await page.click('input[type="submit"]');

  // Microsoft may ask which account type to use before showing the password field.
  const passwordInput = page.locator('input[name="passwd"]');
  const workAccount = page.getByRole('button', { name: /^Work or school account/ });
  await expect(passwordInput.or(workAccount)).toBeVisible({ timeout: 20000 });
  if (await workAccount.isVisible()) {
    await workAccount.click();
  }
  await passwordInput.fill(password);
  await page.click('input[type="submit"]');

  authenticator.options = {
    step: 30,
    window: 2,
  };

  const token = authenticator.generate(mfaCode);
  await page.fill('input[name="otc"]', token);
  await page.click('input[type="submit"]');
  await page.locator('#idSIButton9').click();
  await expect(page.locator('[data-testid="user-dropdown"]')).toBeVisible();
}
