<!--
  TAM Intelligence OS — Pull Request
  Fill in every section. PRs that touch business logic, storage, or schema without the
  confirmations below will not be merged. Never commit real company data.
-->

## Summary
<!-- What does this PR do and why? One or two paragraphs. -->

## Scope
<!-- What is intentionally in-scope and out-of-scope for this change? -->

## Files changed
<!-- List the key files and the nature of each change. -->

## Business logic changed?
- [ ] No business logic changed (docs / tooling / infra only)
- [ ] Yes — describe exactly what changed and why:

## Storage / schema changed?
- [ ] No storage key, migration flag, or `SCHEMA_VERSION` change
- [ ] Yes — an intentional migration (describe below, bump `SCHEMA_VERSION`, add migration + flag):

## Build result
<!-- Paste the output of: node tools/build-single-file.js -->
```
```

## Verify result
<!-- Paste the last line of: node tools/verify-build.js  (expect "VERIFICATION PASSED") -->
```
```

## Browser QA
<!-- Which pages/workflows did you exercise, in modular AND dist? What did you observe? -->
- Modular source:
- Portable dist:

## Regression testing
<!-- Confirm previously-working features still work (payroll, overtime, execution, import,
     dedup, backup/restore, activity log, settings). -->

## Screenshots
<!-- Sanitized only — redact real names/amounts. -->

## Risks
<!-- What could this break? Blast radius? -->

## Rollback plan
<!-- How do we revert if this ships and misbehaves? (e.g. revert commit, restore prior dist tag) -->

## Checklist
- [ ] `node tools/build-single-file.js` succeeds
- [ ] `node tools/verify-build.js` passes (all checks)
- [ ] Modular source boots with **zero console errors**
- [ ] Portable dist boots with **zero console errors**
- [ ] The `dist/` portable HTML is rebuilt and committed
- [ ] `CHANGELOG.md` (and `RELEASE_NOTES.md` for a release) is updated
- [ ] `SCHEMA_VERSION` is unchanged (or an intentional, documented migration)
- [ ] Storage keys and migration flags are unchanged (or an intentional, documented migration)
- [ ] No real employee / company / payroll / bank / backup data is committed
- [ ] Documentation (README / ARCHITECTURE) updated where behavior or structure changed
