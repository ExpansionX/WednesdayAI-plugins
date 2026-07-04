# Contributing to WednesdayAI Plugins

This repo follows [WednesdayAI-core's conventions](https://github.com/ExpansionX/WednesdayAI-core/blob/main/AGENTS.md).

## Plugin versioning

Each plugin in `plugins/<id>/` versions independently via per-plugin SemVer (ADR 0028 §4). Release-please manages tags (`<id>-v<semver>`) and CHANGELOGs per plugin.

## Adding a plugin

1. Create `plugins/<id>/` with the layout from [`docs/plugin-contract.md`](./docs/plugin-contract.md).
2. Ensure `openclaw.plugin.json` is valid (CI validates structure).
3. Add tests colocated with source.
4. Open a PR — CI validates the manifest, regenerates `catalog.json`, and checks the plugin typechecks.

## Release flow

Release-please opens a Release PR when changes land on `main`. Merging it creates a tag (`<id>-v<semver>`) which triggers npm publish. See [`docs/publishing.md`](./docs/publishing.md).
