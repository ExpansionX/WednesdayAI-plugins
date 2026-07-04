# Catalog `kind` derivation

The `catalog.json` `kind` field is a **category string** used by the CLI to group plugins in `plugins list` output. It is NOT the same as the manifest `kind` field (which is `PluginKind`, currently only `"memory"`).

## Derivation mapping (implemented by `scripts/generate-catalog.mjs` in task 003)

The CI catalog generator DERIVES the catalog `kind` from the plugin's manifest capabilities:

| Condition | Catalog `kind` |
| --- | --- |
| `manifest.channels` is non-empty | `"channel"` |
| `manifest.providers.webSearch` is truthy | `"web-search"` |
| `manifest.kind === "memory"` | `"memory"` |
| (otherwise) | `"misc"` |

## Why not copy manifest `kind`?

The manifest `kind` field is `PluginKind` — a core type that currently only allows `"memory"`. Overloading it as the catalog category would break when new `PluginKind` values are added and would prevent non-memory plugins from having a meaningful category.

The catalog `kind` is a display concern; the manifest `kind` is a runtime concern. They are different things and MUST NOT be conflated.

## Adding a new category

If a new provider type (e.g. `providers.imageGen`) is added to the manifest, add a new mapping row here and in `generate-catalog.mjs`. The `else → "misc"` catch-all ensures unknown plugins still appear in the catalog.
