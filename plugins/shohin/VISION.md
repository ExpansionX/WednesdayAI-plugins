---
doc_type: vision
workstream: shohin
title: "Shohin — one work system, run by agents, that builds itself"
status: draft
created: 2026-09-03
updated: 2026-09-03
authors: [David Rudduck, claude-fable-5-1]
---

# Shohin

> 商品 *shōhin*: a product. The name is reused from the dormant Shohin business-management app. That app's ambition (clients, projects, tasks, time, money in one place) is the right ambition; its shape (a standalone Next.js CRUD app with no agents) is the wrong shape. Shohin v2 is that ambition rebuilt as a WednesdayAI plugin, with agents as first-class workers.

## The outcome

One system where humans and WednesdayAI personas track, plan, execute and review work. Software work and non-software work live on the same board with the same lifecycle. Items in software projects additionally get **runs**: supervised executions by coding agents, gated by deterministic checks and adversarial review, with evidence attached. The system is operated day to day by agent personas under explicit human gates, and it is used to plan and build its own next phase.

Success is observable, not aspirational:

- A work item created in chat is executed, gated, committed and closed with evidence, with no human step other than a recorded approval where one is required.
- Every task that today lives in the MondayDev work-tracker, in Claude Code plan files, or in a heartbeat prompt exists as one work item in one store with one history.
- An operator can see, from one page, what is queued, what is running, what is stuck and why, and can stop, redirect or talk to the persona responsible.
- Errors, warnings, CI failures and issues arrive as findings, are clustered, and are promoted into workstreams without anyone copying text between systems.
- Shohin's own roadmap, from Phase 2 onward, is executed from Shohin's own board.

## Why now

Four parallel task systems exist and none is wired to the others: the WAI plan files in git, the MondayDev work-tracker in Postgres, vk-swarm's SQLite attempts, and upstream OpenClaw's Workboard. Each has a piece of the answer. WAI has the quality gates. Work-tracker has the live data and the personas that depend on it. vk-swarm has the durable executor layer. Workboard has the card contract and the dispatcher. None has the whole loop, and building a fifth silo would be the worst outcome.

WednesdayAI's own glossary already reserves the vocabulary and the boundary: *work-tracker* is "the authoritative source of truth for tasks, task status, ownership, approval state, and what work is available next", a *work run* is "a claimed execution attempt for one work-tracker task", and *approval-gated work* "must happen through a work run with explicit approval recorded first". Core explicitly does not own these. Shohin is the plugin that does.

## Principles

These are the non-negotiables. Each one is a scar from one of the four existing systems, and each is cheap on day one and expensive later.

1. **One store, one writer path.** Every mutation goes through the kernel's command layer. Nothing mirrors kernel state into a second store. Adapters read from and write to the kernel; they never keep their own copy. vk-swarm rebuilt its sync layer twice because it broke this rule.
2. **The state machine lives in the store.** Legal transitions and the dependency gate are enforced where the row is written, not in whichever client happens to be polite. Work-tracker enforced its dependency gate only in the web API, so MCP callers bypassed it.
3. **Every write names an actor.** Human, persona, executor or adapter, with the session and run that caused it. There is no anonymous write.
4. **Append-only event journal, written in the same transaction as the state change.** The UI, triage, audit and recovery all read the journal. There is no polling of tables to infer what happened.
5. **Approval-gated work is a first-class flag, not a convention.** Items that can change external state, touch protected repositories, spend money or delete data carry the flag. A run cannot start against a flagged item without a recorded decision.
6. **Leases with fencing, enforced server-side.** Claims expire on the server, not by a cron script that may or may not run. A stale claimant's writes are rejected by token, not by trust.
7. **Domain-agnostic kernel, software-specific module.** The kernel does not know what a worktree is. The factory does not define what a work item is.
8. **Content stays in git; the kernel holds references.** Specs, plans and task files remain files under version control, because that is where the gates and the diff tools live. The kernel stores repo, path and commit, never a copy.
9. **The factory goes through the same gates humans do.** Self-improvement is not a shortcut around precheck, decompose, task gates, review panels or approvals. It is those gates run by agents.
10. **No new frontend stack, no second database engine, no protocol core does not already speak.** Complexity is spent only on the domain.
11. **Every state has an owner and a deadline.** A status nobody owns is where work goes to die at 3am. Each status names who acts on it, how long it may sit, and what happens when it goes stale.
12. **Executor output is a hint, never truth.** Anything a coding agent can write, it can forge. The supervisor decides what happened from exit status, commits it can see and gates it ran itself.
13. **Approval binds to content, not to a title.** An approval names the exact plan, files, branch and budget it covers. Change any of them and the approval is void.

## Shape

Three bounded contexts and one presentation layer, inside one plugin with hard internal module boundaries. The contexts split into separate packages only when the plugin SDK gains a plugin-to-plugin call seam; until then, one process and one store avoid the sync problem entirely.

