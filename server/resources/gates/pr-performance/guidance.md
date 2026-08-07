# PR Performance Check Gate

## Purpose

This gate identifies potential performance issues in code changes. It warns but does not block merge (advisory).

## What to Check

### Algorithmic Complexity

- O(n²) or worse nested loops
- Repeated database queries in loops (N+1 problem)
- Large array operations without pagination

### React/Frontend Specific

- Missing memoization for expensive computations
- Unnecessary re-renders from object/array literals in JSX
- Large bundle additions (new dependencies)

### Backend Specific

- Blocking operations on main thread
- Missing indexes for queried fields
- Unbounded queries without LIMIT

### General

- Debug statements left in code (console.log, debugger)
- Synchronous file I/O in request handlers
- Missing caching for repeated expensive operations

## Pass Criteria

- No O(n²) loops without documented justification
- Async operations for I/O
- Memoization for expensive pure functions
- No debug statements in production code

## Advisory Response Format

When this gate flags issues, provide:

1. **Issue type** (complexity, memory, I/O)
2. **Location** (file:line)
3. **Impact** (estimated severity)
4. **Suggestion** (optimization approach)

Example:

```
GATE ADVISORY - Performance concern detected

Issue: O(n²) nested loop
Location: src/utils/search.ts:23
Impact: Medium - may cause slowdown with large datasets (>1000 items)
Suggestion: Consider using a Map for O(1) lookups instead of inner find()
```

Note: This is advisory only. The chain will continue even if this check fails.
