# Release Standard

A release publishes a version to users. Releases are proposed, never published directly, and are
tag-driven, guarded, and idempotent. The full strategy is in
[`docs/06-releases/Release_Strategy.md`](../06-releases/Release_Strategy.md); the step-by-step
procedure is [`docs/RELEASE-PROCESS.md`](../RELEASE-PROCESS.md). This standard states the rules.

## Rules

- **Proposed, not published.** Present a Release Candidate and obtain explicit approval before any
  release action (`CLAUDE.md` §20).
- **Version is derived, single-sourced.** `APP_VERSION` / `APP_RELEASE_NAME` live once in the source
  constants; the tooling derives the output filename and identity. Never type a version into tooling.
- **Tag-driven and guarded.** Publishing is triggered by a version tag; automation refuses to publish
  unless the tag equals the source version and the portable build exists.
- **Idempotent.** Re-running a release must not create duplicate releases or corrupt the asset.
- **Immutable once shipped.** A published tag, release, and asset are never rewritten; corrections go
  into a new version or a documentation-only follow-up.
- **Least privilege.** CI/release workflows use official actions only and the minimum permissions
  required; version/tag guardrails are never weakened.

## Versioning

Semantic-style `MAJOR.MINOR.PATCH`: patch for fixes, minor for backward-compatible features, major for
breaking changes. `SCHEMA_VERSION` is independent of `APP_VERSION` and bumps only for a real data
migration. Historical changelog and release entries are immutable; only forward-looking pointers track
the latest release.

## What does not trigger a release

Implementation and documentation PRs (such as PR-5D through PR-5F and DOC-001) do **not** change the
version and do **not** trigger the release workflow. A release is its own separately-authorized event.
