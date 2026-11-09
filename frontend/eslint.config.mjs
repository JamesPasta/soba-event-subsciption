import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { sonarParityRules, sonarParityTestRules } from '../eslint.sonar-parity.mjs';

const TEST_FILES = ['**/*.test.{ts,tsx}'];
const typeInformation = {
  parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
};

const RESOURCE_HOOKS_MESSAGE =
  'Read and write data through a resource hook (src/shared/api or a feature data/ folder), not this module directly.';

// SWR, the fetch helper and the API clients are the data layer's own tools. Components reach data
// through resource hooks so the fetch/cache/store mechanism can change without touching them.
const DATA_ACCESS_PATTERNS = [
  { group: ['swr', 'swr/*'], message: RESOURCE_HOOKS_MESSAGE },
  {
    group: ['**/shared/api/useAuthedSWR', '**/shared/api/sobaFetch', '**/shared/api/sobaApi*'],
    message: RESOURCE_HOOKS_MESSAGE,
  },
];

const DESIGN_SYSTEM_PATH = {
  name: '@bcgov/design-system-react-components',
  message: 'Server Components cannot import the design system. Use a client wrapper component.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    // Per-variant dev-server build dirs (NEXT_DIST_DIR).
    '.next-designer/**',
    '.next-forms/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Generated ESLint bulk-suppressions baseline; not hand-edited, so don't lint it.
    'eslint-suppressions.json',
  ]),
  {
    files: ['**/*.{ts,tsx,mts}'],
    ignores: TEST_FILES,
    plugins: { sonarjs, unicorn },
    languageOptions: typeInformation,
    rules: {
      ...sonarjs.configs.recommended.rules,
      ...sonarParityRules,
      'react/no-unused-prop-types': 'error',
    },
  },
  { files: TEST_FILES, languageOptions: typeInformation, rules: sonarParityTestRules },
  // Disallow console in app code. Error logging goes through useNotificationStore's
  // `consoleError` option (the single sanctioned logging sink).
  {
    plugins: { sonarjs },
    rules: {
      'no-console': 'error',
      // Sonar Way thresholds; after the recommended set so these settings win.
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      // S3358: ternary operators should not be nested.
      'sonarjs/no-nested-conditional': 'error',
    },
  },
  // Keep the data layer behind resource hooks everywhere in the app graph.
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: DATA_ACCESS_PATTERNS }],
    },
  },
  // Route files are Server Components. The design system is built on React Aria, so importing it
  // here pulls createContext into the server graph and the route 500s at runtime - which nothing
  // else in the toolchain catches. Reach it through a client wrapper instead (see SecondaryText).
  // Options replace rather than merge, so the data-access patterns are repeated here to keep them.
  {
    files: ['app/**/page.tsx', 'app/**/layout.tsx', 'app/**/template.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [DESIGN_SYSTEM_PATH], patterns: DATA_ACCESS_PATTERNS },
      ],
    },
  },
  // The data layer itself: resource hooks, the fetch helper and the API clients live here.
  {
    files: ['src/shared/api/**', 'src/features/*/data/**', 'src/app/providers/AppProviders.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Tests and test/build config legitimately use/wrap console and repeat fixture literals.
  {
    files: ['tests/**', '**/*.test.{ts,tsx}', 'vitest.setup.ts', 'vitest.config.ts'],
    rules: {
      'no-console': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
]);

export default eslintConfig;
