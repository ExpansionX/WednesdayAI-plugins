# Publishing

Plugins are published to npm automatically via GitHub Actions when a release-please Release PR is merged.

## Release flow

1. Changes land on `main` (via PR merge).
2. [release-please](https://github.com/googleapis/release-please) detects changes in `plugins/<id>/` and opens a Release PR for that plugin.
3. Merging the Release PR creates a tag `<id>-v<semver>` and updates the plugin's `CHANGELOG.md`.
4. The `publish.yml` workflow triggers on the tag and runs `npm publish --access public` in `plugins/<id>/`.

## Secrets

- `NPM_TOKEN` — npm automation token for publishing. Add under repo Settings → Secrets and variables → Actions.

## Must-bump-on-touch

Release-please bumps the version of any plugin whose files changed since the last release. A docs-only commit inside `plugins/<id>/` still triggers a patch bump. This is intentional — it keeps the npm package in sync with the repo state.
