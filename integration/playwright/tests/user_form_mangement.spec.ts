import { test, expect } from '../fixtures/form_setup';
import dictionaries from '../../../frontend/dictionaries/en.json';
import { writeFile } from 'node:fs/promises';
import { formSetupFile } from '../support/form_setup_data';

test.beforeEach(async ({ page, baseURL, title, workspaceName }) => {
  if (!baseURL) throw new Error('Playwright baseURL must be configured');
  await page.goto(`${baseURL.replace(/\/$/, '')}/forms`);
  await expect(page).toHaveURL(/\/forms(?:\?|$)/);
  await expect(page.getByRole('table', { name: 'Forms', exact: true })).toBeVisible();

  // Reuse the form name saved by form_creation.spec.ts through the shared fixture.
  const search = page.getByTestId('search-forms-text').getByRole('textbox', { name: 'Search' });
  await search.fill(title);
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(`Workspace: ${workspaceName}`, { exact: true })).toBeVisible();
});

test('User can validate all form settings panels and save its audience', async ({
  page,
  title,
}) => {
  const settingsTab = page.getByTestId('settings-tab');
  await expect(settingsTab).toBeEnabled();
  await settingsTab.click();
  await expect(settingsTab).toHaveAttribute('aria-selected', 'true');

  const formSettingsDrawer = page.getByTestId('accordion-form-settings');
  const formSettingsToggle = formSettingsDrawer.getByRole('button', {
    name: dictionaries.form.settings.formSettingsDrawerLabel,
    exact: true,
  });
  await expect(formSettingsToggle).toBeVisible();
  if ((await formSettingsToggle.getAttribute('aria-expanded')) !== 'true') {
    await formSettingsToggle.click();
  }
  await expect(formSettingsToggle).toHaveAttribute('aria-expanded', 'true');

  const formName = formSettingsDrawer.getByTestId('form-settings-name').getByRole('textbox');
  const description = formSettingsDrawer.getByRole('textbox', {
    name: dictionaries.form.descriptionLabel,
    exact: true,
  });
  await expect(formName).toBeVisible();
  await expect(formName).toHaveValue(title);
  await expect(formName).toBeEditable();
  await expect(formName).toHaveAttribute('required', '');
  await expect(description).toBeVisible();
  await expect(description).toBeEditable();
  await expect(
    formSettingsDrawer.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await expect(
    formSettingsDrawer.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeEnabled();

  await formSettingsToggle.click();
  await expect(formSettingsToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(formName).not.toBeVisible();
  await expect(description).not.toBeVisible();
  await formSettingsToggle.click();
  await expect(formSettingsToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(formName).toHaveValue(title);

  const profileDrawer = page.getByTestId('accordion-form-profile');
  const profileToggle = profileDrawer.getByRole('button', {
    name: dictionaries.form.settings.profileDrawerLabel,
    exact: true,
  });
  await expect(profileToggle).toBeVisible();
  await profileToggle.click();
  await expect(profileToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(formSettingsToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(formName).not.toBeVisible();
  await expect(
    profileDrawer.getByText(dictionaries.form.settings.profileDrawerInfo, { exact: true }),
  ).toBeVisible();
  const organization = profileDrawer.getByTestId('form-profile-org');
  const useCase = profileDrawer.getByTestId('form-profile-use-case');
  for (const field of [organization, useCase]) {
    await expect(field).toBeVisible();
    await expect(field.getByRole('button')).toBeEnabled();
  }
  await expect(profileDrawer.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(profileDrawer.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();

  await profileToggle.click();
  await expect(profileToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(organization).not.toBeVisible();
  await expect(useCase).not.toBeVisible();
  await profileToggle.click();
  await expect(profileToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(organization).toBeVisible();
  await expect(useCase).toBeVisible();

  const audienceDrawer = page.getByTestId('accordion-form-audience');
  const audienceToggle = audienceDrawer.getByRole('button', { name: 'Form Audience', exact: true });
  await expect(audienceToggle).toBeVisible();
  if ((await audienceToggle.getAttribute('aria-expanded')) !== 'true') {
    await audienceToggle.click();
  }
  await expect(audienceToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(profileToggle).toHaveAttribute('aria-expanded', 'false');

  const inheritCheckbox = audienceDrawer.getByRole('checkbox', {
    name: dictionaries.form.settings.inheritWorkspaceLabel,
    exact: true,
  });
  await expect(inheritCheckbox).toBeEnabled();
  await expect(inheritCheckbox).toBeChecked();

  const audienceModes = audienceDrawer.getByRole('radiogroup', {
    name: 'Who can submit',
    exact: true,
  });
  await expect(audienceModes.getByRole('radio')).toHaveCount(3);
  for (const name of ['Public', 'Protected', 'Members only']) {
    const radio = audienceModes.getByRole('radio', { name, exact: true });
    await expect(radio).toBeDisabled();
    await expect(radio).toBeChecked({ checked: name === 'Protected' });
  }

  const allowedLogins = audienceDrawer.getByRole('group', { name: 'Allowed logins', exact: true });
  const loginNames = ['BCeID Business', 'IDIR - MFA'];
  await expect(allowedLogins.getByRole('checkbox')).toHaveCount(loginNames.length);
  for (const name of loginNames) {
    await expect(allowedLogins.getByRole('checkbox', { name, exact: true })).toBeDisabled();
  }
  const saveButton = audienceDrawer.getByRole('button', { name: 'Save', exact: true });
  await expect(saveButton).toBeDisabled();

  await audienceDrawer
    .getByText(dictionaries.form.settings.inheritWorkspaceLabel, { exact: true })
    .click();
  await expect(inheritCheckbox).not.toBeChecked();
  for (const name of loginNames) {
    const checkbox = allowedLogins.getByRole('checkbox', { name, exact: true });
    await expect(checkbox).toBeEnabled();
    if (await checkbox.isChecked()) {
      await allowedLogins.getByText(name, { exact: true }).click();
    }
    await expect(checkbox).not.toBeChecked();
  }
  const loginError = allowedLogins.getByText('Select at least one login.', { exact: true });
  await expect(loginError).toBeVisible();
  await expect(saveButton).toBeDisabled();

  const idirMfaCheckbox = allowedLogins.getByRole('checkbox', { name: 'IDIR - MFA', exact: true });
  await allowedLogins.getByText('IDIR - MFA', { exact: true }).click();
  await expect(idirMfaCheckbox).toBeChecked();
  await expect(loginError).not.toBeVisible();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(
    page.getByText(dictionaries.form.settings.formSettingsDrawerSaveSuccessMessage, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(inheritCheckbox).not.toBeChecked();
  await expect(idirMfaCheckbox).toBeChecked();
  await expect(
    allowedLogins.getByRole('checkbox', { name: 'BCeID Business', exact: true }),
  ).not.toBeChecked();
  await expect(saveButton).toBeDisabled();

  const submitterDrawer = page.getByTestId('accordion-submitter-settings');
  const submitterToggle = submitterDrawer.getByRole('button', {
    name: dictionaries.form.settings.submitterSettingsDrawerLabel,
    exact: true,
  });
  await expect(submitterToggle).toBeVisible();
  await submitterToggle.click();
  await expect(submitterToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(audienceToggle).toHaveAttribute('aria-expanded', 'false');

  const submitterInherit = submitterDrawer.getByRole('checkbox', {
    name: dictionaries.form.settings.inheritWorkspaceLabel,
    exact: true,
  });
  const allowDrafts = submitterDrawer.getByRole('checkbox', {
    name: dictionaries.form.settings.allowSubmitterDraftsLabel,
    exact: true,
  });
  await expect(submitterInherit).toBeChecked();
  await expect(submitterInherit).toBeEnabled();
  await expect(allowDrafts).toBeDisabled();
  const inheritedDrafts = await allowDrafts.isChecked();
  const submitterSave = submitterDrawer.getByRole('button', { name: 'Save', exact: true });
  const submitterCancel = submitterDrawer.getByRole('button', { name: 'Cancel', exact: true });
  await expect(submitterSave).toBeDisabled();
  await expect(submitterCancel).toBeEnabled();

  await submitterDrawer
    .getByText(dictionaries.form.settings.inheritWorkspaceLabel, { exact: true })
    .click();
  await expect(submitterInherit).not.toBeChecked();
  await expect(allowDrafts).toBeEnabled();
  await submitterDrawer
    .getByText(dictionaries.form.settings.allowSubmitterDraftsLabel, { exact: true })
    .click();
  await expect(allowDrafts).toBeChecked({ checked: !inheritedDrafts });
  await expect(submitterSave).toBeEnabled();
  await submitterCancel.click();
  await expect(submitterInherit).toBeChecked();
  await expect(allowDrafts).toBeChecked({ checked: inheritedDrafts });
  await expect(allowDrafts).toBeDisabled();
  await expect(submitterSave).toBeDisabled();

  await submitterToggle.click();
  await expect(submitterToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(submitterInherit).not.toBeVisible();
  await expect(allowDrafts).not.toBeVisible();
  await submitterToggle.click();
  await expect(submitterToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(submitterInherit).toBeChecked();

  const templatesDrawer = page.getByTestId('accordion-document-templates');
  const templatesText = dictionaries.form.templates;
  const templatesToggle = templatesDrawer.getByRole('button', {
    name: templatesText.drawerLabel,
    exact: true,
  });
  await expect(templatesToggle).toBeVisible();
  await templatesToggle.click();
  await expect(templatesToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(submitterToggle).toHaveAttribute('aria-expanded', 'false');

  const templatesTable = templatesDrawer.getByRole('table', {
    name: templatesText.drawerLabel,
    exact: true,
  });
  await expect(templatesTable).toBeVisible();
  for (const name of [
    templatesText.nameColumn,
    templatesText.typeColumn,
    templatesText.versionColumn,
    templatesText.fileColumn,
    templatesText.sizeColumn,
    templatesText.updatedColumn,
    templatesText.actionsColumn,
  ]) {
    await expect(templatesTable.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(templatesTable.getByText(templatesText.empty, { exact: true })).toBeVisible();

  const templateType = templatesDrawer.getByTestId('template-type-select');
  const noTemplateTypes = templatesDrawer.getByTestId('template-no-types');
  await expect(templateType.or(noTemplateTypes)).toBeVisible();
  if (await noTemplateTypes.isVisible()) {
    await expect(noTemplateTypes).toContainText(templatesText.noTypes);
    await expect(templatesDrawer.getByTestId('template-upload-button')).toHaveCount(0);
  } else {
    await expect(templateType.getByRole('button')).toBeEnabled();
    await expect(
      templatesDrawer.getByTestId('template-version-select').getByRole('button'),
    ).toBeEnabled();
    const templateFile = templatesDrawer.getByTestId('template-file-input');
    await expect(templateFile).toBeVisible();
    await expect(templateFile).toBeEnabled();
    await expect(templateFile).toHaveAttribute('type', 'file');
    await expect(templateFile).toHaveValue('');
    const templateName = templatesDrawer.getByTestId('template-name-field').getByRole('textbox');
    await expect(templateName).toBeEditable();
    await expect(templateName).toHaveValue('');
    await expect(templatesDrawer.getByTestId('template-accepted-types')).toBeVisible();
    await expect(templatesDrawer.getByTestId('template-upload-button')).toBeDisabled();
  }

  await templatesToggle.click();
  await expect(templatesToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(templatesTable).not.toBeVisible();
  await templatesToggle.click();
  await expect(templatesToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(templatesTable).toBeVisible();
  await expect(templatesTable.getByText(templatesText.empty, { exact: true })).toBeVisible();
});

test('User can validate version history and open the published version', async ({ page }) => {
  const versionTab = page.getByTestId('version-tab');
  await expect(versionTab).toBeEnabled();
  await versionTab.click();
  await expect(versionTab).toHaveAttribute('aria-selected', 'true');

  const panel = page.getByRole('tabpanel', { name: dictionaries.form.historyTab, exact: true });
  const table = panel.getByRole('table', { name: dictionaries.form.historyTab, exact: true });
  await expect(table).toBeVisible();
  for (const name of [
    dictionaries.general.version,
    dictionaries.form.status,
    dictionaries.submission.formList.columns.createdBy,
    dictionaries.submission.formList.columns.createdAt,
    dictionaries.submission.formList.columns.quickLinks,
  ]) {
    await expect(table.getByRole('columnheader').getByText(name, { exact: true })).toBeVisible();
  }

  const publishedRow = table
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '1', exact: true }) })
    .filter({ has: page.getByText('Published', { exact: true }) });
  await expect(publishedRow).toHaveCount(1);
  await expect(publishedRow.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await expect(publishedRow.locator('[data-testid$="-created-date"]')).not.toBeEmpty();
  await expect(
    publishedRow.getByText(dictionaries.form.newVersionFrom, { exact: true }),
  ).toBeVisible();

  const versionSort = table.getByTestId('datatable-sort-versionNo');
  await expect(versionSort.locator('..')).toHaveAttribute('aria-sort', 'descending');
  await versionSort.click();
  await expect(versionSort.locator('..')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('formVersions.sort') === 'versionNo:asc',
  );
  await expect(publishedRow).toBeVisible();

  await publishedRow.getByText(dictionaries.header.design, { exact: true }).click();
  await expect(page.getByTestId('designer-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('page-notice-published-version')).toBeVisible();
});

test('User can validate the submissions tab for the created form', async ({ page }) => {
  const submissionsTab = page.getByTestId('submission-tab');
  await expect(submissionsTab).toBeEnabled();
  await submissionsTab.click();
  await expect(submissionsTab).toHaveAttribute('aria-selected', 'true');

  const panel = page.getByRole('tabpanel', { name: dictionaries.form.submissionTab, exact: true });
  const table = panel.getByRole('table', {
    name: dictionaries.submission.submissions,
    exact: true,
  });
  await expect(table).toBeVisible();
  for (const name of [
    dictionaries.submission.confirmationId,
    dictionaries.general.version,
    dictionaries.submission.submitter,
    dictionaries.form.status,
    dictionaries.submission.submittedAt,
    dictionaries.submission.actions,
  ]) {
    await expect(table.getByRole('columnheader').getByText(name, { exact: true })).toBeVisible();
  }
  await expect(table.getByText(dictionaries.submission.emptyList, { exact: true })).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(2);

  const dateSort = table.getByTestId('datatable-sort-submittedAt');
  await expect(dateSort.locator('..')).toHaveAttribute('aria-sort', 'descending');
  await dateSort.click();
  await expect(dateSort.locator('..')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('formSubmissions.sort') === 'submittedAt:asc',
  );
  await expect(table.getByText(dictionaries.submission.emptyList, { exact: true })).toBeVisible();
});

test('User can validate the share tab and copy the form link', async ({
  page,
  context,
  title,
  formUrl,
  formSetup,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const shareTab = page.getByTestId('share-tab');
  await expect(shareTab).toBeEnabled();
  await shareTab.click();
  await expect(shareTab).toHaveAttribute('aria-selected', 'true');

  const panel = page.getByRole('tabpanel', { name: dictionaries.form.shareTab, exact: true });
  await expect(panel.getByTestId('share-tab-formName')).toHaveText(title);
  await expect(panel.getByTestId('share-tab-ministryOrOrg')).toContainText(
    dictionaries.form.ministryOrOrg,
  );
  const formId = new URL(formUrl).pathname.split('/').pop();
  const formLink = panel.getByTestId('share-tab-form-link');
  await expect(formLink).toBeVisible();
  await expect(formLink).toContainText(`/en/form/${formId}`);
  const shareUrl = (await formLink.innerText()).trim();
  expect(new URL(shareUrl).protocol).toBe('https:');

  const copyButton = panel.getByTestId('share-tab-copyToClip');
  await expect(copyButton).toBeEnabled();
  await copyButton.click();
  await expect(page.getByText(dictionaries.form.copiedNotification, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
  await writeFile(
    formSetupFile,
    JSON.stringify({ ...formSetup, submissionUrl: shareUrl }, null, 2),
  );
});
