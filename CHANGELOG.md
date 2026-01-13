# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- Shell verification options simplified: removed `checkpoint:true` and `rollback:true` (now handled by checkpoint resource type)
- Gate schema extended to support `shell_verify` pass criteria type
- README updated with Checkpoints and Verification Gates sections

### Fixed

- Git checkpoint rollback now properly resets working tree before applying stash
- State isolation in checkpoint manager (factory function instead of shared object)

## [1.2.0] - 2025-01-12

### Added

- CI validation and gate refactoring improvements
- Release automation in CONTRIBUTING.md

## [1.1.0] - 2025-01-10

### Added

- Initial public release with MCP server, prompts, gates, and frameworks

[Unreleased]: https://github.com/minipuft/claude-prompts-mcp/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/minipuft/claude-prompts-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/minipuft/claude-prompts-mcp/releases/tag/v1.1.0
