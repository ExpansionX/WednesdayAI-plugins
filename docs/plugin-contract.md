# Plugin Contract

Each `plugins/<id>/` directory in this repo MUST contain:

## Required files

### 1. `openclaw.plugin.json` — manifest

- `id` (string) — MUST equal the directory name AND the npm package name (minus the `@wednesdayai/` scope).
- `name` (string) — human-readable name.
- `description` (string) — one-line description.
- `configSchema` (typebox schema) — configuration keys accepted by this plugin. No `Type.Union`, `anyOf`, `oneOf`, `allOf`. Use `stringEnum`/`optionalStringEnum` for enumerations. Never use `format` as a raw property name.

Optional fields:

- `kind` — core `PluginKind` (currently only `"memory"`). This is NOT the catalog category; see [`docs/catalog-kind.md`](./catalog-kind.md) for how the catalog `kind` is derived. Do not overload them.
- `version` — defaults to `package.json` version.
- `minHostVersion` — minimum WednesdayAI-core version.
- `channels`, `providers`, `skills`, `sessionConsumers`, `uiHints` — capability declarations.

### 2. `package.json`

- `"name"`: `"@wednesdayai/<id>"` — scope + id MUST match the directory name.
- `"type"`: `"module"`.
- `"version"`: SemVer (release-please manages bumps).
- `"private"`: `false` (must be publishable).
- `"publishConfig"`: `{"access": "public"}`.
- No `workspace:*` in `dependencies` (breaks `npm install --omit=dev` in plugin dirs).
- No runtime dep on `wednesdayai` / `openclaw` in `dependencies` — put it in `devDependencies` or `peerDependencies` if needed for types.

### 3. `index.ts` (or `index.js`)

Default-exports an `OpenClawPluginDefinition` with a `register(api: OpenClawPluginApi)` function. The `register` function calls `api.registerChannel(...)`, `api.registerWebSearchProvider(...)`, `api.on(...)`, etc. to wire the plugin's capabilities.

### 4. `README.md`

User-facing docs: config keys, capabilities, install command (`wednesdayai plugins install <id>`).

### 5. `LICENSE`

MIT (copy from repo root).

### 6. `skills/` (optional)

If present, each `*.md` file carries SKILL frontmatter (`name`, `description` required).

## Rules

- **Plugin id ↔ directory name ↔ npm package name MUST match exactly.** (AGENTS.md §4)
- **No `workspace:*` in plugin `dependencies`.** (AGENTS.md §4)
- **No runtime dep on `wednesdayai` / `openclaw`** in `dependencies`. (AGENTS.md §4)
- **No `Type.Union`/`anyOf`/`oneOf`/`allOf` in configSchema.** (AGENTS.md §5)

## Reference implementation

`plugins/brave-search/` (added by task 005) is the reference implementation of this contract.
