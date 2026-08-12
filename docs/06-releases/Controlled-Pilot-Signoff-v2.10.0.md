# TAM OS v2.10.0 — Controlled Pilot Sign-Off

**Status: CONTROLLED PILOT APPROVED — NOT YET LAUNCHED.**

The maintainer has reviewed the evidence in this record and **approved the controlled pilot**.

**The pilot has not been launched.** Approval authorises handoff; launch occurs only when the
approved artifact is actually handed to the named pilot operators. No launch date is set here — see
§12.

---

## 1. Identity of the package being signed off

| Field | Value |
|---|---|
| Baseline / merge SHA | `61ddd93965d62498e4b54c4a1d590261932c1f4a` (main) |
| Readiness-1 | MERGED / FROZEN (`3521d811`) |
| Readiness-2 | MERGED / FROZEN (`580d8999`) |
| Readiness-3 | MERGED / FROZEN (`61ddd939`) |
| `APP_VERSION` | **2.10.0** — *Governed Workspace* |
| `SCHEMA_VERSION` | **6** (no migration in this release) |
| `ACTIONS` | **20** (`ACTION_SET`, `ACTION_RESOURCE_ENTITY`, `POLICY` also 20) |
| Canonical pilot artifact | `dist/tam-os-v2.10.0.html` |
| Artifact size | **1,151,267 bytes** |
| Artifact SHA-256 | `60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704` |
| Distribution ruling | [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) — Model A retained for this pilot; Model B approved as future architecture (Distribution-1, post-pilot) |

**Handoff identity:** *TAM OS v2.10.0 — Controlled Pilot RC.* Verify the SHA-256 above before
distributing or opening the file. No `v2.10.0` tag and no GitHub Release exist; this sign-off
authorises **pilot readiness, not public release publication**.

## 2. Verification

| Gate | Expected | Result |
|---|---|---|
| Verifier | ≥ 2443, 0 fail | **2443 PASS / 0 FAIL** |
| Runtime harnesses | 2921 / 34 harnesses, 0 fail | **2921 PASS / 34 harnesses / 0 FAIL** |
| Readiness-1 (employee read scope) | 119 | **119 PASS** |
| Readiness-2 (E2E journeys) | 96 | **96 PASS** |
| Deterministic build | two builds byte-identical | **PASS** |
| Committed artifact == fresh build | clean tree after rebuild | **PASS** |
| Artifact size / hash | unchanged | **PASS — 1,151,267 B, hash as above** |

No frozen count fell.

## 3. Accepted functional evidence (Readiness-3, carried forward)

| Item | Result |
|---|---|
| Real `.xlsx` through the actual file input — modular source | **PASS** |
| Real `.xlsx` through the actual file input — portable artifact | **PASS** |
| Smart Import commit (production model builder, pre-import safety backup, `import.commit` audit) | **PASS** |
| Smart Import undo (`import.undo` audit, batch removed exactly) | **PASS** |
| Truthful undo reporting fix — preview and undo consume one computed retention set | **PASS** |
| Real backup export → physical file | **PASS** |
| Real backup import / restore through the actual file input | **PASS** |
| First-boot null principal fails closed; no auto-CEO; principal never persisted | **PASS** |

## 4. Portable reload persistence — final manual confirmation

The one item Readiness-3 flagged for manual re-confirmation. **Closed.**

Performed against the canonical artifact `dist/tam-os-v2.10.0.html` opened via `file://` in an
isolated profile (storage cleared to zero keys before starting):

1. Opened the canonical artifact — `APP_VERSION` 2.10.0, `SCHEMA_VERSION` 6, `ACTIONS` 20, no
   principal selected.
2. Selected **Executive (CEO)** from the Acting-as selector.
3. Created one fabricated record through the **real Add Employee form** —
   `PILOT-FIXTURE-001 / "PILOT FIXTURE — Do Not Use"`.
4. Confirmed it persisted to storage.
5. **Closed the tab and opened the artifact again as a fresh document** (not a soft reload).
6. **The record survived** — present in state *and* rendered in the Employees grid
   ("1 of 1 employee shown", row visible with ID, title, department and salary).
