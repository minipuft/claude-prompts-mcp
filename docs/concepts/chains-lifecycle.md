# Chains: Lifecycle & Concepts

> Status: canonical

Chains break complex workflows into discrete, manageable reasoning steps.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Cognitive Overload** | Discrete Steps | Higher accuracy on complex tasks |
| **Lost Context** | State Management | Data flows cleanly from A to B |
| **Black Box** | Visible Progress | User sees/verifies intermediate steps |

---

## The Lifecycle

Chains are not just a list of prompts. They are a managed **state machine**.

### 1. Init
User invokes a chain (`>>research_chain`). The server creates a **Session** ID (`chain-research#123`).

### 2. Plan
The server maps dependencies.
- Step A: No dependencies.
- Step B: Needs A.
- Step C: Needs B.

### 3. Emit & Execute
The server tells the client: "Run Step A".
Client runs prompt → returns output.

### 4. Persist
Server saves output to `runtime-state/chain-sessions.json`.
Server checks dependencies: "Step B is now unblocked."

### 5. Loop
Repeat until all steps complete.

---

## Session Management

Chains persist across messages. You don't need to feed the entire history back to the model.

- **Storage**: `server/runtime-state/chain-sessions.json`
- **Resume**: Just provide `chain_id` + `user_response`.
- **Debug**: Inspect the JSON file to see variable state at any point.

### Automatic Resume
The MCP server recognizes active sessions. If you reply to a chain step, it automatically routes your response to the running session, restoring the execution context.
