import { test, expect } from '../fixtures/form_title';
import type { Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createForm } from '../support/create_form';
import { formSetupFile, type FormSetupData } from '../support/form_setup_data';

async function dragComponentToCanvas(component: Locator, target: Locator) {
  const targetBounds = await target.boundingBox();
  if (!targetBounds) {
    throw new Error('Form builder canvas is not measurable');
  }

  await component.dragTo(target, {
    targetPosition: {
      x: targetBounds.width / 2,
      y: Math.max(1, targetBounds.height - 10),
    },
  });
}

test('Create, edit, search, preview, and publish one form', async ({ page, title }) => {
  test.setTimeout(120_000);

  const workspaceName = await createForm({ page, title });
  const target = page.locator('.builder-components.drag-container');
  await expect(target).toBeVisible({ timeout: 30_000 });

  // Share the workspace selected by this test with user_workspace.spec.ts.
  const data: FormSetupData = { title, workspaceName, formUrl: page.url() };
  await writeFile(formSetupFile, JSON.stringify(data, null, 2));

  const txt_box = page.locator('text=Text Field'); // component from builder palette
  await dragComponentToCanvas(txt_box, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const text_area = page.getByText('Text Area', { exact: true }).first();
  await dragComponentToCanvas(text_area, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const number = page.locator('span[data-group="basic"][data-key="number"][data-type="number"]');
  await dragComponentToCanvas(number, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const password = page.locator(
    'span[data-group="basic"][data-key="password"][data-type="password"]',
  );
  await dragComponentToCanvas(password, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const checkbox = page.locator(
    'span[data-group="basic"][data-key="checkbox"][data-type="checkbox"]',
  );
  await dragComponentToCanvas(checkbox, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const selectboxes = page.locator(
    'span[data-group="basic"][data-key="selectboxes"][data-type="selectboxes"]',
  );
  await dragComponentToCanvas(selectboxes, target);
  await page.locator('a[href="#data"]').click();
  await page.locator('input[name="data[values][0][value]"]').fill('1');
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const select = page.locator('span[data-group="basic"][data-key="select"][data-type="select"]');
  await dragComponentToCanvas(select, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const radio = page.locator('span[data-group="basic"][data-key="radio"][data-type="radio"]');
  await dragComponentToCanvas(radio, target);
  await page.locator('a[href="#data"]').click();
  await page.locator('input[name="data[values][0][value]"]').fill('1');
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const button = page.locator('span[data-group="basic"][data-key="button"][data-type="button"]');
  await dragComponentToCanvas(button, target);
  await page.click('button[ref="saveButton"]');
  await expect(target).toBeVisible();

  const saveButton = page.getByRole('button', {
    name: 'Save',
    exact: true,
  });
  await expect(saveButton).toBeVisible();
  await saveButton.click();
  await expect(page.getByText('Form saved successfully.', { exact: true })).toBeVisible();

  await page.getByTestId('forms-nav').click();

  const searchForms = page.getByTestId('search-forms-text');

  await expect(searchForms).toBeVisible({ timeout: 10000 });
  await searchForms.click();

  await searchForms.getByRole('textbox', { name: 'Search' }).fill(title);

  await page.getByText(title, { exact: true }).click();

  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

  await expect(page.getByText(`Workspace: ${workspaceName}`)).toHaveText(
    `Workspace: ${workspaceName}`,
  );

  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await expect(page.getByRole('heading', { name: /Form Preview chefs2-/ })).toBeVisible();

  await expect(page.locator('input[name="data[textField]"]')).toBeVisible();
  await expect(page.locator('input[name="data[number]"]')).toBeVisible();
  await expect(page.locator('input[name="data[checkbox]"]')).toBeVisible();

  await page.getByRole('button', { name: 'Close Preview', exact: true }).click();

  const publishButton = page.getByRole('button', {
    name: 'Publish',
    exact: true,
  });

  await expect(publishButton).toBeVisible();
  await publishButton.click();

  await expect(page.getByText('Form published successfully!', { exact: true })).toBeVisible();

  const publishedNotice = page.getByTestId('page-notice-published-version');
  await expect(publishedNotice).toBeVisible();
  await expect(publishedNotice).toContainText('Published Version:');
  await expect(publishedNotice).toContainText(
    'This version is published and cannot be modified directly.',
  );
  //Publish button should be disabled after publishing the form
  await expect(publishButton).toBeDisabled();
  // Check that all the tabs are visible after publishing the form
  await expect(page.getByTestId('settings-tab')).toBeVisible();
  await expect(page.getByTestId('version-tab')).toBeVisible();
  await expect(page.getByTestId('team-tab')).toBeVisible();
  await expect(page.getByTestId('submission-tab')).toBeVisible();
  await expect(page.getByTestId('share-tab')).toBeVisible();
});
