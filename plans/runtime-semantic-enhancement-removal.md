# Runtime Semantic Enhancement Removal

Status: complete

## Scope

- Remove runtime semantic enhancement path (judge JSON self-loop) from chain execution.
- Remove selected resource injection plumbing from prompt guidance.

## Removed

- `PromptGuidanceService.applyRuntimeEnhancement`
- `ChainOperatorExecutor` runtime enhancement branch + judge extraction helper
- `selected_resources` field in semantic analysis advancedChainFeatures
- `selectedResources/availableResources` pipeline state and guidance options

## Validation

- Pending: run `npm run typecheck`, `npm run lint:ratchet`, `npm run test:ci`
