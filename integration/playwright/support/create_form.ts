import { expect, type Page } from '@playwright/test';
import dictionaries from '../../../frontend/dictionaries/en.json';

const WORKSPACE_NAME = 'Team workspace';

async function saveWorkspace(page: Page) {
  await page.getByTestId('workspace-your-org').click();
  await page.getByRole('option', { name: 'Health (HLTH)', exact: true }).click();
  await page.getByTestId('workspace-name').getByRole('textbox').fill(WORKSPACE_NAME);

  await page.getByTestId('workspace-use-case').click();
  await page.getByRole('option', { name: dictionaries.useCases.collection, exact: true }).click();

  const disclaimer = page.getByRole('checkbox', {
    name: dictionaries.workspaces.disclaimerLabel,
    exact: true,
  });
  if (!(await disclaimer.isChecked())) {
    await page.getByText(dictionaries.workspaces.disclaimerLabel, { exact: true }).click();
  }
  await expect(disclaimer).toBeChecked();

  const saveButton = page.getByTestId('workspace-save');
  await expect(saveButton).toBeEnabled({ timeout: 15000 });
  await saveButton.click();
}

async function ensureTeamWorkspace(page: Page) {
  const workspaceNav = page.getByTestId('workspaces-nav');
  await expect(workspaceNav).toBeVisible();
  const href = await workspaceNav.getAttribute('href');
  if (!href) throw new Error('Workspace navigation URL is missing');

  const url = new URL(href, page.url());
  url.searchParams.set('workspaces.q', WORKSPACE_NAME);
  const searchResponse = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      responseUrl.pathname.endsWith('/api/v1/workspaces') &&
      responseUrl.searchParams.get('q') === WORKSPACE_NAME
    );
  });
  await page.goto(url.toString());
  const response = await searchResponse;
  expect(response.ok(), 'Workspace search must succeed before deciding to create one').toBe(true);
  const result: { items: { name: string }[] } = await response.json();

  if (result.items.some((workspace) => workspace.name === WORKSPACE_NAME)) {
    const workspaceRow = page.getByRole('row').filter({
      has: page.getByRole('button', { name: WORKSPACE_NAME, exact: true }),
    });
    await expect(
      workspaceRow.getByRole('button', { name: 'Manage', exact: true }),
      `The test account needs management access to "${WORKSPACE_NAME}"`,
    ).toBeVisible();
    return;
  }

  await page.getByTestId('create-workspace-button').click();
  await saveWorkspace(page);
  await expect(page).toHaveURL(/\/workspaces(?:\?|$)/);
}

export async function createForm({ page, title }: { page: Page; title: string }): Promise<string> {
  await page.goto('');

  const workspaceModal = page.getByRole('dialog', {
    name: /Default Workspace Setup/i,
  });
  const workspaceSetupVisible = await workspaceModal
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(
      () => true,
      () => false,
    );

  if (workspaceSetupVisible) {
    await saveWorkspace(page);
    await expect(workspaceModal).not.toBeVisible({ timeout: 15000 });
    await expect(page.locator('.react-aria-ModalOverlay')).not.toBeVisible({
      timeout: 15000,
    });
  }

  await ensureTeamWorkspace(page);
  await page.getByTestId('forms-nav').click();
  await page.getByTestId('create-form-button').click();

  const createFormDialog = page.getByRole('dialog', { name: 'Create Form' });
  const workspaceSelector = createFormDialog.getByTestId('workspace-select');
  await expect(workspaceSelector).toBeVisible();
  await workspaceSelector.click();

  await page
    .getByRole('listbox', { name: dictionaries.workspaces.workspace })
    .getByRole('option', { name: `${WORKSPACE_NAME} (team)`, exact: true })
    .click();

  await createFormDialog.getByTestId('form-name-modal').getByRole('textbox').fill(title);
  await createFormDialog.getByTestId('save-create-form').click();

  return WORKSPACE_NAME;
}
