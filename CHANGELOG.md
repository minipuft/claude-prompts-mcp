# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.2](https://github.com/minipuft/claude-prompts/compare/v1.3.1...v1.3.2) (2026-01-14)


### Bug Fixes

* **release:** version sync ([#54](https://github.com/minipuft/claude-prompts/issues/54)) ([33f9e85](https://github.com/minipuft/claude-prompts/commit/33f9e85349e38445905d6471742c54910dc9178e))

## [1.3.1](https://github.com/minipuft/claude-prompts/compare/v1.3.0...v1.3.1) (2026-01-14)


### Bug Fixes

* **release:** version sync ([#51](https://github.com/minipuft/claude-prompts/issues/51)) ([6bd6039](https://github.com/minipuft/claude-prompts/commit/6bd6039765edae189fe83ca13f60a8a27a178d73))

## [1.3.0](https://github.com/minipuft/claude-prompts/compare/v1.2.0...v1.3.0) (2026-01-14)


### ⚠ BREAKING CHANGES

* Complete MCP server restructure with new consolidated API

### Features

* add Claude Code plugin for /install-plugin support ([c3b5654](https://github.com/minipuft/claude-prompts/commit/c3b5654aaeea5fec12402a859eb687d1e666caa4))
* add dev:claude script for --plugin-dir workflow ([2a7d6f8](https://github.com/minipuft/claude-prompts/commit/2a7d6f8abeedfb6c6ed6f36becae644ebad6f7d7))
* add marketplace.json for plugin distribution ([bf79fcb](https://github.com/minipuft/claude-prompts/commit/bf79fcb56a38d2829f88e5365a5042494d2eba23))
* add streamable http transport and release automation ([0717f31](https://github.com/minipuft/claude-prompts/commit/0717f31ae503c19824fdd14fb05394197b8b11a9))
* Add symbolic command language and operator executors ([639f86a](https://github.com/minipuft/claude-prompts/commit/639f86a4aeeae925c0b916cffc297d4253c8ed6f))
* **dist:** separate public and private prompts for distribution ([fee7c12](https://github.com/minipuft/claude-prompts/commit/fee7c12e21c5b525501764f74fbff80ace08805a))
* enhance README with interactive prompt management features ([13afaa9](https://github.com/minipuft/claude-prompts/commit/13afaa968bc2330f80a183a71f7eb367dc40c3f6))
* enhance server startup options and help documentation ([f315f33](https://github.com/minipuft/claude-prompts/commit/f315f331cbf1112a5d5163018cfbd0bfc23cd413))
* **gates:** implement intelligent gate selection with 5-level precedence system ([b8e1c11](https://github.com/minipuft/claude-prompts/commit/b8e1c11a3bf8a411f65448812112e7c2555a9c8e))
* **gemini:** add Gemini CLI extension support ([50587c6](https://github.com/minipuft/claude-prompts/commit/50587c61fa922eee5400614bde24ec3bf9103cbe))
* **gemini:** align hooks with Claude plugin infrastructure ([c35e4f0](https://github.com/minipuft/claude-prompts/commit/c35e4f0d678d1bd3c36725f9ede1b7a191bab785))
* **hooks:** auto-regenerate contracts on source change ([9b21afa](https://github.com/minipuft/claude-prompts/commit/9b21afa192cddf42bd43d46a02a9557ee00c4d2b))
* implement enterprise-grade CI/CD pipeline with comprehensive testing framework ([#10](https://github.com/minipuft/claude-prompts/issues/10)) ([25e7f59](https://github.com/minipuft/claude-prompts/commit/25e7f59d41801bc4cc4cb6d01158c262d2064b9a))
* implement Phase 1 - Enhanced Category Parsing System ([1506755](https://github.com/minipuft/claude-prompts/commit/150675589e650d5a06d018e7884658a31965dcf2))
* multi-platform extension support with enhanced hooks and gate system ([27b94ec](https://github.com/minipuft/claude-prompts/commit/27b94ecb3946a3a5a227fe5c0dbbbe8792b7cc71))
* **parser:** enhance case-insensitive prompt matching and add strategic implementation ([628b09c](https://github.com/minipuft/claude-prompts/commit/628b09c3e7b6017317eaa966de9b6fd756f77e15))
* **plugin:** add server/resources directory for plugin deployment ([2d21a86](https://github.com/minipuft/claude-prompts/commit/2d21a864a278a3c7a3abbcb4e53843ae65b39ea5))
* **plugin:** add SessionStart hook for dependency installation ([3896fb9](https://github.com/minipuft/claude-prompts/commit/3896fb9b967fe8761ef8f1ee0f4d2d84bf1ec139))
* **plugin:** persist user data outside cache directory ([e59c64b](https://github.com/minipuft/claude-prompts/commit/e59c64b5fc37e989783db8070cceaab320e7be4f))
* **plugin:** unify plugin with YAML resources, version history, and script tools ([0963d4a](https://github.com/minipuft/claude-prompts/commit/0963d4ac56da09dc35d08fc3070c4b846b191fb1))
* **ralph:** context isolation for long-running verification loops ([f1c1014](https://github.com/minipuft/claude-prompts/commit/f1c1014f75dc719d919013dd3dbd9219d2900fe6))
* re-introduce hot-reloading for prompots ([720f96b](https://github.com/minipuft/claude-prompts/commit/720f96b9810a2e3675eb305b3e69683a64bb3982))
* release 1.2.0 with CI validation and gate refactoring ([75ec3e8](https://github.com/minipuft/claude-prompts/commit/75ec3e83e06e6c7753045778d770fc80773e77e0))
* shell verification presets and checkpoint resource type ([ca24027](https://github.com/minipuft/claude-prompts/commit/ca240274e3df495f87879b28e5492c4289cfb489))
* **styles:** add style operator (#) for response formatting ([d2c3173](https://github.com/minipuft/claude-prompts/commit/d2c3173ad4d7edb758207460d56167dd7bc4336b))
* update documentation for version 1.1.0 - "Intelligent Execution" ([7e1fb3f](https://github.com/minipuft/claude-prompts/commit/7e1fb3f02a226b232464a5ae98132d25344813dd))


### Bug Fixes

* add missing nunjucks dependency for template processing ([4f78114](https://github.com/minipuft/claude-prompts/commit/4f781144de43b72d0b29603337ba44d4ba61bb2a))
* add required metadata for plugin menu navigation ([72cd845](https://github.com/minipuft/claude-prompts/commit/72cd845e96cd04c37ec32eb1584f17f8c57e03b2))
* **ci:** consolidate workflows and fix Docker paths ([42efb12](https://github.com/minipuft/claude-prompts/commit/42efb126455c16ac46ba349091977351eb337f82))
* **ci:** skip action inventory verification for bundled builds ([dd299e5](https://github.com/minipuft/claude-prompts/commit/dd299e5f65fe3ffe2184debf659b7a764b176fb0))
* **ci:** update extension-publish workflow for bundled distribution ([8d977e9](https://github.com/minipuft/claude-prompts/commit/8d977e9c4daa8b8b7a6796bd66e6164ece662f86))
* clear lint regressions ([77db53a](https://github.com/minipuft/claude-prompts/commit/77db53a850a93f5fd1b41fe53dc21cd2a258454f))
* **contracts:** add prettier formatting to contract generator ([6096c67](https://github.com/minipuft/claude-prompts/commit/6096c67aa1151f402670081c8871237a2c9888ef))
* **contracts:** format all generated TypeScript files ([0e4c9af](https://github.com/minipuft/claude-prompts/commit/0e4c9aff57867ac46e905fc1e3be4e58b271a946))
* correct marketplace.json schema (source not path) ([6d08e63](https://github.com/minipuft/claude-prompts/commit/6d08e63f06bb6cb6c20a438d23823174e4c24bfb))
* correct source path (relative to marketplace.json) ([e281b48](https://github.com/minipuft/claude-prompts/commit/e281b48728fe3c390058fdaf1126c4811e04ea7c))
* **deps:** add missing 'diff' dependency for text-diff-service ([12b70db](https://github.com/minipuft/claude-prompts/commit/12b70dbfb0f5a53be24c084cd6505133f4458fd5))
* **docker:** update Dockerfile for renamed docs and styles directory ([35144c8](https://github.com/minipuft/claude-prompts/commit/35144c8905c00c5d2a2901a20796ecab4904d1aa))
* **docs:** remove invalid color property from mermaid linkStyle ([d086ca1](https://github.com/minipuft/claude-prompts/commit/d086ca1ee22818c93d427b93d830463c9bb49d37))
* **gemini:** align extension with Claude plugin v1.1.1 ([fb3413c](https://github.com/minipuft/claude-prompts/commit/fb3413c399956ab510f140db8c8802d8938714cb))
* **gemini:** resolve symlinks before path calculation ([77da3bc](https://github.com/minipuft/claude-prompts/commit/77da3bc655a8fdee67b301ec47f993763ce42bcb))
* **hooks:** add quick-check mode to prevent SessionStart blocking ([c4b3f94](https://github.com/minipuft/claude-prompts/commit/c4b3f94d5d1be5b579a25f825f6633e7937cf129))
* **hooks:** make dev-sync portable across environments ([4aa1190](https://github.com/minipuft/claude-prompts/commit/4aa119040f21669c2f5e52e7810ed32198f547dc))
* **npm:** Include methodologies folder in published package ([9bad683](https://github.com/minipuft/claude-prompts/commit/9bad68308e017bc0c362e28f7829d3220bcd7116))
* **plugin:** correct .mcp.json schema and improve dev workflow ([9927529](https://github.com/minipuft/claude-prompts/commit/99275299847de16f1bd42d13525e8cd4c662e624))
* **plugin:** include server/dist for plugin installation ([5f1edd3](https://github.com/minipuft/claude-prompts/commit/5f1edd3ed144e27a3380ea2d8e52890b78a836c5))
* **plugin:** remove duplicate hooks reference causing load failure ([c6c3ca6](https://github.com/minipuft/claude-prompts/commit/c6c3ca648110e216b630829abab947d88cd036ac))
* prune useless prompts ([daec104](https://github.com/minipuft/claude-prompts/commit/daec104cecf6719a080af777899849e2d8493156))
* regenerate contract artifacts and update lint baseline ([0a0e67d](https://github.com/minipuft/claude-prompts/commit/0a0e67d9d62c74e552bb69bcad00299e5e1b23b3))
* **release:** correct release-please config paths ([20662ec](https://github.com/minipuft/claude-prompts/commit/20662ecb89f5ff84c8baea6321774141b049eca7))
* Remove accidentally committed node_modules, update .gitignore ([ed452ac](https://github.com/minipuft/claude-prompts/commit/ed452acd60df2c76d94c43eceb09a66a42edf386))
* return simple text responses for MCP tool visibility in Claude Code ([7980567](https://github.com/minipuft/claude-prompts/commit/7980567d540c04390eb90c44d7c3ed1345394291))
* source must start with ./ ([b2482f1](https://github.com/minipuft/claude-prompts/commit/b2482f1dc79ec65b3e60d7d0192624e18a8a71ee))
* source path relative to repo root ([f2e3020](https://github.com/minipuft/claude-prompts/commit/f2e302058137a49bd2bc195cccc87b71973a38b9))


### Miscellaneous Chores

* prepare 1.3.0 release ([225ebe6](https://github.com/minipuft/claude-prompts/commit/225ebe6da4bb8f5c13ab6d750690249e0ed9502b))

## [Unreleased]

### Added

- **Context-isolated Ralph loops** for preventing context rot in long verification sessions
  - Iterations 1-3 run in-context (fast feedback)
  - Iterations 4+ spawn fresh `claude --print` processes with complete isolation
  - Session story and diff summary passed to spawned instances
  - Configurable via `ralph.isolation` in `server/config.json`
- **Session tracking library** (`hooks/lib/session_tracker.py`) for debugging journey context
- **Lesson extraction** (`hooks/lib/lesson_extractor.py`) for extracting insights from Claude responses
- **CLI spawner library** (`hooks/lib/cli_spawner.py`) for headless Claude execution
- **Task protocol** (`hooks/lib/task_protocol.py`) for structured task/result markdown files
- **Ralph context tracker hook** for tracking Edit/Bash tool usage during verification loops
- **Integration tests** for shell verification isolation flow (`tests/integration/gates/shell-verify-isolation.test.ts`)
- **Checkpoint resource type** in `resource_manager` for git-based working directory snapshots
  - Actions: `create`, `rollback`, `list`, `delete`, `clear`
  - Uses git stash under the hood for safe checkpoint/restore workflows
  - State persisted to `runtime-state/checkpoints.json`
- **Shell verification presets** for quick configuration of verification loops
  - `:fast` - 1 attempt, 30s timeout (quick iteration)
  - `:full` - 5 attempts, 5 min timeout (CI validation)
  - `:extended` - 10 attempts, 10 min timeout (large test suites)
- **`shell_verify` as GatePassCriteria type** - shell verification now integrates with the gate system
  - Can be defined in gate YAML files alongside other criteria types
  - Supports `shell_command`, `shell_timeout`, `shell_max_attempts`, `shell_preset` fields
- **Ralph Loops documentation** (`docs/guides/ralph-loops.md`) for autonomous verification patterns
- **VerifyActiveStateManager** for tracking shell verification state across requests
- **ShellVerifyMessageFormatter** for consistent verification output formatting
- Example gate definition `resources/gates/test-suite/` demonstrating shell_verify criteria

### Changed

- **Config schema modernization** with IDE validation support:
  - Renamed `frameworks` → `methodologies` config section
  - Renamed `chainSessions` → `advanced.sessions` config section
  - Renamed `gates.definitionsDirectory` → `gates.directory`
  - Renamed `gates.enableMethodologyGates` → `gates.methodologyGates`
  - Added `config.schema.json` for IDE autocomplete and validation
  - Added `$schema` reference in `config.json`
- Shell verification options simplified: removed `checkpoint:true` and `rollback:true` (now handled by checkpoint resource type)
- Gate schema extended to support `shell_verify` pass criteria type
- README updated with Checkpoints and Verification Gates sections
- Ralph context isolation config moved from `ralph.contextIsolation` to `verification.isolation`

### Removed

- Deprecated plans: `resource manager update/`, `script-tools/` (implementations complete)
- `server/tests/e2e/gemini-hooks-smoke.test.ts` (moved to [gemini-prompts](https://github.com/minipuft/gemini-prompts))

### Fixed

- Git checkpoint rollback now properly resets working tree before applying stash
- State isolation in checkpoint manager (factory function instead of shared object)
- **RALPH_SESSION_ID** now properly set in environment for context tracking hooks
- **originalGoal** properly passed through MCP VerifyActiveState for context-isolated loops
- CLI spawner modernized with async subprocess handling, retry with exponential backoff, and circuit breaker pattern

## [1.2.0] - 2025-01-12

### Added

- CI validation and gate refactoring improvements
- Release automation in CONTRIBUTING.md

## [1.1.0] - 2025-01-10

### Added

- Initial public release with MCP server, prompts, gates, and frameworks

[Unreleased]: https://github.com/minipuft/claude-prompts/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/minipuft/claude-prompts/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/minipuft/claude-prompts/releases/tag/v1.1.0
