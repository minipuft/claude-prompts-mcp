/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          target: 'es2020',
          moduleResolution: 'node',
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  // The alias targets are server source, where a NodeNext `.js` specifier names a `.ts` file on
  // disk. Each alias strips the extension in the same step, as the server's `#alias` mappings do,
  // or jest looks for a `.js` file that does not exist. The `#` rule covers the server's own
  // subpath imports (`server/package.json` "imports"), which server source reached through
  // `@cli-shared` uses; esbuild resolves those from that file, jest needs them spelled out.
  moduleNameMapper: {
    '^@cli-shared/(.*)\\.js$': '<rootDir>/../server/src/cli-shared/$1',
    '^@shared/(.*)\\.js$': '<rootDir>/../server/src/shared/$1',
    '^@engine/(.*)\\.js$': '<rootDir>/../server/src/engine/$1',
    '^@modules/(.*)\\.js$': '<rootDir>/../server/src/modules/$1',
    '^#(shared|infra|engine|modules|mcp|runtime|cli-shared)/(.*)\\.js$':
      '<rootDir>/../server/src/$1/$2',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  testTimeout: 15000,
  verbose: true,
};
