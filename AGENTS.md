# WednesdayAI Plugins — Agent & Contributor Guidelines

## Fork Identity

- **Repo**: https://github.com/ExpansionX/WednesdayAI-plugins
- **Purpose**: Community plugin/extension monorepo for WednesdayAI. Extensions ship bundled; plugins are npm-installable.
- **Product name**: use **WednesdayAI** in docs, headings, and user-facing text.

## Tech Stack

| Layer | Tool |
|-------|------|
| Runtime | Node.js >= 24 (ESM) |
| Language | TypeScript, strict, ESM |
| Package manager | pnpm 10.23+ |
| Linter | Oxlint |
| Formatter | Oxfmt |
| Tests | Vitest v4 + V8 coverage |
| Plugin SDK | `wednesdayai/plugin-sdk` (workspace-linked in dev) |

## Plugin/Extension Structure

```
extensions/<id>/           or  plugins/<id>/
  openclaw.plugin.json       Plugin manifest (id, configSchema, uiHints)
  package.json                @wednesdayai/<id>, private, type: module
  index.ts                    Entry: export default { register(api) { ... } }
  src/                        Implementation + colocated *.test.ts
```

- Extensions import from `wednesdayai/plugin-sdk`, never from relative paths into core.
- Put `wednesdayai` in `devDependencies` or `peerDependencies`.
- Never use `workspace:*` in `dependencies`.
- Plugin directory names and npm package names must match the plugin id exactly.

## Coding Style

- TypeScript ESM, `strict: true`. No `@ts-nocheck`. No `any` without justification.
- Functional + module pattern dominant. Classes for stateful lifecycle managers.
- Use `createSubsystemLogger` for logging (from `wednesdayai/plugin-sdk`).
- File size: aim < 500 LOC; split when it aids clarity or testability.
- Colocated tests: `*.test.ts` next to source.

## Build & Development

```bash
pnpm install
pnpm build          # per-plugin build
pnpm test           # per-plugin tests
pnpm lint           # oxlint
pnpm format:fix     # oxfmt --write
```

## Installing for Local Testing

```bash
cp -r extensions/<id> ~/.openclaw/extensions/
cd ~/.openclaw/extensions/<id>
npm install --omit=dev
wednesdayai gateway restart --deep
```

## Commit Guidelines

- Conventional Commit messages: `type(scope): action` (e.g. `feat(skillweaver): add SAD pipeline`).
- Group related changes; don't bundle unrelated refactors.
- Run `pnpm lint` and `pnpm test` before committing.

## Security

- Never commit real API tokens or live config values.
- Use obviously fake placeholders for credentials.
- Plugin config validation should reject dangerous inputs.
- Prompt injection surfaces in plugins must sanitize user input.
