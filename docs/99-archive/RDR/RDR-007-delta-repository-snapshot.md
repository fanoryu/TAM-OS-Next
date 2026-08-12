# RDR-007 — Delta Repository Snapshot

| Field | Value |
|---|---|
| **Record** | RDR-007 |
| **Title** | Delta Repository Snapshot (post-PR-8B) |
| **Status** | Accepted |
| **Codename** | The Chronicle baseline |
| **Season / Sprint / PR** | SPR-068 · PR-8C (published) |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Founder** | Approved |
| **Distribution** | Forge · Repository |
| **Date created** | 2026-08-02 |
| **Snapshot commit** | `55499f2b598920a4f6986ccec4f7d919ad257331` |
| **Branch** | `main` |
| **Supersedes** | [RDR-003](RDR-003-delta-repository-snapshot.md) (as current baseline), and the record-only intermediate snapshots RDR-004, RDR-005, RDR-006 |
| **Superseded by** | — |
| **Related** | [DPR-005](../DPR/DPR-005-delta-completion-report.md), [SDR-0001](../security/SDR-0001-codeql-baseline-disposition.md), [Atlas Governance Register](../00-governance/Atlas_Governance_Register.md) |

> **Purpose.** This Repository Decision Record freezes the factual state of `main` at the **completion of
> Milestone Delta** (after PR-8B "The CLI"). It is the **current authoritative repository baseline** and
> supersedes [RDR-003](RDR-003-delta-repository-snapshot.md) in that role. RDR-003 remains the immutable
> Gateway-boundary snapshot and is not rewritten. RDR-004/005/006 were record-only intermediate snapshots
> in the Atlas governance system (Gateway-contract, Transport, Transport-consumption, and Repository
> boundaries); they are superseded here and recorded in the [RDR register](README.md) timeline.

---

## 1. Baseline Facts

| Fact | Value | Source of truth |
|---|---|---|
| Snapshot commit | `55499f2…` | `git rev-parse HEAD` |
| Branch / working tree | `main` / clean | `git status` |
| APP_VERSION | `2.7.3` | `js/core/constants.js:29` |
| APP_RELEASE_NAME | `Supplemental-Aware Payroll History` | `js/core/constants.js:30` |
| SCHEMA_VERSION | `6` | `js/core/constants.js:35` |
| Verifier | **824 checks passing** | `node tools/verify-build.js` |
| Build | deterministic; rebuild byte-identical | — |
| Latest tag / release | `v2.7.3` (no new tag/release) | `git tag` / `gh release list` |

## 2. Operational Surface (unchanged since RDR-003)

- **Aggregate-backed:** 7 aggregates · 7 aggregate-backed commands · 1 aggregate-backed query.
- **Registered executable:** 13 registered commands · 4 registered queries.

The two figures answer different questions (aggregate-backed authority vs. total registered surface); see
[`Command_Query_Model.md`](../02-architecture/Command_Query_Model.md). No Domain operation was added or
removed by the Platform/Transport/Repository/CLI work.

## 3. Architecture — two ingresses, one canonical contract

```
Browser ┐
        ├→ Transport Adapter → Application Gateway → Domain → Aggregate → Handler → Repository → StorageAdapter
CLI    ─┘
```

- **Application Gateway** (PR-6A) — the exclusive, business-blind Platform boundary.
- **Transport Adapter** (PR-7A) — the canonical transport boundary above the Gateway.
- **Browser consumption** (PR-7B "The Conduit") — the browser UI reaches the Domain **only** through the
  `uiExecute` seam → Transport (no direct `Domain.command`/`Domain.query` for the authorized operations).
- **Repository** (PR-8A) — the first persistence-mechanics boundary, proven on one bounded slice
  (`employee.contact.update`); the handler retains mutation/updatedAt/history/rollback.
- **CLI** (PR-8B "The CLI") — the first **non-browser** ingress: read-only, delegates **solely** through
  `TransportAdapter`, never reaches Domain/Aggregate/Handler/Repository directly, performs no persistence,
  and is verifier-locked as **CLI ⇏ Browser UI**. Not part of the browser build (dist byte-identical).

Both ingresses consume the **same canonical Platform contract** — request `{kind,name,args,meta?}`, uniform
response `{ok,kind,name,result?,error?,meta?}` — verified at runtime with metadata preserved verbatim.

## 4. Security Posture

CodeQL: **5 open, 1 fixed** — baseline unchanged; no new alert from any Delta PR. The 4 open High alerts
that map to the current code (#1–4) are dispositioned **False Positive** by
[SDR-0001](../security/SDR-0001-codeql-baseline-disposition.md) (FP-1/FP-2), deliberately left open;
#5 (clear-text storage) is Accepted Risk (AR-1). Disposition conditional on the client-only architecture.

## 5. Repository State at Snapshot

- **Branches:** `main` only on the remote. **PRs #1–#26** merged (except #6, legitimately superseded).
  No open PRs. **Merge lineage:** PR-6A → PR-6B → PR-7A → PR-7B → PR-8A → PR-8B (`55499f2`), all
  merge-commits; no history rewrite.
- **Releases / tags:** `v2.6.6` → `v2.7.3`; latest `v2.7.3`. **No new release or tag** was created by any
  Delta PR.
- Clean tree; deterministic build; 824 verifier checks; browser dist byte-identical; CLI runtime verified.

## 6. Supersession

RDR-007 supersedes [RDR-003](RDR-003-delta-repository-snapshot.md) as the **current authoritative repository
baseline**, and supersedes the record-only intermediate snapshots RDR-004/005/006. RDR-003 stays in place,
read-only, as the immutable Gateway-boundary record. No governance document should describe RDR-003 (or any
earlier RDR) as the latest baseline after this record is Accepted.

---

*RDR-007 is a factual snapshot. It changes no code, no version, no schema, and no CodeQL configuration, and
it authorizes no work.*
