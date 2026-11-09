import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import json from '@eslint/json';
import pluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';
import { sonarParityRules, sonarParityTestRules } from '../eslint.sonar-parity.mjs';

const TEST_FILES = ['tests/**/*.test.ts'];
const typeInformation = {
  parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
};

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node },
  },
  pluginPrettierRecommended,
  tseslint.configs.recommended,
  { files: ['**/*.json'], plugins: { json }, language: 'json/json', extends: ['json/recommended'] },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    ignores: TEST_FILES,
    plugins: { sonarjs, unicorn },
    languageOptions: typeInformation,
    rules: { ...sonarjs.configs.recommended.rules, ...sonarParityRules },
  },
  { files: TEST_FILES, languageOptions: typeInformation, rules: sonarParityTestRules },
  {
    // Sonar Way thresholds; after the recommended set so these settings win.
    files: ['**/*.{ts,mts,cts}'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      // S3358: ternary operators should not be nested.
      'sonarjs/no-nested-conditional': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Test files legitimately repeat fixture literals; keep no-duplicate-string for source only.
      'sonarjs/no-duplicate-string': 'off',
      'max-nested-callbacks': ['error', { max: 4 }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="describe"] CallExpression[callee.name="describe"]',
          message:
            'Nested describe is not allowed. Use a single top-level describe and flat it() only.',
        },
      ],
    },
  },
  globalIgnores(['dist', 'node_modules', 'coverage']),
]);
