# Plan: Investigate & Fix `gemini extensions link` Behavior

## Context
The standard command `gemini extensions link ./path` created a directory in `~/.gemini/extensions/` containing only installation metadata (`.gemini-extension-install.json`), but seemingly failed to link the actual source files or create a usable filesystem symlink.

This forced us to use a manual `ln -s` workaround for development, which is fragile and OS-specific (Windows requires `mklink`).

## Objectives
1.  **Root Cause Analysis**: Determine why `gemini extensions link` failed to expose the files.
    *   Is it a bug in the Gemini CLI?
    *   Is our `gemini-extension.json` or `manifest.json` missing a `files` allowlist?
    *   Does the CLI expect a build step before linking?
2.  **Fix Implementation**:
    *   Adjust configuration to support native linking.
    *   Verify cross-platform compatibility.
3.  **Documentation**:
    *   Update `README.md` to use the standard command once fixed.

## Investigation Steps
- [ ] Review `gemini-extension.json` schema requirements for "local" extensions.
- [ ] Test `gemini extensions link` with verbose logging.
- [ ] Compare with other working Gemini extensions.
- [ ] Verify if `npm link` or similar standard tool integration is expected.

## Why Bother?
- **User Experience**: "Link" is the documented, standard way to develop. Users shouldn't need to know `ln -s`.
- **Cross-Platform**: Manual symlinks are different on Windows/Linux/macOS. The CLI handles this abstraction.
- **Reliability**: A proper link ensures the CLI manages the extension lifecycle (enable/disable/uninstall) correctly.
