# Integration Tests

Playwright tests cover SOBA login, form creation and publishing, accessibility, navigation,
and workspace management. `integration/playwright` is a standalone npm project with its
own lockfile; it is not part of the root pnpm workspace or the root test command.

## Local setup

Use Node.js and npm (the devcontainer uses Node.js 24). Run these commands from the
repository root:

```sh
cd integration/playwright
npm ci
npx playwright install chromium
```

The devcontainer already includes the Linux browser runtime libraries. On Linux outside
the devcontainer, install those libraries along with the browser:

```sh
npx playwright install --with-deps chromium
```

Rerun the browser install after updating Playwright if it reports a missing browser executable.

## Environment configuration

Create `integration/playwright/.env` from `.env.example`. From `integration/playwright`:

```sh
# macOS / Linux / devcontainer
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Fill in the values for your test account:

```dotenv
DEP_ENV=test
BASE_URL=
KEYCLOAK_USERNAME=your-idir-email@example.com
KEYCLOAK_PASSWORD="your-password"
MFA_CODE=your-totp-secret
```

| Variable | Purpose |
| --- | --- |
| `DEP_ENV` | Target environment: `dev`, `test`, or a PR number such as `61`. Defaults to `dev` when unset. |
| `BASE_URL` | Optional full frontend URL, including the locale path. Overrides the URL derived from `DEP_ENV`. Leave empty to use the environment URL below. |
| `KEYCLOAK_USERNAME` | Email used by the automated IDIR - MFA login. |
| `KEYCLOAK_PASSWORD` | Password for that account. Quote values containing spaces or `#`. |
| `MFA_CODE` | TOTP setup secret for that account, used to generate the MFA code during login. This is the secret key, not a current six-digit code. |

The configured environment URLs are:

| `DEP_ENV` | Frontend URL |
| --- | --- |
| `dev` | `https://soba-dev.apps.silver.devops.gov.bc.ca/designer/en` |
| `test` | `https://soba-test.apps.silver.devops.gov.bc.ca/designer/en` |
| `61` (example PR) | `https://soba-dev.apps.silver.devops.gov.bc.ca/designer-61/en` |

The suite loads `.env` automatically. Existing shell environment variables take precedence.
For a locally running application, set `BASE_URL` to its full frontend URL and start the
application and its services separately; Playwright does not start them. The application
must support the IDIR - MFA login flow used by these tests. No separate API URL is configured.

Use an account that can create and publish forms and manage the selected workspace, with
an MFA setup that supports TOTP codes. Ensure you can reach the application and login
provider from your machine, including any required VPN access. Keep the machine clock
in sync so the generated MFA codes are valid.

`.env`, the saved authenticated session (`support/user.json`), and shared test data
(`support/form-setup.json`) are gitignored. Do not commit credentials, MFA secrets, or sessions.

## Run tests

From `integration/playwright`, run the entire suite:

```sh
npm test
```

Or run it from the repository root:

```sh
npm --prefix integration/playwright test
```

Tests run headlessly in Chromium with one worker. The project dependencies run authentication
first, then create and publish a form, then run the remaining tests using that session and
form's workspace. The form setup reuses `Team workspace`, creating it when missing (including
after a database reset). First-run default workspace setup uses the same name when the onboarding
dialog appears. The test account must be able to manage that workspace. These tests create forms
and update workspace settings in the selected environment.

The shared test fixture reads the API's `RateLimit` headers and pauses between tests when
fewer than 25 requests remain, until the server's reset time. This prevents a fast suite
from exhausting the API quota and causing session, workspace, or disabled-tab failures.
The wait is reported in the test output.

To run the workspace tests with their setup dependencies, from `integration/playwright`:

```sh
npm test -- user_workspace.spec.ts
```

## Results and troubleshooting

Open the HTML report from `integration/playwright`:

```sh
npx playwright show-report
```

The report is written to `playwright-report/`. Failed tests retain screenshots and videos
in `test-results/`. Traces are captured on the first retry when retries are enabled.

- **Missing browser executable:** run `npx playwright install chromium` in the test directory.
- **Missing environment variables:** fill in all three login values in `.env`.
- **Cannot reach the site:** check the reported base URL, network access, and VPN connection.
- **MFA login fails:** check the account's TOTP secret and the machine clock.
- **Setup fails and other tests do not run:** fix the authentication or form creation failure
  shown in the report; downstream projects depend on those steps.
- **PowerShell blocks `npm.ps1` or `npx.ps1`:** use `npm.cmd` and `npx.cmd` for the same commands.
