---
doc_type: spec
status: gated
id: TRK-012
workstream: todos-shohin
change_kind: behaviour
title: "Plugin: todos-shohin — Shohin as a replaceable WednesdayAI todos provider"
created: 2026-11-18
updated: 2026-11-18
author: agent
tags: [plugin, todos, shohin, provider, adr-2712]
---

## Intent (what / why)

Operators who run [Shohin](https://github.com/ExpansionX/Shohin) for team or business work point
WednesdayAI's todos slot at Shohin with one config line — `plugins.slots.todos: "todos-shohin"` —
and every consumer written once against the core contract (the `todos` agent tool, the Tasks
chat-ui panel, the Home "needs you" source, the `todos/needs-you` glance widget) then reads and
writes Shohin data. Switching back to the bundled default is the same line changed.

The contract is ExpansionX/WednesdayAI-core ADR 2712 (`dev-docs/adr/2712-todos-task-contract.md`
on that repo): implement `TodoProvider` from `src/todos/types.ts`, manifest `kind: "todos"`,
register via `api.registerTodoProvider`. Storage stays in Shohin; this plugin holds no tables.

Epic: ExpansionX/WednesdayAI-plugins#12.

## Users / who is affected

| User | Impact |
|------|--------|
| **Administrator** | Configures `baseUrl`, one Shohin `shn_` user token per person and one organization token, all as secret-store references. No schema to migrate, no tables to back up: Shohin stays the system of record. |
| **Day-to-day user** | Tasks created by their agent appear on their own Shohin board, owned by their Shohin user. Personal work stays in their personal Shohin project; team work stays in organization projects. |
| **Developer / integrator** | Writes against `api.runtime.todos` once. Provider choice is a config line; the conformance suite (`runTodoProviderConformance`) is the compatibility contract. |

## Status: gated — not implementable on 2026-11-18

Every gate below was checked at this commit and **all seven fail**. The provider cannot be
written against emulation workarounds without breaking the outcome (see *Why no emulation*), so
implementation waits for the gates.

## Gates

| Gate | What must be true | Check (all must print the expected result) |
|---|---|---|
| G1 | A published `wednesdayai` (any dist-tag) contains the todos contract **and** the G2 conformance fix. Today the newest is `0.6.2-dev.65` (2026-11-13), predating core #2724 (2026-11-17); every core `npm-publish.yml` dev run since then failed with "The job was not started because recent account payments have failed or your spending limit needs to be increased" (ExpansionX GitHub Actions billing). | `V=$(npm view wednesdayai@dev version); curl -sL "$(npm view wednesdayai@$V dist.tarball)" \| tar xzO package/dist/plugin-sdk/testing.d.ts \| grep -c runTodoProviderConformance` ≥ 1. Record `V`. |
| G2 | Core conformance no longer assumes a permissive store (core issue F2). | `curl -sL "$(npm view wednesdayai@$V dist.tarball)" \| tar xzO --wildcards 'package/dist/*.js' \| grep -c 'projectId: "p1"'` = 0 (the literal-`p1` create is gone), and the same stream shows a `capabilities().tags`/`caps.tags` guard next to the `tag: "finance"` assertions. |
| G3 | Shohin #24 shipped with the consumer contract in F3: `create_task` accepts `idempotencyKey` (≤ 512 chars); a replay returns the stored task with `idempotentReplay: true`; a mismatched-payload replay either does the same or fails with code `IDEMPOTENCY_CONFLICT` and a `taskId` field in the envelope. | `git -C <Shohin> fetch -q && git -C <Shohin> grep -n idempotencyKey origin/main -- lib/mcp lib/work-planning-validation.ts` non-empty. |
| G4 | Shohin #83 shipped per F4: `assigneeAgentId: string \| null` on `TaskSummary`/`TaskDetail`, settable via `create_task`, `update_task`, `assign_task` on personal **and** organization projects, mutually exclusive with `assigneeId`. | `git -C <Shohin> grep -n assigneeAgentId origin/main -- types/work-planning.ts lib/mcp/tools/tasks.ts` non-empty. |
| G5 | Shohin issue F1 shipped: personal-project tasks accept any active, verified org member as `assigneeId`; `AssigneeOption` carries `email: string \| null`. | `git -C <Shohin> show origin/main:types/work-planning.ts` shows `email` on `AssigneeOption`; `lib/work-planning.ts` `assertAssigneeAllowed` no longer restricts personal projects to the owner. |
| G6 | Repo secret `SHOHIN_READ_TOKEN` (fine-grained PAT, `contents:read` on private ExpansionX/Shohin) exists on ExpansionX/WednesdayAI-plugins. | `gh secret list -R ExpansionX/WednesdayAI-plugins \| grep -c SHOHIN_READ_TOKEN` = 1. |
| G7 | ExpansionX GitHub Actions billing restored. | Latest run of `gh run list -R ExpansionX/WednesdayAI-core --workflow npm-publish.yml --limit 1` is not the "job was not started … payments" failure. |

Contingencies: if Shohin ships #85 option (a) (`blocked` status) before the status module is
written, include `blocked` in the status set and its edges from Shohin's `ALLOWED_TRANSITIONS`.
If #26 (task tags) or #25 (notes) ship before the provider module, map them natively and set the
matching capability flag to `true`; otherwise flags stay `false`. If Shohin names any G3–G5
field differently, use Shohin's names and update this spec in the same commit.

### Gate status at 2026-11-18 (origin/main 29181b6; Shohin origin/main 2a2c644; core origin/main 534cf6bd9b)

| Gate | Result | Evidence |
|---|---|---|
| G1 | **fail** | `npm view wednesdayai dist-tags` → `latest 0.6.1` (2026-11-12), `dev 0.6.2-dev.65` (2026-11-13). Both predate the core todos merge (`4f92ffaf55`, 2026-11-17). Tarball of `0.6.2-dev.65` has no `todos` entry and `package/dist/plugin-sdk/testing.d.ts` has no `runTodoProviderConformance`. |
| G2 | **fail** | Blocked by G1; the fix (F2) is not filed-and-shipped yet. |
| G3 | **fail** | `git grep idempotencyKey origin/main -- lib/mcp lib/work-planning-validation.ts` → empty (Shohin #24 open). |
| G4 | **fail** | `git grep assigneeAgentId origin/main -- types/work-planning.ts lib/mcp/tools/tasks.ts` → empty (Shohin #83 open). |
| G5 | **fail** | `types/work-planning.ts:45-48` — `AssigneeOption = { id: string \| null; label: string }`, no `email`. |
| G6 | **fail** | `gh secret list -R ExpansionX/WednesdayAI-plugins` → only `NPM_TOKEN`. |
| G7 | **fail** | Latest `npm-publish.yml` run (2026-11-18T03:13:51Z) concluded `failure`; job annotation: "The job was not started because recent account payments have failed or your spending limit needs to be increased." |

## MCP consumer contract (what the provider will call)

Shohin's only bearer-token surface is `POST {baseUrl}/api/mcp` (`app/api/mcp/route.ts`;
`Authorization: Bearer shn_…`, stateless Streamable HTTP, SSE-framed JSON-RPC). Every REST
handler uses `requireMember()` (NextAuth cookie session), so the plugin speaks MCP, not REST.
Envelope: success `{ success: true, data }`, failure `{ success: false, code, error }` with
`isError` (`lib/mcp/envelope.ts`).

Tools used: `list_tasks`, `get_task`, `create_task`, `update_task`, `transition_task`,
`reopen_task`, `list_projects`, `create_project`, `list_assignees`. Never `delete_task` or
`delete_project` (ADR 2245: nothing is deleted).

### Per-gate argument and response contract

**G3 — `create_task` idempotency (Shohin #24)**

- Argument: `idempotencyKey?: string`, accepted up to **512** characters. Core namespaces the
  caller's key before the provider sees it (`JSON.stringify(["person", ownerPerson, key])`,
  `["agent", agentId, key]`, `["operator", key]`), so keys reach ~260 characters in practice;
  512 is the headroom the provider needs.
- Dedupe scope: acting member + entity kind (per Shohin #24), which matches the contract because
  the provider always calls with the owner's principal.
- Replay response: the originally created task, plus `idempotentReplay: true` on the create
  result. The provider maps that to `{ todo, created: false }` and performs no further writes.
- Mismatched-payload replay: either the same replay response, or failure code
  `IDEMPOTENCY_CONFLICT` with a `taskId` field in the envelope; the provider then reads
  `get_task({ taskId })` and returns `{ todo, created: false }`. Both shapes satisfy the
  contract's "a repeated create with the same `idempotencyKey` returns the existing todo".

**G4 — agent assignee (Shohin #83)**

- Field: `assigneeAgentId: string | null`, free text, on `TaskSummary` and `TaskDetail` (so it
  comes back from `list_tasks` and `get_task`).
- Settable via `create_task`, `update_task` and `assign_task`, on **personal and organization**
  projects.
- Mutually exclusive with `assigneeId`: setting one clears the other in the same call. This is
  exactly `Todo.assigneePerson` XOR `Todo.assigneeAgent`.

**G5 — personal-project delegation and assignee email (F1)**

- `list_assignees` options gain `email: string | null` (`null` for the synthetic *Unassigned*
  option). The provider maps a WednesdayAI person → configured Shohin email → Shohin `userId`;
  without `email` the only identifier is `label`, which is `name ?? email`
  (`lib/work-planning.ts` `assigneeLabel`), so a named user is unresolvable.
- `assign_task` / `update_task` / `create_task` accept any active, verified organization member
  as `assigneeId` on a personal-project task; the assignee can `get_task` / `list_tasks` that
  row without gaining access to the rest of the personal project. Organization tokens still
  never see personal data.

**Error-code mapping consumed from `lib/work-planning-http.ts` / `lib/mcp/envelope.ts`**

| Shohin code | Provider behaviour |
|---|---|
| `NOT_FOUND` | `null` (get/update/addNote/getProject) or `TodoError("not-found")` |
| `INVALID_TRANSITION`, `UNRESOLVED_PREREQUISITES`, `INCOMPLETE_SUBTASKS`, `ASSIGNEE_NOT_ALLOWED`, validation codes | `TodoError("invalid-input", "Shohin: <error>")` |
| `IDEMPOTENCY_CONFLICT` (G3) | read `taskId`, return `{ todo, created: false }` |
| anything else | `Error("Shohin <tool> failed: <code>: <error>")` |

## Decisions (contract ↔ Shohin mapping)

| Contract | Shohin (MCP) | Rule |
|---|---|---|
| status `backlog,todo,in_progress,in_review,done,cancelled` | `backlog,todo,in-progress,in-review,done,cancelled` | underscore↔hyphen; `blocked` excluded from `capabilities().statuses` (Shohin #85 option b) |
| status set | `transition_task`, `reopen_task` | BFS over Shohin `ALLOWED_TRANSITIONS` (`types/work-planning.ts:26-33`); from `done`/`cancelled` first `reopen_task` (lands in `todo`), then walk. Create uses initial `backlog` if target is `backlog`, else `todo`, then walks. |
| `completedAt` | native (set on terminal entry, cleared by reopen) | pass through |
| `ownerPerson` | project kind | task in P's personal project → P; organization project → `null` |
| `projectId` | `projectId` (required in Shohin) | omitted → default project for the owner (below); given → must belong to the owner (personal of P, or organization project when owner is `null`), else `TodoError("invalid-input")`; unknown → `TodoError("not-found","Project not found.")`; patch to a different project → `TodoError("unsupported")` (Shohin has no cross-project move) |
| default project | `create_project` | P: `defaultProjectByPerson[P]` (must be P's personal project) else P's personal project named `WednesdayAI Tasks`, created on first use (kind `personal`, via P's token). `null`: `defaultOrgProjectId` else organization project named `WednesdayAI Tasks` (kind `internal`, via org token). Single-flight per owner per provider instance. |
| `assigneePerson` | `assigneeId` | write: person → configured email → userId from `list_assignees({})` (org token) matched on lowercased `email` (G5); unknown → `TodoError("unknown-assignee")`. read: `assignee.email` → configured person; unmapped Shohin user → `undefined` |
| `assigneeAgent` | `assigneeAgentId` (G4) | 1:1; XOR enforced by Shohin |
| `idempotencyKey` | `idempotencyKey` (G3) | pass the service-namespaced key verbatim; replay → `created: false`, no further writes |
| `priority`, `title`, `description` | same | 1:1; Shohin `description: null` → omitted |
| `dueAt` | `dueDate` | write verbatim (Shohin accepts date-only and offset datetimes); read: value equal to `YYYY-MM-DDT00:00:00.000Z` → `YYYY-MM-DD`, else ISO string |
| `tags` | none (#26 open) | `capabilities().tags = false`; non-empty `tags` on create/update → `TodoError("unsupported","Shohin does not store task tags (ExpansionX/Shohin#26).")`; `list({tag})` → empty page |
| notes | none (#25 open) | `capabilities().notes = false`; `addNote` → `null` for missing todo, else `TodoError("unsupported","Shohin has no task notes (ExpansionX/Shohin#25).")`; `listNotes` → `[]` |
| `links` | none (#84 open) | dropped on write (debug log once per call), `[]` on read; README "Known limitations". Not rejected: inbox convert-to-task always sends links (`extensions/inbox/src/convert-to-task.ts`). |
| `createdBy` | none | always `{ kind: "system", id: "shohin" }` |
| `providerUrl` | web route | `${baseUrl}/dashboard/tasks/${id}` |
| `TodoProject.archived` | project `status` | `status === "completed"` |
| token per call | — | rows of P → P's token; `ownerPerson: null` rows and org projects → org token |
| errors | envelope `{success:false, code, error}` | `NOT_FOUND` → `null`/`not-found` per method; `INVALID_TRANSITION`, `UNRESOLVED_PREREQUISITES`, `INCOMPLETE_SUBTASKS`, `ASSIGNEE_NOT_ALLOWED`, any zod/validation code → `TodoError("invalid-input", "Shohin: <error>")`; anything else → plain `Error("Shohin <tool> failed: <code>: <error>")` |

## Why no emulation

The cheap-looking alternative — hiding contract fields Shohin lacks (idempotency keys, agent
assignee, tags, links) in the task description or title — was rejected:

- it writes machine noise into a shipped product's user-visible task text, which every Shohin
  user sees on their board;
- lookup-before-create dedupe over a remote with no unique key is at-least-once under races, so
  the contract's idempotent-create obligation would be a lie;
- the markers would have to be parsed back on every read, making "Shohin is the system of
  record" false in practice.

Native parity (G3–G5) keeps the plugin thin, the data clean, and the contract honest.

## Non-goals

- Work Tracker import (core's `todos-local`, epic #2712).
- Shohin schema/behaviour changes (filed as Shohin issues; linked, not done here).
- MondayDev cutover (separate MondayDev epic).

## Findings filed alongside this spec

| Ref | Repo | Subject |
|---|---|---|
| F1 | ExpansionX/Shohin#87 | personal-project delegation + `email` on `AssigneeOption` (G5) |
| F2 | ExpansionX/WednesdayAI-core#2750 | todos conformance assumes a permissive store (G2) |
| F3 | ExpansionX/Shohin#24 (comment) | idempotency consumer contract (G3) |
| F4 | ExpansionX/Shohin#83 (comment) | agent-assignee consumer contract (G4) |
| — | ExpansionX/Shohin#88 | server-side `list_tasks` filters/pagination (backlog) |
| — | ExpansionX/Shohin#89 | cross-project task move (backlog) |
| — | ExpansionX/Shohin#90 | task creator attribution (backlog) |
| — | ExpansionX/Shohin#91 | scripted test-organization provisioning (backlog) |
