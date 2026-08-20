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
        // 'bundler', not 'node'. TypeScript 6 deprecated `moduleResolution: node10`
        // (which is what 'node' resolves to) into a hard TS5107 error, so every suite
        // fails to compile under TS 6 with the old value. 'bundler' matches how this
        // code is actually consumed — esbuild bundles it — and resolves package.json
        // "imports" subpaths the same way tsconfig.json already does.
        moduleResolution: 'bundler',
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
  // Coverage ratchet: floor thresholds to prevent regression.
  // Baseline measured 2026-02-24: stmts 37.8%, branches 31.5%, funcs 42.0%, lines 38.3%
  // Target: 80% (see plans/reference/technical-debt/test-modernization-roadmap.md)
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 29,
      functions: 40,
      lines: 36
    }
  },
  testTimeout: 30000,
  verbose: true,
  maxWorkers: 1,
  // Essential for ES modules with Jest
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  // Handle ES module imports properly - map .js imports to TypeScript files and preserve ES modules
  moduleNameMapper: {
    // Subpath imports (package.json "imports"). Jest resolves the `imports` field, but the
    // mapped target keeps the NodeNext `.js` extension while the file on disk is `.ts` —
    // the same reason the relative-import rule below exists. Mapping here strips both the
    // prefix and the extension in one step.
    '^#shared/(.*)\\.js$': '<rootDir>/src/shared/$1',
    '^#infra/(.*)\\.js$': '<rootDir>/src/infra/$1',
    '^#engine/(.*)\\.js$': '<rootDir>/src/engine/$1',
    '^#modules/(.*)\\.js$': '<rootDir>/src/modules/$1',
    '^#mcp/(.*)\\.js$': '<rootDir>/src/mcp/$1',
    '^#runtime/(.*)\\.js$': '<rootDir>/src/runtime/$1',
    '^#cli-shared/(.*)\\.js$': '<rootDir>/src/cli-shared/$1',
    '^(?:\\.{1,2}/)+dist/(.*)\\.js$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // node:sqlite is an unflagged Node.js built-in at the server floor (>=22.13.0);
    // shim for Jest's module resolver
    '^node:sqlite$': '<rootDir>/tests/helpers/node-sqlite-shim.cjs'
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
