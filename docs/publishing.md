# Publishing

Plugins are published to npm automatically via GitHub Actions when a release-please Release PR is merged.

## Release flow

1. Changes land on `main` (via PR merge).
2. [release-please](https://github.com/googleapis/release-please) detects changes in `plugins/<id>/` and opens a Release PR for that plugin.
3. Merging the Release PR creates a tag `<id>-v<semver>` and updates the plugin's `CHANGELOG.md`.
4. The `release.yml` workflow — the only release workflow, because tags made by release-please never trigger other workflows — builds `plugins/<id>/` and runs `npm publish --provenance --access public`, authenticating via npm trusted publishing (OIDC) in the protected `npm-publish` environment.
5. `release.yml` then verifies the published artifact's SLSA provenance (signed by `release.yml@refs/heads/main`) and commits the pinned entry (`version` + sha512 `integrity`) back to `catalog.json` as `github-actions[bot]`.

## Publishing credentials

There is no `NPM_TOKEN`. Publishing authenticates with npm trusted publishing (OIDC): the npm package must list this repo's `.github/workflows/release.yml` as a trusted publisher, and the publish job runs in the protected `npm-publish` GitHub environment. `--provenance` attaches the SLSA attestation that `scripts/verify-provenance.mjs` checks after every publish.

## Must-bump-on-touch

Release-please bumps the version of any plugin whose files changed since the last release. A docs-only commit inside `plugins/<id>/` still triggers a patch bump. This is intentional — it keeps the npm package in sync with the repo state.
