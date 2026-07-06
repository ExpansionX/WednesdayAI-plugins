# WednesdayAI Plugins

Community plugins for the WednesdayAI agent platform.

## Repository Structure

```
plugins/         Individual plugin packages (one directory per plugin)
docs/            Plugin documentation
  superpowers/
    specs/       PRD and spec docs (WAI workstream artifacts)
dev-docs/        Engineering record
  workstreams/   Per-workstream trackers
```

## Creating a Plugin

Each plugin lives in `plugins/<plugin-id>/` with:

```
plugins/<plugin-id>/
  package.json       # name: @wednesdayai-plugins/<plugin-id>
  openclaw.plugin.json  # Plugin manifest
  src/
    index.ts         # Plugin entry: export default { register(api) { ... } }
```

## Development

Plugins import from `wednesdayai/plugin-sdk` (workspace-linked during development).

## Related

- [WednesdayAI-core](https://github.com/ExpansionX/WednesdayAI-core) — the main agent runtime
- [WednesdayAI docs](https://docs.wednesdayai.dev) — plugin development guide