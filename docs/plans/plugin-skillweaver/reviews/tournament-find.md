ADVERSARIAL TOURNAMENT — FIND + REMEDIATE. You are ONE competitor against N peers. Find every way this breakdown will FAIL an implementer, and for EACH finding propose a concrete, applicable fix.
Scoring: +1 per REAL cited problem, +1 per correct fix — BUT every finding is judged by a PEER (not you); a finding the peer rules not-real scores 0, a hand-wavy fix scores 0. Quality beats quantity: a padded/pedantic nit LOSES points. An honest `FINDINGS: 0` beats a rejected nit.

SPEC (FROZEN at precheck): docs/superpowers/specs/2026-07-06-plugin-skillweaver.md
PLAN: docs/plans/plugin-skillweaver/plan.md

TASK FILES:
docs/plans/plugin-skillweaver/phase-1/001-plugin-scaffold.md
docs/plans/plugin-skillweaver/phase-1/002-config-schema.md
docs/plans/plugin-skillweaver/phase-1/003-register-entry.md
docs/plans/plugin-skillweaver/phase-2/004-embedding-types.md
docs/plans/plugin-skillweaver/phase-2/005-local-embedding.md
docs/plans/plugin-skillweaver/phase-2/006-cloud-embedding.md
docs/plans/plugin-skillweaver/phase-2/007-custom-embedding.md
docs/plans/plugin-skillweaver/phase-3/008-skill-index.md
docs/plans/plugin-skillweaver/phase-3/009-index-rebuild.md
docs/plans/plugin-skillweaver/phase-4/010-decomposer.md
docs/plans/plugin-skillweaver/phase-4/011-retriever.md
docs/plans/plugin-skillweaver/phase-5/012-context-injector.md
docs/plans/plugin-skillweaver/phase-5/013-collect-handler.md
docs/plans/plugin-skillweaver/phase-5/014-register-wiring.md
docs/plans/plugin-skillweaver/phase-6/015-error-resilience.md
docs/plans/plugin-skillweaver/phase-6/016-lifecycle.md
docs/plans/plugin-skillweaver/phase-7/017-benchmark.md
docs/plans/plugin-skillweaver/phase-7/018-integration-tests.md

ADRs for irreversible decisions:
dev-docs/adr/0001-plugin-skillweaver-context-collect.md
dev-docs/adr/0002-plugin-skillweaver-embedding-backend.md
dev-docs/adr/0003-plugin-skillweaver-sad-prompt.md
dev-docs/adr/0004-plugin-skillweaver-in-memory-index.md

Sibling reference extension (for as-implemented convention checks): extensions/diffs/

Attack axes (cite task id + the contradicting repo file:line):
1. Not bite-sized / two concerns in one task. 2. Wrong/non-existent anchor/symbol/Before-text (VERIFY against the repo — NOTE: this is a NEW extension, target files do NOT exist yet; verify that file paths and import specifiers are plausible for a wednesdayai/plugin-sdk extension). 3. Ambiguous instruction. 4. allowed_change mismatch. 5. Dependency/conflict error or cycle. 6. Unmarked irreversible. 7. Untestable or HOLLOW test (passes without the implementation). 8. CONTROL-FLOW GROUNDING: open the real extension code in extensions/diffs/ as reference; a plausible-but-inverted call path is a finding — symbol existence ≠ control-flow correctness. 9. Fidelity: an SC/TS clause no task truly delivers (covered-but-hollow); walk EACH clause sub-id (SC2a/SC2b…) to a task.

Output one Markdown row per finding (severity | task | file:line | issue | remediation), then `FINDINGS: <n>` and a one-line self-assessment of why they survive peer review.
