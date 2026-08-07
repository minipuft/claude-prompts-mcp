# Changelog Entry Gate

Validates that implementation includes a corresponding CHANGELOG.md update.

## Expected Format

```markdown
## [Unreleased]

### Added

- New feature description

### Fixed

- Bug fix description

### Changed

- Modification description
```

## Rules

- Changelog updates happen WITH the code change, not at release
- Use Keep a Changelog categories: Added, Fixed, Changed, Removed, Deprecated, Security
- Each entry should describe the user-visible impact, not implementation details
- Reference issue numbers when applicable

## Source

dev-workflow.md Phase 3
