"""
CLI spawner for context-isolated Ralph loops.

Spawns fresh Claude Code instances for complete context isolation
during long-running verification loops.

Key insight: `--print` mode with `--dangerously-skip-permissions` enables
full tool execution (Read, Edit, Write, Bash, etc.) via stdin prompt delivery.

Features:
- asyncio subprocess handling
- Retry with exponential backoff
- Circuit breaker pattern for failure isolation
- Full tool execution in spawned instances

Uses workspace resolution from workspace.py.
"""

import asyncio
import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from workspace import get_runtime_state_dir


# === Configuration Classes ===


@dataclass
class SpawnConfig:
    """Configuration for spawning a Claude CLI instance."""
    max_budget_usd: float = 1.00
    timeout_seconds: int = 300
    permission_mode: Literal["delegate", "prompt", "deny"] = "delegate"
    output_format: Literal["text", "json", "stream-json"] = "text"
    working_directory: str | None = None


@dataclass
class RetryConfig:
    """Configuration for retry with exponential backoff."""
    max_retries: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 30.0
    exponential_base: float = 2.0
    jitter: bool = True  # Add randomness to prevent thundering herd


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker pattern."""
    failure_threshold: int = 5  # Failures before opening circuit
    recovery_timeout_seconds: float = 60.0  # Time before attempting recovery
    half_open_max_calls: int = 1  # Calls allowed in half-open state


@dataclass
class SpawnStats:
    """Token usage and cost statistics from Claude CLI."""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    total_cost_usd: float = 0.0
    duration_ms: int = 0
    num_turns: int = 0


@dataclass
class SpawnResult:
    """Result from a spawned Claude CLI instance."""
    success: bool
    output: str
    error: str | None
    exit_code: int
    timed_out: bool
    retries_used: int = 0
    stats: SpawnStats | None = None  # Token usage and cost when using JSON output


# === Circuit Breaker Implementation ===


class CircuitBreakerState:
    """Tracks circuit breaker state."""
    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing fast, not attempting calls
    HALF_OPEN = "half_open"  # Testing if service recovered


@dataclass
class CircuitBreaker:
    """
    Circuit breaker for protecting against cascading failures.

    States:
    - CLOSED: Normal operation, all calls go through
    - OPEN: Service is failing, reject calls immediately
    - HALF_OPEN: Testing recovery, allow limited calls
    """
    config: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)
    _state: str = field(default=CircuitBreakerState.CLOSED, init=False)
    _failure_count: int = field(default=0, init=False)
    _last_failure_time: float = field(default=0.0, init=False)
    _half_open_calls: int = field(default=0, init=False)

    @property
    def state(self) -> str:
        """Get current circuit state, transitioning if needed."""
        if self._state == CircuitBreakerState.OPEN:
            # Check if recovery timeout has passed
            if time.time() - self._last_failure_time >= self.config.recovery_timeout_seconds:
                self._state = CircuitBreakerState.HALF_OPEN
                self._half_open_calls = 0
        return self._state

    def can_execute(self) -> bool:
        """Check if a call is allowed in current state."""
        state = self.state  # Triggers state transition check
        if state == CircuitBreakerState.CLOSED:
            return True
        if state == CircuitBreakerState.HALF_OPEN:
            return self._half_open_calls < self.config.half_open_max_calls
        return False  # OPEN state

    def record_success(self) -> None:
        """Record a successful call."""
        if self._state == CircuitBreakerState.HALF_OPEN:
            self._half_open_calls += 1
            if self._half_open_calls >= self.config.half_open_max_calls:
                # Recovery confirmed, close circuit
                self._state = CircuitBreakerState.CLOSED
                self._failure_count = 0
        elif self._state == CircuitBreakerState.CLOSED:
            # Reset failure count on success
            self._failure_count = 0

    def record_failure(self) -> None:
        """Record a failed call."""
        self._failure_count += 1
        self._last_failure_time = time.time()

        if self._state == CircuitBreakerState.HALF_OPEN:
            # Recovery failed, reopen circuit
            self._state = CircuitBreakerState.OPEN
        elif self._failure_count >= self.config.failure_threshold:
            # Too many failures, open circuit
            self._state = CircuitBreakerState.OPEN


# === Module-level circuit breaker instance ===
_circuit_breaker = CircuitBreaker()


def get_circuit_breaker() -> CircuitBreaker:
    """Get the module-level circuit breaker."""
    return _circuit_breaker


def reset_circuit_breaker() -> None:
    """Reset circuit breaker (for testing)."""
    global _circuit_breaker
    _circuit_breaker = CircuitBreaker()


# === Utility Functions ===


def _get_ralph_tasks_dir() -> Path:
    """Get Ralph tasks directory for task files."""
    dev_fallback = Path(__file__).parent.parent.parent / "server" / "runtime-state"
    runtime_dir = get_runtime_state_dir(dev_fallback)
    tasks_dir = runtime_dir / "ralph-tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    return tasks_dir


def _calculate_backoff_delay(
    attempt: int,
    config: RetryConfig
) -> float:
    """Calculate delay for exponential backoff with optional jitter."""
    import random

    delay = config.base_delay_seconds * (config.exponential_base ** attempt)
    delay = min(delay, config.max_delay_seconds)

    if config.jitter:
        # Add ±25% jitter
        jitter_range = delay * 0.25
        delay += random.uniform(-jitter_range, jitter_range)

    return max(0, delay)


def _build_command(config: SpawnConfig) -> list[str]:
    """Build the claude CLI command for --print mode with tool execution."""
    cmd = [
        "claude",
        "--print",
        f"--max-budget-usd={config.max_budget_usd}",
        f"--output-format={config.output_format}",
        # Skip permission prompts to enable tool execution in --print mode
        "--dangerously-skip-permissions",
        # Enable file operation tools
        "--allowedTools=Read,Edit,Write,Bash,Glob,Grep",
    ]

    # Add working directory to trusted paths if specified
    if config.working_directory:
        cmd.append(f"--add-dir={config.working_directory}")

    return cmd


def _get_spawn_env() -> dict[str, str]:
    """Get environment for spawned process."""
    return {**os.environ, "RALPH_SPAWNED": "true"}


def _parse_json_output(raw_output: str) -> tuple[str, SpawnStats | None]:
    """
    Parse JSON output from Claude CLI to extract result and stats.

    Returns:
        Tuple of (text_result, stats) where stats contains token usage and cost.
    """
    try:
        data = json.loads(raw_output)

        # Extract the actual result text
        result_text = data.get("result", raw_output)

        # Extract usage stats
        usage = data.get("usage", {})
        stats = SpawnStats(
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cache_read_tokens=usage.get("cache_read_input_tokens", 0),
            cache_creation_tokens=usage.get("cache_creation_input_tokens", 0),
            total_cost_usd=data.get("total_cost_usd", 0.0),
            duration_ms=data.get("duration_ms", 0),
            num_turns=data.get("num_turns", 0),
        )

        return result_text, stats
    except (json.JSONDecodeError, TypeError, KeyError):
        # Not JSON or parsing failed - return raw output
        return raw_output, None


# === Async Spawn Implementation ===


async def spawn_claude_print_async(
    prompt: str,
    config: SpawnConfig | None = None,
    retry_config: RetryConfig | None = None,
    use_circuit_breaker: bool = True,
) -> SpawnResult:
    """
    Spawn a headless Claude CLI instance asynchronously.

    Features:
    - Non-blocking async execution
    - Automatic retry with exponential backoff
    - Circuit breaker protection

    Args:
        prompt: The task/prompt to execute
        config: Optional spawn configuration
        retry_config: Optional retry configuration
        use_circuit_breaker: Whether to use circuit breaker (default True)

    Returns:
        SpawnResult with output, errors, and status
    """
    if config is None:
        config = SpawnConfig()
    if retry_config is None:
        retry_config = RetryConfig()

    circuit = get_circuit_breaker() if use_circuit_breaker else None
    cwd = config.working_directory or os.getcwd()
    cmd = _build_command(config)
    retries_used = 0

    for attempt in range(retry_config.max_retries + 1):
        # Circuit breaker check
        if circuit and not circuit.can_execute():
            return SpawnResult(
                success=False,
                output="",
                error=f"Circuit breaker OPEN - too many failures. Retry after {circuit.config.recovery_timeout_seconds}s",
                exit_code=-1,
                timed_out=False,
                retries_used=retries_used,
            )

        try:
            # Create async subprocess with stdin for prompt delivery
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=_get_spawn_env(),
            )

            # Communicate with timeout - prompt via stdin
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=prompt.encode()),
                    timeout=config.timeout_seconds,
                )

                result = SpawnResult(
                    success=process.returncode == 0,
                    output=stdout.decode() if stdout else "",
                    error=stderr.decode() if stderr else None,
                    exit_code=process.returncode or 0,
                    timed_out=False,
                    retries_used=retries_used,
                )

                if result.success and circuit:
                    circuit.record_success()
                elif not result.success and circuit:
                    circuit.record_failure()

                # Only retry on failure
                if result.success or attempt >= retry_config.max_retries:
                    return result

                retries_used += 1
                delay = _calculate_backoff_delay(attempt, retry_config)
                await asyncio.sleep(delay)

            except asyncio.TimeoutError:
                # Kill process on timeout
                process.kill()
                await process.wait()

                if circuit:
                    circuit.record_failure()

                if attempt >= retry_config.max_retries:
                    return SpawnResult(
                        success=False,
                        output="",
                        error=f"Process timed out after {config.timeout_seconds}s",
                        exit_code=-1,
                        timed_out=True,
                        retries_used=retries_used,
                    )

                retries_used += 1
                delay = _calculate_backoff_delay(attempt, retry_config)
                await asyncio.sleep(delay)

        except FileNotFoundError:
            if circuit:
                circuit.record_failure()
            return SpawnResult(
                success=False,
                output="",
                error="Claude CLI not found. Is claude-code installed?",
                exit_code=-1,
                timed_out=False,
                retries_used=retries_used,
            )

        except Exception as e:
            if circuit:
                circuit.record_failure()

            if attempt >= retry_config.max_retries:
                return SpawnResult(
                    success=False,
                    output="",
                    error=f"Spawn failed: {e}",
                    exit_code=-1,
                    timed_out=False,
                    retries_used=retries_used,
                )

            retries_used += 1
            delay = _calculate_backoff_delay(attempt, retry_config)
            await asyncio.sleep(delay)

    # Should not reach here, but handle gracefully
    return SpawnResult(
        success=False,
        output="",
        error="Max retries exceeded",
        exit_code=-1,
        timed_out=False,
        retries_used=retries_used,
    )


# === Synchronous Wrappers (for non-async contexts) ===


def spawn_claude_print(
    prompt: str,
    config: SpawnConfig | None = None,
    task_id: str | None = None  # noqa: ARG001 - kept for API compatibility
) -> SpawnResult:
    """
    Spawn a Claude CLI instance with full tool execution.

    Uses --print mode with --dangerously-skip-permissions to enable tool execution.
    The prompt is passed via stdin for reliable delivery.

    Args:
        prompt: The task/prompt to execute
        config: Optional spawn configuration
        task_id: Optional task ID for tracking (unused, for compatibility)

    Returns:
        SpawnResult with output, errors, status, and token usage stats
    """
    if config is None:
        config = SpawnConfig()

    # Use JSON output format to capture token stats
    json_config = SpawnConfig(
        max_budget_usd=config.max_budget_usd,
        timeout_seconds=config.timeout_seconds,
        permission_mode=config.permission_mode,
        output_format="json",  # Force JSON for stats
        working_directory=config.working_directory,
    )

    cmd = _build_command(json_config)
    cwd = config.working_directory or os.getcwd()

    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=config.timeout_seconds,
            cwd=cwd,
            env=_get_spawn_env(),
        )

        # Parse JSON output to extract text result and stats
        output_text, stats = _parse_json_output(result.stdout)

        return SpawnResult(
            success=result.returncode == 0,
            output=output_text,
            error=result.stderr if result.stderr else None,
            exit_code=result.returncode,
            timed_out=False,
            stats=stats,
        )

    except subprocess.TimeoutExpired:
        return SpawnResult(
            success=False,
            output="",
            error=f"Process timed out after {config.timeout_seconds}s",
            exit_code=-1,
            timed_out=True,
        )

    except FileNotFoundError:
        return SpawnResult(
            success=False,
            output="",
            error="Claude CLI not found. Is claude-code installed?",
            exit_code=-1,
            timed_out=False,
        )

    except Exception as e:
        return SpawnResult(
            success=False,
            output="",
            error=f"Spawn failed: {e}",
            exit_code=-1,
            timed_out=False,
        )


def _spawn_claude_print_blocking(
    prompt: str,
    config: SpawnConfig | None = None,
) -> SpawnResult:
    """Blocking subprocess spawn (fallback for nested event loops)."""
    if config is None:
        config = SpawnConfig()

    cmd = _build_command(config)
    cwd = config.working_directory or os.getcwd()

    try:
        # Prompt delivered via stdin
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=config.timeout_seconds,
            cwd=cwd,
            env=_get_spawn_env(),
        )

        return SpawnResult(
            success=result.returncode == 0,
            output=result.stdout,
            error=result.stderr if result.stderr else None,
            exit_code=result.returncode,
            timed_out=False,
        )

    except subprocess.TimeoutExpired:
        return SpawnResult(
            success=False,
            output="",
            error=f"Process timed out after {config.timeout_seconds}s",
            exit_code=-1,
            timed_out=True,
        )

    except FileNotFoundError:
        return SpawnResult(
            success=False,
            output="",
            error="Claude CLI not found. Is claude-code installed?",
            exit_code=-1,
            timed_out=False,
        )

    except Exception as e:
        return SpawnResult(
            success=False,
            output="",
            error=f"Spawn failed: {e}",
            exit_code=-1,
            timed_out=False,
        )


def spawn_with_task_file(task_file: Path, config: SpawnConfig | None = None) -> SpawnResult:
    """
    Spawn Claude CLI with a task file as the prompt.

    The task file should be a markdown file with the full task context.
    """
    if not task_file.exists():
        return SpawnResult(
            success=False,
            output="",
            error=f"Task file not found: {task_file}",
            exit_code=-1,
            timed_out=False,
        )

    prompt = task_file.read_text()
    return spawn_claude_print(prompt, config)


# === Async Task File Spawn ===


async def spawn_with_task_file_async(
    task_file: Path,
    config: SpawnConfig | None = None,
    retry_config: RetryConfig | None = None,
) -> SpawnResult:
    """
    Spawn Claude CLI with a task file (async version).

    Args:
        task_file: Path to markdown task file
        config: Optional spawn configuration
        retry_config: Optional retry configuration

    Returns:
        SpawnResult with output, errors, and status
    """
    if not task_file.exists():
        return SpawnResult(
            success=False,
            output="",
            error=f"Task file not found: {task_file}",
            exit_code=-1,
            timed_out=False,
        )

    prompt = task_file.read_text()
    return await spawn_claude_print_async(prompt, config, retry_config)


# === Result Parsing ===


def parse_spawn_result(result: SpawnResult) -> dict:
    """
    Parse a spawn result to extract structured information.

    Returns dict with: status, summary, changes_made, verification_output
    """
    output = result.output

    # Try to parse as JSON if configured that way
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        pass

    # Parse text output
    parsed = {
        "status": "PASS" if result.success else "FAIL",
        "output": output,
        "error": result.error,
        "timed_out": result.timed_out,
        "retries_used": result.retries_used,
    }

    # Look for PASS/FAIL in output
    if "PASS" in output.upper():
        parsed["status"] = "PASS"
    elif "FAIL" in output.upper():
        parsed["status"] = "FAIL"

    return parsed


# === Batch Spawn (for parallel execution) ===


async def spawn_batch_async(
    tasks: list[tuple[str, SpawnConfig | None]],
    max_concurrent: int = 3,
    retry_config: RetryConfig | None = None,
) -> list[SpawnResult]:
    """
    Spawn multiple Claude CLI instances with concurrency control.

    Args:
        tasks: List of (prompt, config) tuples
        max_concurrent: Maximum concurrent spawns
        retry_config: Retry configuration for all spawns

    Returns:
        List of SpawnResults in same order as tasks
    """
    semaphore = asyncio.Semaphore(max_concurrent)

    async def spawn_with_limit(prompt: str, config: SpawnConfig | None) -> SpawnResult:
        async with semaphore:
            return await spawn_claude_print_async(prompt, config, retry_config)

    coros = [spawn_with_limit(prompt, config) for prompt, config in tasks]
    return await asyncio.gather(*coros)
