# SkillWeaver Code Review - Round 5

**Target:** `extensions/skillweaver/`  
**Effort:** high  
**Reviewer:** GPT-5.5

## Findings

| # | File:line | Severity | Category | Finding | Confidence | Actionable? |
|---|-----------|----------|----------|---------|-----------|-------------|
| 1 | `extensions/skillweaver/src/handler.ts:78` | medium | correctness | Retrieval timeouts only rejected the outer `Promise.race`; the underlying `retriever.buildHintSet()` / `retriever.retrieve()` work kept running because no abort signal flowed through `Retriever`, `SkillIndex`, or the embedding backends. On cloud/custom embeddings this could leave fetches running until their independent 30s timeout after the handler had already returned. | high | yes |
| 2 | `extensions/skillweaver/src/embedding/cloud.ts:67` | medium | correctness | Cloud/custom embedding responses only validated the first returned vector and did not enforce one embedding per input. A malformed endpoint could return too few vectors or a later vector with the wrong dimension, violating the `EmbeddingBackend` contract and failing later in indexing/search. | high | yes |

## Remediation

- Added optional `AbortSignal` support to `EmbeddingBackend`, `SkillIndex.search()`, and `Retriever` methods.
- Wired handler retrieval timeout aborts through `retriever.buildHintSet()` and `retriever.retrieve()` into embedding fetches.
- Added cooperative abort checks around local embedding work.
- Combined caller abort signals with backend fetch timeouts for cloud/custom embeddings.
- Enforced cloud/custom embedding response count equals input count.
- Validated every returned embedding vector dimension, not only the first.
- Added regression tests for retrieval abort propagation, retriever/SkillIndex signal forwarding, response count mismatch, mixed-dimension responses, and caller abort propagation.

## Non-actionable

| # | File:line | Severity | Category | Finding | Confidence | Why non-actionable |
|---|-----------|----------|----------|---------|-----------|---------------------|
| - | - | - | - | None. | - | - |

## Verification

- `pnpm test` - 254 passed, 1 skipped.
- `pnpm typecheck` - passed.

## Verdict: With fixes applied

Actionable: []
