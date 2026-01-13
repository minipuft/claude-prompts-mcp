# Test Suite Verification

This gate validates your implementation by running the project's test suite.

## How It Works

Unlike LLM self-evaluation gates, this gate uses **ground-truth validation**:

1. Your implementation is complete
2. The `npm test` command executes
3. Exit code 0 = **PASS** (all tests pass)
4. Exit code non-zero = **FAIL** (tests failed)

## On Failure

If tests fail, you'll receive the error output from the test runner. Use this feedback to:

1. Identify which tests failed
2. Understand the expected vs actual behavior
3. Fix your implementation
4. Submit again

## Configuration

This gate uses the `:full` preset:
- **Max Attempts**: 3
- **Timeout**: 5 minutes

## Best Practices

- Write tests alongside your implementation
- Run tests locally before submitting
- Focus on the specific test failures rather than making broad changes
- Check for both direct test failures and unintended side effects
