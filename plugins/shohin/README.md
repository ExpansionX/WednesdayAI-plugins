# Shohin

Unified work system for WednesdayAI: a domain-agnostic **work kernel** (projects, work items, links, claims, approvals, events, runs) and an agent-run **software factory** that plans, executes, reviews and ships software through WednesdayAI personas under human gates.

**Status: design phase.** This package is a shell. It registers no capabilities yet. Read in this order:

1. [`VISION.md`](./VISION.md) — the outcome, principles and shape.
2. [`docs/PROGRAM.md`](./docs/PROGRAM.md) — the phased plan, migration boundaries, security controls, acceptance criteria and the first vertical slice.
3. ADRs 0005–0011 in [`/dev-docs/adr/`](../../dev-docs/adr/) — the decisions the plan rests on.

Implementation is driven through the WAI workflow (`/wai:prd-new` → `/wai:spec` → `/wai:precheck` → `/wai:decompose` → `/wai:execute`), one workstream per phase.

## Install

Not installable yet. When published:

```bash
wednesdayai plugins install shohin
```

## Config

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `enabled` | boolean | `true` | Master switch for the plugin |

The real configuration surface (storage placement, executor selection, persona model tiers, budgets, protected repositories) is specified in `docs/PROGRAM.md` and lands with each phase.

## License

MIT
