# WednesdayAI Plugins

Public plugin monorepo for [WednesdayAI](https://github.com/ExpansionX/WednesdayAI-core).

Plugins are npm packages (`@wednesdayai/<id>`) discovered via the published [`catalog.json`](./catalog.json) and installable with `wednesdayai plugins install <id>`.

See [`docs/plugin-contract.md`](./docs/plugin-contract.md) for the per-plugin layout and manifest schema.

## Versioning

Each plugin versions independently via per-plugin SemVer (ADR 0028 §4). Release-please manages tags and CHANGELOGs per plugin.
