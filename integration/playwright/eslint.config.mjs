import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';
import { sonarParityRules, sonarParityTestRules } from '../../eslint.sonar-parity.mjs';

const TEST_FILES = ['tests/**/*.spec.ts', 'tests/**/*.setup.ts'];
const typeInformation = {
  parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
};

export default defineConfig([
  {
    files: ['**/*.{js,mjs,ts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node },
  },
  pluginPrettierRecommended,
  tseslint.configs.recommended,
  {
    // Playwright reads fixture dependencies from a destructured first parameter, even an empty one.
    rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] },
  },
  {
    files: ['**/*.ts'],
    ignores: TEST_FILES,
    plugins: { sonarjs, unicorn },
    languageOptions: typeInformation,
    rules: { ...sonarjs.configs.recommended.rules, ...sonarParityRules },
  },
  { files: TEST_FILES, languageOptions: typeInformation, rules: sonarParityTestRules },
  globalIgnores(['node_modules', 'playwright-report', 'test-results', 'blob-report']),
]);
