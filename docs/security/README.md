# Security Decision Records (SDR)

Security-level decisions for TAM Intelligence OS — for example, the disposition of static-analysis
(CodeQL) findings. Each SDR records *why* a finding is accepted or classified and what future change
would require it to be re-examined. An SDR does not, by itself, dismiss any alert.

SDRs are **immutable once Accepted** — a later decision supersedes an SDR with a new record that links
back; it never rewrites history (`CLAUDE.md` §14.4, §16.2). This register is also linked from
[`SECURITY.md`](../../SECURITY.md).

## Lifecycle

`Proposed → Accepted → (Superseded | Deprecated)`

- **Proposed** — drafted, awaiting the `CLAUDE.md` §20 approver.
- **Accepted** — approved and authoritative; carries its own review date and revalidation trigger.
- **Superseded** — replaced by a newer SDR (stays in place, read-only, links forward).
- **Deprecated** — guidance retired without a 1:1 successor.

## Register

| SDR | Title | Status | Date | Next review |
|---|---|---|---|---|
| [SDR-0001](SDR-0001-codeql-baseline-disposition.md) | CodeQL Baseline Disposition | Accepted | 2026-08-01 | 2027-08-01 |
| [SDR-0002](SDR-0002-php-mariadb-security-architecture.md) | PHP + MariaDB Multi-User Security Architecture | Accepted | 2026-09-29 | Before first real company data |

## Timeline

- **2026-08-01** — SDR-0001 Accepted (CodeQL baseline: 1 resolved, 4 false positives, 1 accepted risk).
- **2026-09-29** — SDR-0002 Accepted (security architecture for the ADR-0004 same-origin PHP + MariaDB
  backend: sessions, CSRF, rate limiting, recovery, central data-access scope, audit, secrets,
  pre-deployment evidence gate). Authorizes no implementation.

*Architecture decisions live in [`../adr/`](../03b-repository-adr/README.md) as ADRs.*
