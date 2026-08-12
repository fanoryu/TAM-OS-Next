# 06 — Releases

How versions are shipped. This folder holds the release *strategy*; the enforceable rules are in the
[Release Standard](../04-standards/Release_Standard.md) and the step-by-step procedure is
[`docs/RELEASE-PROCESS.md`](../RELEASE-PROCESS.md).

| Document | Read it for |
|---|---|
| [Release_Strategy.md](Release_Strategy.md) | Versioning philosophy, release flow, checklist, and hotfix flow |
| [Pilot-Guide-v2.10.0.md](Pilot-Guide-v2.10.0.md) | **Operator-facing** controlled-pilot guide for the v2.10.0 candidate — trust model, who should and should not use it, backup cadence, import, restore, reporting |
| [Rollback-Plan-v2.10.0.md](Rollback-Plan-v2.10.0.md) | Pilot rollback procedure and triggers, with the schema-6 compatibility claim verified against source and its limits stated |
| [Release-Checklist-v2.10.0.md](Release-Checklist-v2.10.0.md) | The v2.10.0 pilot readiness gate — verification, build, browser-validation and documentation evidence, plus the open general-use blockers |
| [Controlled-Pilot-Signoff-v2.10.0.md](Controlled-Pilot-Signoff-v2.10.0.md) | The controlled-pilot sign-off record — frozen artifact identity and hash, verification results, the manual portable reload-persistence confirmation, final smoke, external dependencies, known pilot limitations, and the maintainer approval box (**pilot not launched**) |

Releases are proposed, never published directly; they are tag-driven, guarded, idempotent, and
immutable once shipped. Implementation and documentation changes do not trigger a release.
