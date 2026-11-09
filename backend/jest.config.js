/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  verbose: true,
  transform: {
    '^.+\\.[jt]sx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        // Type-checking is handled by `pnpm type-check`; skip during tests to cut memory.
        diagnostics: false,
      },
    ],
  },
  // Serial execution (--runInBand in package.json scripts) avoids SIGKILL in the 4GB devcontainer.
  // pnpm stores deps under node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>.
  // Keep most node_modules ignored, but allow transforming uuid (ESM package).
  transformIgnorePatterns: [
    String.raw`node_modules/(?!\.pnpm|uuid/)`,
    'node_modules/.pnpm/(?!(uuid)@)',
  ],
  rootDir: __dirname,
};
