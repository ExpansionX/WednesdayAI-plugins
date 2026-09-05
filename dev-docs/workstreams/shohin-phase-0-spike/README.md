---
workstream: shohin-phase-0-spike
doc_type: readme
status: draft
title: "Shohin Phase 0 — spike: WAI DAG runner inside an OS-enforced scope from a WednesdayAI plugin"
staging_pointers:
  - docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md
---

# shohin-phase-0-spike

Throwaway spike for the Shohin program (`plugins/shohin/docs/PROGRAM.md` §2). Proves whether a WednesdayAI plugin service can run the WAI DAG runner headless on OpenCode inside a systemd user scope with an ephemeral, credential-free HOME, observe attention and terminal state, cancel cleanly, and recover after a gateway restart. The only surviving artifact is `spike-report.md` in this directory; it fixes the `Executor` adapter contract and recovery policy for Phase 1.

## Quick links

- [Spec / intent](/docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md)
- [Program plan](/plugins/shohin/docs/PROGRAM.md) · [Vision](/plugins/shohin/VISION.md)
- ADRs [0005](/dev-docs/adr/0005-shohin-is-a-wednesdayai-plugin-and-wednesdayai-is-the-host.md), [0008](/dev-docs/adr/0008-execution-boundary-management-in-gateway-code-in-external-harnesses.md), [0011](/dev-docs/adr/0011-security-model-approval-gated-work-actors-leases-budgets.md)