7. `APP_VERSION` = **2.10.0** after reopen.
8. `SCHEMA_VERSION` = **6** after reopen.
9. Principal was **null** after reopen — correct under current semantics: the principal is held in a
   provider-private variable and is deliberately never persisted.
10. All fabricated fixture data cleared afterwards (localStorage and sessionStorage back to zero
    keys).

**Environment:** Chromium 148.0.7778.280 (Electron 42.7.0) on Windows 11, desktop viewport.

**Note for the record:** on first read the Employees grid appeared empty while its header already
said "1 of 1". That was the debounced Data Grid render, not a defect — the row was present on the
next read. Recorded so a future reviewer does not re-raise it.

## 5. Final smoke on the canonical artifact

| Check | Result |
|---|---|
| CEO — principal selection | **PASS** |
| CEO — Finance UI opens | **PASS** |
| CEO — Payroll UI opens | **PASS** |
| CEO — Settings UI opens | **PASS** |
| Employee — principal selection | **PASS** |
| Employee — self-only read scope | **PASS — 0 records scoped while 1 remains stored canonically** |
| Employee — foreign employee absent from UI | **PASS — neither name nor ID rendered** |
| Employee — denied admin control visible + disabled + reason | **PASS — 4 controls, all visible, all disabled, all carrying a reason** |
| Employee — full navigation still visible | **PASS — 27 items, nothing hidden** |
| Global Search — foreign identity absent | **PASS with positive control:** CEO searching "PILOT" returns the record; the same search as Employee returns **"No results"** |
| Import — `.xlsx` parser available with network | **PASS** |
| Backup — export control available | **PASS** |
| Application console errors | **NONE** |

## 6. External runtime dependencies

The artifact is a **single-file application package**. It is **not** fully offline and **not** fully
self-contained, and no document describes it as either.

| Dependency | Role | Impact if unavailable |
|---|---|---|
| SheetJS via `cdnjs.cloudflare.com` (SRI-pinned) | **Required for `.xlsx` import** | `.xlsx` import will not run; `.csv` import unaffected; all other functions normal |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | Cosmetic | Fallback typography |

Confirmed live during this sign-off: exactly these three origins are contacted, and no others. The
controlled pilot therefore **requires network availability for `.xlsx` import**, unless the browser
has already cached the parser. Offline packaging is explicitly out of scope here and remains with
the post-pilot **Distribution-1** milestone.

## 7. Pilot audience and operating model

Per [Pilot-Guide-v2.10.0.md](Pilot-Guide-v2.10.0.md):

- **1–3 named internal TAM operators.**
- **Desktop Chromium-based browser** (Chrome or Edge on Windows is the supported configuration).
- **One controlled browser profile / device per operator** where practical.
- **Network connectivity** required for `.xlsx` import.
- **Backup before first use**, then at the cadence in §8.
- **Explicit Acting-as principal selection** at every session — nothing is selected by default.
- **Employee → self-only read scope.** **CEO → company-wide application context.**

Not for anyone outside the named group, shared or public machines, or phones and tablets.

## 8. Backup cadence

| When | Action |
|---|---|
| Before pilot start | Export a Complete Backup — the baseline |
| End of every session in which anything changed | Export a Complete Backup |
| Before any destructive operation (Start Fresh, Reset, restore, import undo) | Export a Complete Backup |
| Before replacing or updating the application file | Export a Complete Backup |
| Daily minimum on any day the app was used | Export a Complete Backup |

**Storage location:** a folder that is itself backed up — the operator's OneDrive or company network
folder — **not** the browser's Downloads folder. Keep at least the last 5; never delete the last
known-good one. **There is no cloud backup and no sync**: the exported file is the only copy that
survives losing the browser profile.

## 9. Rollback readiness

Per [Rollback-Plan-v2.10.0.md](Rollback-Plan-v2.10.0.md), the procedure covers: stop using the
affected build → preserve the current state and back it up → restore the last known-good backup →
return to the previous known-good artifact (published v2.9.0) where appropriate → verify the
recovered data → record and report the incident.

