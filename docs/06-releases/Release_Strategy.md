# Release Strategy

This document describes how TAM Intelligence OS is versioned and shipped. It is strategy and flow; the
enforceable rules are the [Release Standard](../04-standards/Release_Standard.md) and the concrete
procedure is [`docs/RELEASE-PROCESS.md`](../RELEASE-PROCESS.md).

## Versioning philosophy

- **Semantic-style `MAJOR.MINOR.PATCH`.** Patch for fixes, minor for backward-compatible features,
  major for breaking changes.
- **Single source of truth.** `APP_VERSION` and `APP_RELEASE_NAME` are defined once in the source
  constants. The build derives the portable filename and identity from them; nothing is hardcoded in
  tooling.
- **Schema version is independent.** `SCHEMA_VERSION` tracks the stored-data shape and bumps **only**
  for a deliberate, guarded data migration — never in step with the app version.
- **History is immutable.** Past changelog and release entries are never rewritten; only
  forward-looking pointers move to the latest release.

## Release flow

1. **Propose.** Present a Release Candidate — the intended version, release name, and the built
   portable artifact — and obtain explicit approval (`CLAUDE.md` §20). Releases are proposed, never
   published directly.
2. **Prepare.** Ensure the source version is set once in constants, the portable build is regenerated
   from source, and the verifier passes completely.
3. **Tag.** Publishing is triggered by a version tag. Automation refuses to publish unless the tag
   equals the source version and the portable build exists.
4. **Publish.** The guarded workflow creates the release and attaches the single-file asset. The step
   is idempotent — re-running creates no duplicate release and corrupts no asset.
5. **Record.** Update the forward-looking pointers (README, release notes); leave historical entries
   intact.

## Release checklist

- [ ] `APP_VERSION` / `APP_RELEASE_NAME` set once in source constants; no hardcoded version in tooling.
- [ ] Portable build regenerated from source and committed with it.
- [ ] Verifier passes completely; CI and CodeQL green; no new alerts.
- [ ] Both artifacts boot with zero console errors; data persists; no duplicates.
- [ ] Release Candidate approved.
- [ ] Version tag equals the source version; guarded workflow publishes idempotently.
- [ ] Changelog/release notes updated; historical entries untouched.

## Hotfix flow

A hotfix is a minimal, targeted fix for a shipped release:

1. Branch from the released state (`fix/<name>`).
2. Make the smallest correct change; regenerate the build; pass the verifier and runtime checks.
3. Increment the **patch** version in source constants.
4. Follow the standard release flow to propose, tag, and publish.

A shipped release is never rewritten. Corrections always go forward into a new patch version or a
documentation-only follow-up, never by editing an existing tag, release, or asset.
