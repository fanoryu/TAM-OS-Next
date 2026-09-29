<!--
  TAM Intelligence OS — release notes template.
  Copy this into RELEASE_NOTES.md for each release and fill in every section.
  Do not invent changes — describe only what actually shipped and was verified.
-->

# TAM Intelligence OS vX.Y.Z — <Release Name>

**Release Name:** <Release Name>

## Summary
<!-- One short paragraph: what this release is and why it exists. -->

## Highlights
<!-- 2–5 bullet points a reader should take away. -->
- <highlight>

## Added
- <new capability, or "None">

## Changed
- <behavior/structure change, or "None">

## Fixed
- <bug fix, or "None">

## Security
- <security-relevant change, or "None">

## Compatibility
<!-- Who/what is affected. This app is client-only with local storage. -->
- Runs in the browser from the static deployment package, served over HTTP; no backend.
- Existing local data: <fully compatible | migrated — see Migration>
- `SCHEMA_VERSION`: <unchanged (6) | X → Y>

## Data Safety
- SCHEMA_VERSION: <unchanged (6) | migrated X → Y with migration + flag>
- Storage keys / migration flags: <unchanged | describe>
- Backup format: <unchanged | describe>
- <any data-safety notes>

## Migration
<!-- Required only if SCHEMA_VERSION changed or storage keys/flags changed. -->
- <"None — no schema/storage change" | migration steps, new flag name, and rollback note>

## QA
<!-- Distinguish: browser-tested / automated-test verified / source-inspected / unable to verify -->
- Build: <result>
- Verify: <N/N checks>
- Browser (served package, production headers): <what was exercised>
- CSP violations: <count>
- Console errors: <count>

## Regression
- <features re-tested and their results>

## Known Limitations
- <honest limitations / out-of-scope items>

## Git Information
- Commit: <hash>
- Tag: vX.Y.Z
- Branch: main

## Release Assets
- tam-os-vX.Y.Z-package.zip
- package-manifest.json

## Checksum
<!-- The committed dist/package-manifest.json records the ZIP SHA-256 and every file's SHA-256;
     the release workflow refuses to publish a ZIP that does not match it. -->
- ZIP SHA-256: <zip.sha256 from package-manifest.json>
- Package digest: <packageDigest from package-manifest.json>