`SCHEMA_VERSION` remains **6** and **no v2.10.0 schema migration exists** (verified in source), so a
v2.9.0 backup restores into v2.10.0 and a v2.10.0 backup restores back into v2.9.0.

**Stated limitations retained, not softened:** rollback is only as good as the most recent backup;
restore **replaces** rather than merges; the schema-6 compatibility claim covers v2.9.0 ↔ v2.10.0
only and must not be relied on for v2.8.x or earlier.

## 10. Trust-model limitation

**"Acting as" is a local, trust-based application context. It is NOT authentication and NOT a
security boundary.** Anyone with access to the device, browser profile or portable file can select
any principal, including CEO. Authorization and read-scope are product behaviour under that trust
model. The device and browser profile are the real security boundary.

This caveat appears in the pilot guide, the release notes, the README and the in-app release notes.

## 11. Known pilot limitations (accepted, not fixed)

These remain open and are **acceptable for a controlled desktop pilot**. None is reclassified as
fixed:

1. **No strong authentication** — Acting-as is a local trust context.
2. **Manual, single-device backups** — no sync, no cloud backup.
3. **Mouse-oriented disabled-reason discoverability** — the reason is a `title` tooltip; not
   reachable by keyboard or touch. C3 semantics (visible + disabled) are unchanged.
4. **CDN-dependent `.xlsx` import** — no offline path.
5. **No multi-device sync** — two operators are two independent datasets.

**Pilot blocker check:** no open **P0 data-loss**, **P1 privacy**, **P1 authorization**,
**P1 persistence**, or **P1 core-workflow** blocker. The one defect found during Readiness-3 (the
untruthful Smart Import undo preview and audit entry, P2) is fixed and re-verified.

## 12. Sign-off

| Gate | Status |
|---|---|
| Baseline verified against `61ddd939` | ✅ |
| Verification suite green, no count fell | ✅ |
| Canonical artifact frozen and hash-matched | ✅ |
| Portable reload persistence confirmed manually | ✅ |
| Final smoke green, zero console errors | ✅ |
| Operator documentation complete | ✅ |
| Backup cadence and rollback documented | ✅ |
| No open P0/P1 pilot blocker | ✅ |
| **GO / NO-GO (technical readiness)** | **GO** |
| **Maintainer approval for the controlled pilot** | ☑ **APPROVED** |

**Approval recorded.** The maintainer reviewed the evidence above and authorised the controlled
pilot for TAM OS v2.10.0, on the terms in this record: the audience in §7, the backup cadence in §8,
the rollback procedure in §9, the trust-model limitation in §10, and the five known limitations in
§11 accepted as-is.

**What this approval does and does not mean.**

- **It does mean:** the RC package is frozen, and the artifact identified in §1 — verified by its
  SHA-256 — may be handed to the approved 1–3 named operators under the controlled pilot process.
- **It does not mean the pilot has launched.** Launch happens when the artifact is actually
  distributed to those operators. **No launch date is set by this record**, and this document must
  not be read as evidence that the pilot is running.
- **It does not authorise public release.** No `v2.10.0` tag and no GitHub Release exist, and none
  is created by this approval. The pilot artifact is distributed separately under the controlled
  pilot process, not as a published GitHub Release asset.
- **It does not broaden the audience** beyond §7, and it does not reclassify any limitation in §11
  as fixed.

**Next operational step:** pilot handoff to the approved operators. A separate record should note
the actual launch when it occurs.

---

## Related documents

- [Pilot-Guide-v2.10.0.md](Pilot-Guide-v2.10.0.md) — operator guide
- [Rollback-Plan-v2.10.0.md](Rollback-Plan-v2.10.0.md) — recovery and rollback
- [Release-Checklist-v2.10.0.md](Release-Checklist-v2.10.0.md) — the readiness gate
- [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) — distribution ruling
- [`RELEASE_NOTES.md`](../../RELEASE_NOTES.md) — what changed in v2.10.0
