import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'node:path';

// Load .env
dotenv.config({ path: path.resolve(__dirname, '.env') });

const depEnv = process.env.DEP_ENV || 'dev';
const authFile = path.resolve(__dirname, 'support', 'user.json');

function getExpectedURL(depEnv: string): string {
  // PR environments: DEP_ENV is a PR number
  if (/^\d+$/.test(depEnv)) {
    const prNumber = Number(depEnv);
    return `https://soba-dev.apps.gold.devops.gov.bc.ca/designer-${prNumber}/en`;
  }

  switch (depEnv.toLowerCase()) {
    case 'dev':
      return 'https://soba-dev.apps.gold.devops.gov.bc.ca/designer/en';

    case 'test':
      return 'https://soba-test.apps.gold.devops.gov.bc.ca/designer/en';

    default:
      throw new Error(`Invalid DEP_ENV: ${depEnv}`);
  }
}

const resolvedBaseURL = process.env.BASE_URL || getExpectedURL(depEnv);
const BASE_URL = resolvedBaseURL;

console.log(`DEP_ENV: ${depEnv}`);
console.log(`Playwright Base URL: ${BASE_URL}`);

export default defineConfig({
  testDir: './tests',

  fullyParallel: false,
  workers: 1,

  use: {
    baseURL: BASE_URL,

    headless: true,

    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',

    ignoreHTTPSErrors: true,
  },

  reporter: [['html', { open: 'never' }]],

  outputDir: 'test-results',

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        headless: true,
      },
    },

    {
      name: 'form-creation',
      testMatch: /form_creation\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },

    {
      name: 'form-management',
      testMatch: /user_form_mangement\.spec\.ts$/,
      dependencies: ['form-creation'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },

    // Other E2E tests use the authenticated session and the shared form.
    {
      name: 'chromium',
      testIgnore: [
        /\.setup\.ts$/,
        /form_creation\.spec\.ts$/,
        /user_form_mangement\.spec\.ts$/,
        /user_form_submission\.spec\.ts$/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        headless: true,
        storageState: authFile,
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
        ignoreHTTPSErrors: true,
      },
      dependencies: ['form-creation'],
    },
    {
      name: 'form-submission',
      testMatch: /user_form_submission\.spec\.ts$/,
      dependencies: ['form-management'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
    },
  ],
});
