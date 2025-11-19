/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '<rootDir>/tests/**/*.test.ts'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'], // Re-enabled with working ES module support
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'esnext',
        target: 'es2020',
        moduleResolution: 'node',
        allowSyntheticDefaultImports: true,
        esModuleInterop: true
      }
    }]
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: 30000,
  verbose: true,
  maxWorkers: 1,
  // Essential for ES modules with Jest
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  // Handle ES module imports properly - map .js imports to TypeScript files and preserve ES modules
  moduleNameMapper: {
    '^(?:\\.{1,2}/)+dist/(.*)\\.js$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  // Transform ES modules from node_modules if needed
  transformIgnorePatterns: [
    'node_modules/(?!(@modelcontextprotocol)/)'
  ],
  // Support for dynamic imports and ES modules
  testPathIgnorePatterns: [
    '/node_modules/'
  ]
};
