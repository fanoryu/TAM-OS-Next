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
| [SDR-0003](SDR-0003-governed-mail-transport.md) | Governed Mail Transport | Accepted | 2026-10-01 | Before the first real recovery mail |
| [SDR-0004](SDR-0004-employee-account-administration.md) | Employee Account Administration | Accepted | 2026-10-01 | Before the first real Employee account |

## Timeline

- **2026-08-01** — SDR-0001 Accepted (CodeQL baseline: 1 resolved, 4 false positives, 1 accepted risk).
- **2026-09-29** — SDR-0002 Accepted (security architecture for the ADR-0004 same-origin PHP + MariaDB
  backend: sessions, CSRF, rate limiting, recovery, central data-access scope, audit, secrets,
  pre-deployment evidence gate). Authorizes no implementation.
- **2026-10-01** — SDR-0003 Accepted (owner decisions D-D1 and D-D3: recovery mail through a
  transactional HTTPS API — Resend — behind the provider-neutral `MailTransport` boundary, delivered
  from a database outbox by a cron worker; no SMTP, no mailer library, no Composer dependency; resolves
  SDR-0002 owner item O5 without amending SDR-0002).
- **2026-10-01** — SDR-0004 Accepted (owner decisions D-BF4a-1 = B, D-BF4a-2 = B and BF-4a2 C1 = A: the
  CEO-only, record-bearing `account.manage` ACTION for Employee account provisioning, activation reissue,
  disable and enable, mirrored in `js/core/authz.js` so ACTIONS move 20 → 21; activation mail through the
  governed outbox as the SDR-0003 §8 revalidation). **Partially supersedes SDR-0002** — only the clauses
  that fix the ACTION count at 20 (§7, the §1 diagram, §9.2); SDR-0002 and SDR-0003 stay Accepted and
  unchanged. Authorizes no implementation.

*Architecture decisions live in [`../adr/`](../03b-repository-adr/README.md) as ADRs.*
