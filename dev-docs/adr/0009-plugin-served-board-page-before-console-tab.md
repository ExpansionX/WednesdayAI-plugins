---
doc_type: adr
id: 0009
workstream: shohin
title: "ADR-0009: Plugin-served board page first; console tab via two core seams later"
status: accepted
created: 2026-09-03
---

# ADR-0009: Plugin-served board page first; console tab via two core seams later

## Context

WednesdayAI's control UI is a Lit application compiled into core with a hard-coded tab list. There is no plugin UI slot, and the gateway's WebSocket event list is fixed, so the UI ignores events it does not know. Plugins can register gateway RPC methods and can serve arbitrary HTTP under `registerHttpRoute` with gateway-token auth. The superseded web UI split design of 2026-05-25 named "cockpit plugin architecture and permission model" as future work, and the brand design system has since shipped.

The operator asked whether the console rebuild must come first. Upstream OpenClaw solved the same problem with a `registerControlUiDescriptor` API (tab and widget surfaces, optional sandboxed iframe path) and a `plugin.<id>.*` event namespace.

## Decision

1. **Phase 3 ships a board page served by the plugin** at a plugin HTTP route with `auth: "gateway"`, built with the console's design system and the `@openclaw/gateway-client` browser client. It opens its own WebSocket to the gateway and calls `shohin.*` RPCs. Plugin gateway methods are request and response only, so the page reads the journal through `shohin.events.tail`, a cursor poll shaped like core's `logs.tail` (`{ cursor, limit } → { events, cursor }`). Nothing streams before Phase 7. Until the Phase 7 scope seam, every `shohin.*` method is `operator.admin`, so the page runs with an admin token; acceptable for a single operator, recorded as a limitation. It has five screens: board, item detail, run log tail, attention inbox, chat into a persona (which reuses the existing `chat.send` and `chat.history` RPCs against the persona's session).
2. **The page's components are written to be relocatable**: no dependency on their route, state held in a store fed by the journal cursor, and no direct DOM coupling to the shell.
3. **Phase 7 adds three seams to core, each with its own core ADR**: a plugin tab descriptor cherry-picked in spirit from upstream's `PluginControlUiDescriptor` (tab surface only, no iframe in the first cut); a passthrough that forwards `plugin.<id>.*` events to UI clients holding `operator.read`; and a scope argument on `registerGatewayMethod` so plugin reads can be `operator.read`. The board then moves into the console as a tab and replaces the cursor poll with the event passthrough.
4. **The console rebuild is not a prerequisite.** It is a workstream the factory runs after Phase 3, with the Shohin page as its first real customer.

## Rationale

- The factory needs five screens, not a console. Serving them from the plugin costs nothing in core and produces a working loop months earlier.
- Building the seams after the page exists means the seam is designed against a real consumer, not a guess.
- Relocatable components make the Phase 7 move a mount change, not a rewrite.
- The gateway client and design system already exist; the page adds no frontend stack.

## Consequences

- Positive: zero core changes before Phase 7.
- Positive: the page can be served to a phone or a second monitor independently of the console.
- Negative: until Phase 7 the operator has two URLs. Acceptable.
- Negative: the journal cursor poll is a stand-in for the event passthrough and will be replaced in Phase 7; it must be small, and the poll interval is a page setting, not a kernel concern.
- Negative: the page must handle gateway reconnects and cursor resume itself, which the console shell would otherwise provide. The journal tail takes a cursor for exactly this reason.

## Alternatives considered

- **Console rebuild first.** Months of UI work before any loop exists, and requirements guessed rather than observed.
- **Hand-wire a tab into core the way `learning` was.** Fast but repeats the pattern the split design called out as unsustainable, and puts Shohin UI code in core.
- **Reuse the MondayDev admin v3 board.** React and Bun in a different repo, coupled to `wt_*` tables and MondayDev auth. Its layouts and Moon design language are borrowed as reference only.
