"""
Config loader for Claude Code hooks.

Loads hook-specific configuration from the user's config file, resolved in this
order: `MCP_WORKSPACE`, then `${CLAUDE_PLUGIN_DATA}`, then the packaged `server/`
directory this loader has always read. Within each directory, `config.jsonc` (which
may carry `//` and `/* */` comments and a trailing comma before `}`/`]`) is tried
before the strict `config.json`. See `get_config_path()` for the full contract.
"""

import json
import os
from pathlib import Path
from typing import TypedDict

from workspace import get_server_dir


class HooksConfig(TypedDict, total=False):
    expandedOutput: bool


class Config(TypedDict, total=False):
    hooks: HooksConfig


# Default config values
DEFAULT_CONFIG: Config = {
    "hooks": {
        "expandedOutput": True,  # Matches the shipped server/config.json
    }
}


def _strip_comments(text: str) -> str:
    """Remove `//` line comments and `/* ... */` block comments from `text`.

    String-aware: a comment marker inside a JSON string (including one preceded by
    an escaped quote) is left untouched. Everything outside a string is scanned one
    character at a time so a `//` inside a value like a `$schema` URL is never
    mistaken for a comment start.
    """
    result: list[str] = []
    length = len(text)
    i = 0
    in_string = False

    while i < length:
        char = text[i]

        if in_string:
            result.append(char)
            if char == "\\" and i + 1 < length:
                # The escaped character is consumed verbatim and never inspected as
                # a potential string terminator or comment marker.
                result.append(text[i + 1])
                i += 2
                continue
            if char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            i += 1
            continue

        if char == "/" and i + 1 < length and text[i + 1] == "/":
            newline = text.find("\n", i)
            i = length if newline == -1 else newline
            continue

        if char == "/" and i + 1 < length and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = length if end == -1 else end + 2
            continue

        result.append(char)
        i += 1

    return "".join(result)


def _strip_trailing_commas(text: str) -> str:
    """Remove a comma that precedes the next `}` or `]` (skipping only whitespace).

    String-aware in the same way as `_strip_comments`. Call this AFTER comment
    stripping, so a comma followed by a comment followed by `}`/`]` is also caught.
    """
    result: list[str] = []
    length = len(text)
    i = 0
    in_string = False

    while i < length:
        char = text[i]

        if in_string:
            result.append(char)
            if char == "\\" and i + 1 < length:
                result.append(text[i + 1])
                i += 2
                continue
            if char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            i += 1
            continue

        if char == ",":
            lookahead = i + 1
            while lookahead < length and text[lookahead] in " \t\r\n":
                lookahead += 1
            if lookahead < length and text[lookahead] in "}]":
                # Trailing comma -- drop it, keep everything else.
                i += 1
                continue

        result.append(char)
        i += 1

    return "".join(result)


def strip_jsonc_comments(text: str) -> str:
    """Turn `.jsonc` text into strict-JSON text: `json.loads` should accept the result.

    Removes `//` line comments, `/* */` block comments, and a trailing comma before
    the next `}` or `]`, never touching content inside a JSON string (escaped quotes
    included). Pure function -- no I/O, safe to unit test directly.
    """
    return _strip_trailing_commas(_strip_comments(text))


def get_config_path() -> Path | None:
    """Resolve the user's config file.

    Lookup order: `MCP_WORKSPACE`, then `${CLAUDE_PLUGIN_DATA}`, then the packaged
    `server/` directory this loader has always read (via `get_server_dir`). The first
    two are read directly from the environment rather than through
    `workspace.get_workspace_root()`: that helper's fallback chain (CLAUDE_PLUGIN_ROOT,
    PLUGIN_ROOT, self-resolution) answers where the PACKAGED plugin installation lives,
    not where an operator's config or the Claude Code plugin's persistent data
    directory sits. `CLAUDE_PLUGIN_DATA` is probed for the same reason
    `workspace.get_state_db_path()` probes it: hooks do not inherit the MCP server's
    own environment, and the Claude Code plugin's `.mcp.json` points the server's own
    `MCP_WORKSPACE` at `${CLAUDE_PLUGIN_DATA}`.

    Within each directory, `config.jsonc` is tried before `config.json`. The first
    file that EXISTS wins -- a file found but unreadable or unparsable is not retried
    against the next directory; `load_config()` falls back to `DEFAULT_CONFIG` for it,
    exactly as it always has for the packaged file.

    Returns None when no candidate exists anywhere in the search order.
    """
    directories: list[Path] = []
    for root_variable in ("MCP_WORKSPACE", "CLAUDE_PLUGIN_DATA"):
        root = os.environ.get(root_variable)
        if root and root.strip():
            directories.append(Path(root))
    directories.append(get_server_dir(Path(__file__).parent.parent.parent / "server"))

    for directory in directories:
        for name in ("config.jsonc", "config.json"):
            candidate = directory / name
            if candidate.exists():
                return candidate

    return None


def load_config() -> Config:
    """
    Load configuration from the resolved config file (see `get_config_path()`).

    A `.jsonc` file's text passes through `strip_jsonc_comments()` before
    `json.loads`; a `.json` file is parsed strictly, as it always has been. Returns
    `DEFAULT_CONFIG` when no candidate file exists, or when the one found cannot be
    read or parsed -- a hook never refuses to run because the operator's config is
    missing or malformed.
    """
    config_path = get_config_path()
    if config_path is None:
        return DEFAULT_CONFIG

    try:
        text = config_path.read_text(encoding="utf-8")
        if config_path.suffix == ".jsonc":
            text = strip_jsonc_comments(text)
        return json.loads(text)
    except (json.JSONDecodeError, OSError):
        return DEFAULT_CONFIG


def get_hooks_config() -> HooksConfig:
    """Get hooks-specific configuration."""
    config = load_config()
    return config.get("hooks", DEFAULT_CONFIG["hooks"])


def is_expanded_output() -> bool:
    """Check if expanded hook output is enabled."""
    hooks_config = get_hooks_config()
    return hooks_config.get("expandedOutput", True)
