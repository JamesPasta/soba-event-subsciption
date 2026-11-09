import { test, expect } from '../fixtures/form_setup';
import dictionaries from '../../../frontend/dictionaries/en.json';

test('User can submit the shared form and find it in My Submissions', async ({
  page,
  title,
  submissionUrl,
}) => {
  await page.goto(submissionUrl);
  await expect(page.getByTestId('user-dropdown')).toBeVisible();

  const form = page.getByTestId('submission-fill');
  await expect(form).toBeVisible();
  const answer = `Submission for ${title}`;
  await form.locator('input[name="data[textField]"]').fill(answer);
  await form.locator('textarea[name="data[textArea]"]').fill('Automated form submission.');
  await form.locator('input[name="data[number]"]').fill('42');
  await form.locator('input[name="data[password]"]').fill('Test-only-password-42');
  await form.locator('input[name="data[checkbox]"]').check();
  await form.locator('input[type="radio"][value="1"]').check();
  await form.locator('button[name="data[submit]"]').click();

  await expect(page).toHaveURL(/\/submission\/[^/]+\/success(?:\?|$)/);
  const success = page.getByTestId('submission-success');
  await expect(success).toContainText(dictionaries.submission.success.message);
  await expect(success.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const confirmation = success.getByTestId('submission-view-confirmation').locator('strong');
  await expect(confirmation).not.toBeEmpty();
  const confirmationCode = (await confirmation.innerText()).trim();
  const submissionId = new URL(page.url()).pathname.split('/').slice(-2)[0];
  await expect(success.getByTestId('submission-view-status')).toHaveText(
    dictionaries.mySubmissions.states.submitted,
  );

  const mySubmissionsNav = page.getByTestId('my-submissions-nav');
  await expect(mySubmissionsNav).toBeVisible();
  await mySubmissionsNav.click();
  await expect(page).toHaveURL(/\/my-submissions(?:\?|$)/);
  await expect(
    page.getByRole('heading', { name: dictionaries.general.mySubmissions, exact: true }),
  ).toBeVisible();
  await page.getByTestId('my-submissions-clear-filters').click();
  await page.getByTestId('search-my-submissions-text').getByRole('textbox').fill(title);
  await page.getByTestId('search-my-submissions-button').click();

  const submissionsTable = page.getByRole('table', {
    name: dictionaries.general.mySubmissions,
    exact: true,
  });
  const submissionRow = submissionsTable.getByRole('row').filter({
    has: page.getByTestId(`${submissionId}-confirmation-id`),
  });
  await expect(submissionRow).toBeVisible();
  await expect(submissionRow.getByTestId(`my-submission-link-${submissionId}`)).toHaveText(title);
  await expect(submissionRow.getByTestId(`${submissionId}-confirmation-id`)).toHaveText(
    confirmationCode,
  );
  await expect(submissionRow.getByTestId(`${submissionId}-status`)).toHaveText(
    dictionaries.mySubmissions.states.submitted,
  );
  await submissionRow.getByTestId(`${submissionId}-view`).click();
  await expect(page).toHaveURL(new RegExp(`/submission/${submissionId}$`));
  await expect(page.getByTestId('submission-view-confirmation')).toContainText(confirmationCode);
  await expect(
    page.getByTestId('submission-view-form').locator('input[name="data[textField]"]'),
  ).toHaveValue(answer);
});
