import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import claudePlugin from './eslint-rules/claude-plugin.js';

const lifecycleAnnotationTargets = [
  'src/engine/**/*.ts',
  'src/modules/**/*.ts',
  'src/runtime/**/*.ts',
  'src/infra/**/*.ts',
  'src/mcp/**/*.ts',
  'src/shared/utils/**/*.ts',
  'src/shared/types/**/*.ts',
  'src/shared/core/**/*.ts',
  'src/types.ts',
];

export default [
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript files configuration (source files)
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin,
      prettier: prettierPlugin,
      claude: claudePlugin,
      sonarjs: sonarjs,
    },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Import rules
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
            'object',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-cycle': 'error',
      'import/newline-after-import': 'error',

      // General rules - warn on all console usage, use EnhancedLogger instead
      'no-console': 'warn',

      // Complexity enforcement (PRIMARY quality gate — ratcheted)
      'sonarjs/cognitive-complexity': ['warn', 15],
      complexity: ['warn', 10],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 4],
      // File-level line count (ADVISORY — secondary signal)
      'max-lines': ['warn', { max: 1000, skipBlankLines: true, skipComments: true }],

      // Prettier integration
      'prettier/prettier': 'error',

      // Disable rules that conflict with TypeScript
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Lifecycle guardrails - deprecated import paths
      'claude/no-legacy-imports': [
        'error',
        {
          patterns: [
            // Generic legacy patterns
            'legacy/',
            '/legacy/',
            '@legacy/',
            'legacy-',
            // Deleted parser files (now in command-parser.ts and symbolic-operator-parser.ts)
            'symbolic-command-parser',
            'unified-command-parser',
            // Deleted TypeScript framework guides (now YAML under resources/frameworks/).
            // The directory was `frameworks/methodology/guides/` before the pass-4 rename;
            // both spellings stay banned so neither path can come back.
            { type: 'regex', value: 'frameworks/(methodology|definitions)/guides/.*-guide' },
          ],
        },
      ],
      // Prefer execution context barrel imports (non-blocking)
      'claude/no-context-deep-imports': [
        'warn',
        {
          allowInternal: true,
        },
      ],
      // Block legacy executor symbols that should no longer exist
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='ChainExecutor']",
          message: 'ChainExecutor is deprecated. Use PromptExecutionPipeline instead.',
        },
        {
          selector: "Identifier[name='ConsolidatedPromptEngine']",
          message: 'ConsolidatedPromptEngine is deprecated. Use PromptExecutionPipeline instead.',
        },
      ],
    },
  },

  // TypeScript test files configuration
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.test.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin,
      prettier: prettierPlugin,
      claude: claudePlugin,
      sonarjs: sonarjs,
    },
    rules: {
      // Use same rules as source files
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling'],
            'index',
            'object',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-cycle': 'error',
      'import/newline-after-import': 'error',
      // Complexity enforcement (relaxed for tests)
      'sonarjs/cognitive-complexity': ['warn', 20],
      complexity: ['warn', 15],
      'max-depth': ['warn', 5],
      'max-params': ['warn', 5],

      // Test files also use EnhancedLogger
      'no-console': 'warn',
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Lifecycle guardrails - deprecated import paths (same as source files)
      'claude/no-legacy-imports': [
        'error',
        {
          patterns: [
            'legacy/',
            '/legacy/',
            '@legacy/',
            'legacy-',
            'symbolic-command-parser',
            'unified-command-parser',
            { type: 'regex', value: 'frameworks/(methodology|definitions)/guides/.*-guide' },
          ],
        },
      ],
      // Prefer execution context barrel imports (non-blocking)
      'claude/no-context-deep-imports': [
        'warn',
        {
          allowInternal: true,
        },
      ],
      // Block legacy executor symbols
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='ChainExecutor']",
          message: 'ChainExecutor is deprecated. Use PromptExecutionPipeline instead.',
        },
        {
          selector: "Identifier[name='ConsolidatedPromptEngine']",
          message: 'ConsolidatedPromptEngine is deprecated. Use PromptExecutionPipeline instead.',
        },
      ],
    },
  },

  // Prettier config (disables conflicting rules)
  prettierConfig,

  // Console usage exemptions - early startup files where logger is not available yet
  {
    files: [
      'src/index.ts', // Main entry point - early startup before logger initialization
      'src/runtime/startup.ts', // Rollback mechanism and critical diagnostics
      'src/infra/logging/index.ts', // Logger implementation - fallback console for error cases
    ],
    rules: {
      // Allow console usage in these files for early startup and critical diagnostics
      // All other files must use EnhancedLogger
      'no-console': 'off',
    },
  },

  // Lifecycle annotations required for guarded runtime files
  {
    files: lifecycleAnnotationTargets,
    ignores: ['src/**/_generated/**'],
    plugins: {
      claude: claudePlugin,
    },
    rules: {
      'claude/require-file-lifecycle': [
        'error',
        {
          allowedStatuses: ['canonical', 'migrating'],
          requireDescription: true,
        },
      ],
    },
  },

  // Scripts configuration (Node.js environment)
  {
    files: ['scripts/**/*.js', 'scripts/**/*.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'tests/**',
      'temp/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ],
  },
];
