/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ============================================
    // ARCHITECTURE BOUNDARIES
    // ============================================
    {
      name: 'methodology-via-loader-only',
      comment: 'Methodology YAML files should only be accessed via RuntimeMethodologyLoader.',
      severity: 'warn',
      from: {
        pathNot: [
          'src/frameworks/methodology/runtime-methodology-loader\\.ts$',
          'src/frameworks/methodology/methodology-hot-reload\\.ts$',
        ],
      },
      to: {
        path: 'methodologies/',
      },
    },
    {
      name: 'no-runtime-state-direct-access',
      comment: 'Runtime state should be accessed via managers, not directly.',
      severity: 'warn',
      from: {
        pathNot: [
          'src/chain-session/manager\\.ts$',
          'src/frameworks/framework-state-manager\\.ts$',
          'src/gates/gate-state-manager\\.ts$',
        ],
      },
      to: {
        path: 'runtime-state/',
      },
    },

    // ============================================
    // DOMAIN DECOUPLING
    // ============================================
    {
      name: 'no-frameworks-in-gates',
      comment: 'Gates domain should not depend on Frameworks domain.',
      severity: 'error',
      from: {
        path: '^src/gates/',
      },
      to: {
        path: '^src/frameworks/',
      },
    },
    {
      name: 'no-gates-in-frameworks',
      comment: 'Frameworks domain should not depend on Gates domain.',
      severity: 'error',
      from: {
        path: '^src/frameworks/',
      },
      to: {
        path: '^src/gates/',
      },
    },

    // ============================================
    // CIRCULAR DEPENDENCY PREVENTION
    // ============================================
    {
      name: 'no-circular',
      comment: 'Circular dependencies create maintenance issues.',
      severity: 'warn',
      from: {},
      to: {
        circular: true,
      },
    },

    // ============================================
    // LAYER VIOLATIONS
    // ============================================
    {
      name: 'no-mcp-tools-to-execution-internals',
      comment: 'MCP tools should use the execution pipeline, not internal execution modules.',
      severity: 'warn',
      from: {
        path: 'src/mcp-tools/',
      },
      to: {
        path: 'src/execution/pipeline/stages/',
        pathNot: 'index\\.ts$',
      },
    },

    // ============================================
    // STANDARD RULES
    // ============================================
    {
      name: 'no-orphans',
      comment: 'Orphan modules should be removed or integrated.',
      severity: 'info',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.test\\.ts$',
          'index\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-non-package-json',
      comment: 'Do not depend on modules outside package.json.',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'],
      },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Production code should not import devDependencies.',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '\\.test\\.ts$',
      },
      to: {
        dependencyTypes: ['npm-dev'],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', 'dist', 'coverage'],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
};
