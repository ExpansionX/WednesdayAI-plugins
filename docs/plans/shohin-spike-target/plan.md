# shohin-spike-target Plan

## Spec
docs/superpowers/specs/2026-09-13-shohin-spike-target.md

## Approach
Keep the disposable target branch at a clean pre-task baseline. The first task makes only the Shohin manifest schema edit and runs the precommitted targeted gate fixture. The second task creates only the node:test manifest regression and depends on the first task.


## Phases
- **Phase 1: Target Manifest Boundary** — Make the smallest manifest schema change, then add the smallest regression proving it.

## Tasks

| id | phase | title | deps | conflicts |
|---|---:|---|---|---|
| 001 | 1 | Add closed Shohin storage sqlitePath config | dep: none | conflicts: none |
| 002 | 1 | Add Shohin manifest node test | dep: 001 | conflicts: none |
