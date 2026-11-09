/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  verbose: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Type-checking is handled by `pnpm type-check`; skip during tests to cut memory.
        diagnostics: false,
      },
    ],
  },
  rootDir: __dirname,
};
