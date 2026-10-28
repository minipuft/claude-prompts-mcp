"""
Built-in `>>` commands the server answers without a prompt record.

Mirrors `isBuiltinCommand()` in `server/src/engine/execution/parsers/command-parser.ts`;
`hooks/tests/test_builtin_commands_parity.py` reads that file and fails when the two
lists drift. The hook needs the list because built-ins have no row in `resource_index`,
so a catalog lookup alone reports `>>status` as an unknown prompt and the client then
guesses (measured 2026-10-20: the model ran `git status`).
"""

BUILTIN_COMMANDS: frozenset[str] = frozenset(
    {
        "listprompts",
        "listprompt",
        "list_prompts",
        "help",
        "commands",
        "status",
        "health",
        "analytics",
        "metrics",
        "gates",
        "gate",
    }
)


def is_builtin_command(prompt_id: str | None) -> bool:
    """True when `prompt_id` names a server built-in (case-insensitive, like the parser)."""
    return bool(prompt_id) and prompt_id.lower() in BUILTIN_COMMANDS
