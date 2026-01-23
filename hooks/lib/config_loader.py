"""
Config loader for Claude Code hooks.
Loads hook-specific configuration from server/config.json.

Uses workspace resolution (MCP_WORKSPACE > CLAUDE_PLUGIN_ROOT > development fallback).
"""

import json
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
        "expandedOutput": False,  # Compact mode by default
    }
}


def load_config() -> Config:
    """
    Load configuration from server/config.json.
    Returns default config if file not found or parse error.
    """
    # Try workspace-aware path first
    server_dir = get_server_dir(Path(__file__).parent.parent.parent / "server")
    config_path = server_dir / "config.json"

    if not config_path.exists():
        return DEFAULT_CONFIG

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
            return config
    except (json.JSONDecodeError, OSError):
        return DEFAULT_CONFIG


def get_hooks_config() -> HooksConfig:
    """Get hooks-specific configuration."""
    config = load_config()
    return config.get("hooks", DEFAULT_CONFIG["hooks"])


def is_expanded_output() -> bool:
    """Check if expanded hook output is enabled."""
    hooks_config = get_hooks_config()
    return hooks_config.get("expandedOutput", False)
