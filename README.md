# WednesdayAI Plugins

Community plugin/extension monorepo for [WednesdayAI](https://github.com/ExpansionX/WednesdayAI-core).

## Repository Structure

```
extensions/       Bundled extension packages (discovered by the gateway)
  skillweaver/    SkillWeaver — compositional skill routing
plugins/          Unbundled plugin packages (npm-installable)
  brave-search/
  example/
  lifecycle-fixture/
docs/             Documentation
  plugin-contract.md   Per-plugin layout and manifest schema
dev-docs/         Engineering record (ADRs, workstreams, logs)
```

## Creating a Plugin/Extension

Each plugin lives in `extensions/<id>/` or `plugins/<id>/` with:

```
<id>/
  openclaw.plugin.json   Plugin manifest
  package.json            npm package: @wednesdayai/<id>
  index.ts                Entry point: export default { register(api) { ... } }
  src/                    Implementation
```

Plugins import from `wednesdayai/plugin-sdk` (workspace-linked during development).

## Installing a Plugin

Bundled extensions (`extensions/`) are shipped with WednesdayAI. Plugins (`plugins/`) are installed via:

```bash
wednesdayai plugins install <id>
```

For local development, copy to `~/.openclaw/extensions/<id>/` and restart the gateway.

## Versioning

Each plugin versions independently via per-plugin SemVer (ADR 0028 §4). Release-please manages tags and CHANGELOGs per plugin.

See [`docs/plugin-contract.md`](./docs/plugin-contract.md) for the full manifest schema and layout rules.
