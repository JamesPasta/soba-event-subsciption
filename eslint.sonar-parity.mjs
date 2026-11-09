// ESLint equivalents of SonarCloud rules. Spread after the sonarjs recommended rules in a block that
// registers the sonarjs and unicorn plugins and has type information.
export const sonarParityRules = {
  // SonarCloud analyzes without dependency types, so it never raises this one.
  'sonarjs/deprecation': 'off',
  // Not active in the project's SonarCloud profile.
  'sonarjs/function-return-type': 'off',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/prefer-optional-chain': 'error',
  '@typescript-eslint/require-await': 'error',
  'no-await-in-loop': 'error',
  'unicorn/prefer-array-find': 'error',
  'unicorn/prefer-export-from': ['error', { checkUsedVariables: false }],
  'unicorn/prefer-native-coercion-functions': 'error',
  'unicorn/prefer-node-protocol': 'error',
  'unicorn/prefer-number-properties': 'error',
  'unicorn/prefer-set-has': 'error',
  'unicorn/prefer-string-raw': 'error',
  'unicorn/prefer-structured-clone': 'error',
  'unicorn/prefer-type-error': 'error',
};

// Test files get the one rule that catches a test passing without running its assertions.
export const sonarParityTestRules = {
  '@typescript-eslint/no-floating-promises': 'error',
};
