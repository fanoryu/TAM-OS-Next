# TAM OS v2.10.0 — Pilot Rollback Plan

**Scope:** what to do when the v2.10.0 pilot fails, misbehaves, or must be abandoned.
**Audience:** the pilot maintainer, with steps 1–3 written so an operator can follow them alone.

---

## Why rollback is viable for this release — and the limits of that claim

v2.10.0 changes **no persisted data shape**. Verified in source, not assumed:

- `SCHEMA_VERSION` is **6** in `js/core/constants.js`, unchanged from v2.9.0.
- No storage key was added, renamed, removed or repurposed.
- No migration runs as part of this release, and no migration flag was introduced.
- The Complete Backup payload records `schemaVersion: 6`, and the backup validator accepts it.

**Therefore:** a Complete Backup exported from v2.9.0 restores into v2.10.0, and a Complete Backup
exported from **v2.10.0 restores back into v2.9.0**, because both read and write the same schema 6
shape. This is what makes application-level rollback possible at all.

**The limits of that claim — read these before relying on it.**

1. **Rollback is only as good as your last backup.** Nothing here recovers data created after your
   most recent export. There is no undo log and no server-side copy. If no backup exists, there is
   no rollback — only whatever is still in the browser profile.
2. **Backup/restore is the supported path; copying browser storage is not.** Do not attempt to move
   `localStorage` between profiles by hand.
3. **The schema-6 compatibility claim covers v2.9.0 ↔ v2.10.0 only.** It says nothing about older
   artifacts (v2.8.x and earlier), which predate schema 6 in parts and may trigger forward
   migrations that are **not reversible**. Never roll back past v2.9.0 with pilot data. If that is
   ever needed, stop and treat it as a data-migration exercise, not a rollback.
4. **Restoring replaces everything.** It is not a merge. Anything in the app at restore time that is
   not in the backup file is gone (the app does take its own safety copy first — see step 2).

---

## Rollback triggers

Roll back if any of these occur:

- Data loss, data corruption, or records that silently changed.
- An employee can see another employee's identity, salary or records.
- Payroll or finance figures are wrong, or committed/posted values changed after the fact.
- The application fails to load, or errors repeatedly during normal work.
- Any behaviour that would make the pilot's output untrustworthy.

For the first two, also treat it as a **security/privacy incident** and follow
[`SECURITY.md`](../../SECURITY.md) — report privately, never in a public issue.

---

## Procedure

### Step 1 — Stop
Stop using v2.10.0 immediately. Do **not** enter more data, do not "work around" it,
and do not attempt repairs by hand. Tell the pilot maintainer.

**Do not clear browser data, and do not uninstall or clean the browser profile.** Whatever is still
in storage is evidence and may be recoverable.

### Step 2 — Preserve the current state
Before restoring anything, capture what you have *now*, however broken it looks.

1. Settings → Data Portability → **Export Complete Backup (JSON)**.
2. Save it with a clearly distinct name, e.g. `INCIDENT-2026-08-11-before-rollback.json`.
3. Keep it. Do not overwrite your known-good backups with it.

If the app is too broken to export, say so in the incident report and move on — do not force it.

*(The application also writes its own safety backup before a restore and before Start Fresh. That is
a second line of defence, not a substitute for step 2.)*

### Step 3 — Restore the last known-good backup
Staying on the v2.10.0 file:

1. Settings → Data Portability → **Import Complete Backup…**
2. Select your last known-good `.json`.
3. **Read the preview.** Confirm the filename, the export date, the company name, the transaction
   count, and that it says **Schema Version: 6**.
4. Click **Restore This Backup** and confirm.
5. Verify: employees, contracts and recent transactions look right, then reload the page and verify
   again — the data must survive the reload.

If that resolves it, the pilot can continue on v2.10.0. Record the incident anyway (step 6).

### Step 4 — Revert to the previous application artifact (only if step 3 did not resolve it)
If the fault is in the application rather than the data, go back to the last published release.

1. Confirm you have completed step 2.
2. Obtain **v2.9.0** — the published GitHub Release asset `tam-os-v2.9.0.html`
   (1,049,018 bytes, SHA-256
   `e7470ff5261896b8d7d1f8645294d2abd6a72e9820df94b799973627ddcaf3ea`).
   **Verify the SHA-256 before use.** v2.9.0 remains published and immutable precisely so it can
   serve as this rollback target.
3. **Do not delete the v2.10.0 file** — keep it for diagnosis.
4. Open `tam-os-v2.9.0.html`.
5. Restore your last known-good backup into it (same steps as step 3).

**Note on browser storage:** the two files may or may not share browser storage depending on how
they are opened. Do not rely on the data "just being there" — restore explicitly from your backup
file and verify.

### Step 5 — Verify the rollback
Confirm all of the following before resuming any work:

- Settings → About reports the version you intended to be on.
- The preview at restore time reported **Schema Version 6**.
- Employee, contract and transaction counts match the backup you restored.
- The data survives a full page reload.
- Acting as an Employee shows only that employee's own records.
- No errors appear during normal navigation.

If any of these fail, **stop** and escalate to the maintainer. Do not resume the pilot.

### Step 6 — Record the incident
Write it up for the maintainer:

- Date, time, and which operator.
- The artifact in use (v2.10.0 or v2.9.0) and what you were doing.
- What went wrong, and which trigger it matched.
- Which step resolved it (3, or 4), or that it remains unresolved.
- Which backup file was restored, and its export date.
- The name of the incident capture from step 2.

**Do not include real employee, salary or payroll values** in the report. Describe the shape of the
problem, not the confidential content.

Per repository policy, dated point-in-time incident records belong in `audit/`, and security issues
are reported through the private channel in [`SECURITY.md`](../../SECURITY.md).

---

## After a rollback

The pilot does **not** resume on v2.10.0 until:

1. The root cause is understood.
2. A fix is implemented, verified, and browser-validated on both the modular source and the portable
   build.
3. The maintainer explicitly restarts the pilot.

A rollback is not a failure of the process — it is the process working. Report it plainly.

---

## Related documents

- [Pilot-Guide-v2.10.0.md](Pilot-Guide-v2.10.0.md) — operator guide and backup cadence
- [Release-Checklist-v2.10.0.md](Release-Checklist-v2.10.0.md) — the pilot readiness gate
- [`docs/DATA-SAFETY.md`](../DATA-SAFETY.md) — the data-safety model
- [`SECURITY.md`](../../SECURITY.md) — private security reporting
