# Repository Decision Records (RDR)

Repository-level records that **snapshot the state of the repository** at a meaningful boundary — for
example, the close of an engineering milestone. An RDR is purely factual: it freezes what exists on
`main` at a point in time. It records no future planning and authorizes no work.

RDRs are **immutable once Accepted** — a later snapshot is a new record that links back; it never
rewrites history (`CLAUDE.md` §14.4, §16.2). Architecture decisions live in [`../03-adr/`](../03-adr/README.md)
as ADRs; security decisions in [`../security/`](../security/README.md) as SDRs; this register holds
snapshots only.

## Lifecycle

`Proposed → Accepted → (Superseded)`

- **Proposed** — drafted, awaiting the `CLAUDE.md` §20 approver.
- **Accepted** — approved; the authoritative snapshot for its boundary.
- **Superseded** — replaced by a newer snapshot (stays in place, read-only, links forward).

## Register

| RDR | Title | Status | Snapshot commit | Date |
|---|---|---|---|---|
| [RDR-001](RDR-001-gamma-repository-snapshot.md) | Gamma Repository Snapshot | Accepted · superseded as baseline | `0337f31` | 2026-08-01 |
| [RDR-003](RDR-003-delta-repository-snapshot.md) | Delta Repository Snapshot (Gateway boundary) | Accepted · **superseded as baseline by RDR-007** | `851c038` | 2026-08-02 |
| [RDR-007](RDR-007-delta-repository-snapshot.md) | Delta Repository Snapshot (post-PR-8B) | Accepted · **superseded as baseline by RDR-011** | `55499f2` | 2026-08-02 |
| [RDR-011](RDR-011-epsilon-repository-snapshot.md) | Epsilon Repository Snapshot — Aggregate-Backed Repository Adoption Complete | **Accepted — current authoritative baseline** | `6714beb` | 2026-08-03 |

> **Current baseline: [RDR-011](RDR-011-epsilon-repository-snapshot.md)** (aggregate-backed Repository
> adoption complete, 7 of 7). RDR-001 (Gamma), RDR-003 (Gateway boundary) and RDR-007 (Milestone Delta)
> remain immutable predecessors and are **no longer the latest baseline**; they link forward to RDR-011.

**Record-only intermediate snapshots.** RDR-002, RDR-004, RDR-005, and RDR-006 were snapshots recorded in
the Atlas governance system at intermediate Delta boundaries; their content is captured and **superseded
by [RDR-007](RDR-007-delta-repository-snapshot.md)**. RDR-008, RDR-009, and RDR-010 were snapshots recorded
in the Atlas governance system at intermediate **Epsilon** boundaries (Employee adoption complete, Contract
adoption, Contract adoption complete); their content is captured and **superseded by
[RDR-011](RDR-011-epsilon-repository-snapshot.md)**. Record-only snapshots are not separately published as
files. RDR numbering is never reused.

## Timeline

- **2026-08-01** — RDR-001 Accepted (frozen repository state at the close of Milestone Gamma: 6 aggregates, 6 commands, 1 query; v2.7.3, SCHEMA 6).
- **2026-08-02** — RDR-003 Accepted (Delta baseline at the close of PR-6A "The Gateway": 7 aggregate-backed commands + 1 aggregate-backed query behind 7 aggregates, 13 registered commands / 4 registered queries, 1 Application Gateway; v2.7.3, SCHEMA 6, commit `851c038`). Supersedes RDR-001 as the authoritative baseline.
- **2026-08-02** — RDR-004/005/006 recorded (record-only, Atlas governance system) at the Gateway-contract, Transport (PR-7A), Transport-consumption (PR-7B), and Repository (PR-8A) boundaries. Superseded by RDR-007.
- **2026-08-02** — **RDR-007 Accepted** — authoritative baseline at the **completion of Milestone Delta** (after PR-8B "The CLI"): two ingresses (Browser + CLI) over one canonical Platform contract; 7/7/1 aggregate-backed, 13/4 registered; v2.7.3, SCHEMA 6, commit `55499f2`, 824 verifier checks. Supersedes RDR-003.
- **2026-08-03** — RDR-008/009/010 recorded (record-only, Atlas governance system) at the Employee-adoption-complete (PR-9C), Contract-adoption (PR-10A), and Contract-adoption-complete (PR-10B) boundaries. Superseded by RDR-011.
- **2026-08-03** — **RDR-011 Accepted** — current authoritative baseline at the **completion of aggregate-backed Repository adoption** (after PR-11A "The Payroll Foundation"): three entity-named repositories (Employee, Contract, Payroll) mediating all seven aggregate-backed handlers, 7 of 7; Platform, Domain, StorageAdapter and the Repository contract unchanged; 7/7/1 aggregate-backed, 13/4 registered; v2.7.3, SCHEMA 6, commit `6714beb`, 942 verifier checks. Supersedes RDR-007.
