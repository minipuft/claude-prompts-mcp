#!/usr/bin/env python3
"""
SessionStart hook: Auto-sync plugin source to Claude Code cache.

Runs on every session start to ensure hooks and cache are up-to-date.
Only syncs if running from development source (not marketplace install).
"""

import json
import os
import shutil
import sys
from pathlib import Path


def find_source_dir() -> Path | None:
    """Find the plugin source directory at known dev locations."""
    # Check common dev locations
    candidates = [
        Path.home() / "Applications/claude-prompts-mcp",
        Path.home() / "projects/claude-prompts-mcp",
        Path.home() / "dev/claude-prompts-mcp",
    ]

    for candidate in candidates:
        if (candidate / "server").exists() and (candidate / ".claude-plugin").exists():
            return candidate

    return None


def find_cache_dir() -> Path | None:
    """Find the Claude Code plugin cache directory."""
    cache_base = Path.home() / ".claude/plugins/cache/minipuft-marketplace/claude-prompts-mcp"

    if not cache_base.exists():
        return None

    versions = list(cache_base.iterdir())
    return versions[0] if versions else None


def sync_directory(src: Path, dst: Path) -> bool:
    """Sync a directory from source to destination."""
    if not src.exists():
        return False

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return True


def main():
    source_dir = find_source_dir()
    cache_dir = find_cache_dir()

    if not source_dir or not cache_dir:
        sys.exit(0)  # Silent exit if can't find directories

    synced = []

    # Sync core directories
    for dir_name in [".claude-plugin", "hooks"]:
        src = source_dir / dir_name
        dst = cache_dir / dir_name
        if sync_directory(src, dst):
            synced.append(dir_name)

    # Sync server/cache
    server_cache_src = source_dir / "server/cache"
    server_cache_dst = cache_dir / "server/cache"
    if server_cache_src.exists():
        server_cache_dst.parent.mkdir(parents=True, exist_ok=True)
        if sync_directory(server_cache_src, server_cache_dst):
            synced.append("server/cache")

    # Output to transcript (exit 0 + stdout)
    if synced:
        print(f"[Dev Sync] {', '.join(synced)}")

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Silent failure - don't break session start
        sys.exit(0)