```
                      +------------------------------------------------------+
  chat / channels --->|  personas: Foreman, Architect, Principal, Sentinel,  |
  cron / idle -------->|            Release Manager, Monday and friends       |
                      +----------------------+-------------------------------+
                                             | agent tools (work_*, factory_*)
                      +----------------------v-------------------------------+
  gateway RPCs ------>|  WORK KERNEL   projects, items, links, claims,       |
  board page -------->|                approvals, events, findings           |
  compat tools ------>|                state machine + journal, one store    |
                      +----------------------+-------------------------------+
                                             | item.kind = software
                      +----------------------v-------------------------------+
  git / worktrees <---|  FACTORY       runs, attempts, executor interface,   |
  OpenCode / CLIs <---|                gates, evidence, PR links, budgets    |
                      +------------------------------------------------------+
                                             ^
  context-engine commitments, findings from logs / CI / issues (joined at the leaf)
```

**Work kernel.** Projects have a domain (general or software) and contain work items. Items have a kind (task, bug, feature, chore, commitment, ops, personal), a status from a fixed set, a priority, labels, links (parent, child, blocks, blocked-by, relates-to), an optional claim, an optional approval, and a journal of events. Transitions, claims and gates are enforced in the store's own write statements, not in a client. Findings are a lightweight inbound record that can be promoted into an item. The kernel exposes gateway RPCs, agent tools, and a compatibility alias set carrying the existing work-tracker tool names so the MondayDev personas keep working unchanged.

**Factory.** A run is one attempt at one item in a software project, typically a parent item whose children are the tasks of one decomposed plan. It owns a worktree, a detached executor process group, a lease, a budget, an event log and an evidence bundle. Executors sit behind one interface. The first executor is the WAI DAG runner driving OpenCode with the configured model ladder, because the DAG runner already carries the task gates, the escalation ladder, the assessor and a notify hook. A vk-swarm node is a candidate second executor. Attention items from a run become kernel events that wake the Principal.

**Context bridge.** Commitments detected by the MondayDev context-engine and findings from diagnostic events, logs, CI and GitHub issues enter the kernel as findings or items. The project is always chosen explicitly, never inferred from a space. Spaces and projects stay parallel taxonomies joined at the leaf, as ADR-0024 in MondayDev already decided.

**Presentation.** First a board page served by the plugin over the gateway's HTTP route registry, using the console's design system and its WebSocket client, reading the journal by cursor. Later, the same components move into a console tab once core gains a plugin tab descriptor, a plugin event passthrough and a scope argument for plugin methods. The console rebuild is not a prerequisite; it is one of the first workstreams the factory runs.

## Personas

Each persona is a WednesdayAI agent with its own workspace files, model, and least-privilege tool policy. Universal personas serve every project kind; factory personas serve software items only.

| Persona | Scope | Model tier | Does | Must not |
|---|---|---|---|---|
| Foreman | universal | mid | wakes on cron or idle, selects ready and approved items, starts runs, watches liveness, moves cards, reports | edit specs, run shell, approve anything, retry a blocked item |
| Architect | factory | frontier | runs prd-new, spec and decompose with the human, lands artifacts and items on the board | start runs |
| Principal | factory | frontier | receives attention items with vision, spec and neighbours; returns continue, patch, retry or abort; amends task files; writes ADRs | touch protected repos without approval |
| Sentinel | universal | cheap | consumes diagnostic events, logs, CI and issues; clusters into findings; proposes promotion | create items directly, instruct executors |
| Release Manager | factory | mid | runs close, ship, PR and live verification; pushes and opens PRs only in a deterministic policy-gated step | merge without approval, act on PR comments in the same turn that read them |
| Monday and existing MondayDev personas | universal | as configured | use the board for personal, business and ops work through the same tools they call today | — |

Workers and review panels are executors and sub-agents, not personas.

## What Shohin replaces, and what it does not

| System | Fate |
|---|---|
| MondayDev work-tracker (Postgres, MCP, admin v3 board) | data imported once; tool names kept as aliases; MCP server becomes an adapter or is retired; board retired after the Shohin page ships |
| Shohin v1 (Next.js) | archived; concepts (time to invoice chain, rate resolution) carried by ADR; no code reused |
| WAI plan and task files | unchanged and still canonical for content; Shohin references them |
| vk-swarm | not migrated; optional second executor; hive unused |
| MondayDev context-engine | unchanged; promotion calls a kernel tool instead of inserting into a table |
| WednesdayAI core | unchanged in Phases 0–3; two small seams later, each its own ADR in core |

Out of scope for the program: invoicing and payments, multi-tenant organisations, a plugin marketplace, replacing the interaction kernel, and any change to how core routes conversations.

## The recursion

Phase 1 produces a walking skeleton: imported plan to run to evidence to review, dispatched by an in-process service. From Phase 2, each phase's decomposed tasks are imported onto the board and executed through the factory, while planning still happens between the human and the Architect in the CLI. From Phase 4 the Foreman persona dispatches; by Phase 5 the Architect runs planning on the board too. The factory improves the factory, but only through the gates, and only with the approvals, that a human would need.
