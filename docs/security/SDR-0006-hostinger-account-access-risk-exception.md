# SDR-0006 — Hostinger Account Access-Risk Exception

| Field | Value |
|---|---|
| **Record** | SDR-0006 |
| **Title** | Hostinger Account Access-Risk Exception — synthetic-data staging on the shared Hostinger account without two-factor authentication, under a named access-holder register and compensating controls |
| **Status** | **Accepted** |
| **Author** | Forge (engineering) |
| **Accountable approver** | Owner / Maintainer (`CLAUDE.md` §20) — owner decisions D-1 = A, D-2 = B, D-3 = B and D-4 = A, 2026-10-26 |
| **Date created** | 2026-10-26 |
| **Next review** | Every 90 days while the exception is in force, and at every revalidation trigger (§6) |
| **Supersedes** | **Partially** [SDR-0002](SDR-0002-php-mariadb-security-architecture.md): only (a) the §14 Hostinger-account two-factor requirement, **and only as it applies to synthetic-data staging**, and (b) the §14 access limit "the maintainer (plus a named delegate if the owner designates one)", replaced by the capped register of §3. Every other SDR-0002 requirement stays in force, including the two-factor requirement for production and evidence row E10, and SDR-0002 stays Accepted and unchanged |
| **Superseded by** | — |
| **Related** | [SDR-0002](SDR-0002-php-mariadb-security-architecture.md) §14, §16, §17, §18, §21; [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md); [`SECURITY.md`](../../SECURITY.md); [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8; `CLAUDE.md` §7.6, §12.5, §17, §20 |

> **What this is.** A documented, Owner-approved **risk exception** for staging. It lets TAM OS be
> deployed to staging, with clearly fabricated data only, on the shared Hostinger account while
> two-factor authentication on that account is disabled. It also replaces SDR-0002's access limit with a
> named register of at most five people.
>
> **What it is not.** It does not state or imply that two-factor authentication is enabled. It does not
> treat a shared login as equivalent to individual accounts. It is **not** production risk acceptance:
> it authorizes no production deployment, no production cutover and no real company data, and it does
> not satisfy SDR-0002 E10. It relaxes no other SDR-0002 control. It changes no code, configuration,
> hosting or DNS setting, and authorizes no deployment by itself.

---

## 1. Context

SDR-0002 §14 classifies the Hostinger account as a **super-credential**: it can read every file and
database in the hosting account, change the deployed frontend and backend, and restore backups. SDR-0002
requires two-factor authentication on it before deployment and limits access to the maintainer plus one
named delegate (§14, E10).

As recorded by the Owner on 2026-10-26:

- two-factor authentication on the Hostinger account is **disabled**;
- the account is used by several authorized people through **one shared email address and password**,
  so the SDR-0002 access limit is also not met today;
- the Owner has decided that the two-factor requirement must not block TAM OS staging progress.

## 2. Decision

1. **Staging only (D-3 = B).** Hostinger-account two-factor authentication is not a precondition for
   deploying TAM OS to **staging**, where staging means a deployment that holds **only clearly
   fabricated data** (`CLAUDE.md` §12.5) and **only staging secrets** (C6).
2. **Production is unchanged.** The SDR-0002 §14 two-factor requirement remains **in force for
   production**. Production deployment, production cutover and the first real company data still require
   two-factor authentication on the Hostinger account and a satisfied E10 (SDR-0002 §17).
3. **E10 is not satisfied by this record.** Nothing here marks E10 met. E10 can be met only by enabling
   two-factor authentication on the account with its access holders listed.
4. **A risk exception, not an equivalent control.** Single-factor shared access is recorded as weaker
   than individual accounts with two-factor authentication. The residual risk (§5) is accepted by the
   Owner **for staging only**, not mitigated away.
5. **Conditional.** The exception holds only while every compensating control in §3 is operational and
   evidenced (§4). A control that lapses **suspends** the exception, and staging deployment work stops
   until the control is restored or two-factor authentication is enabled.
6. **Real data voids it.** If any real company data — finance, payroll, employee or contract — reaches a
   deployment covered by this exception, the exception no longer applies to it, and it is handled as a
   production deployment under SDR-0002 and as an incident under `SECURITY.md`.
7. **Access limit (D-2 = B).** The SDR-0002 §14 limit "the maintainer (plus a named delegate)" is replaced
   by the named access-holder register of C1, **capped at five individuals**. The cap is a maximum, not a
   requirement to grant five people access. This replacement applies to the account whether or not
   two-factor authentication is enabled.
8. **Two-factor remains the target.** Enabling two-factor authentication on the account ends the staging
   exception; the register (C1) and secret separation (C6, C7) still apply.

## 3. Compensating controls

| # | Control |
|---|---|
| C1 | **Named access-holder register, capped at five.** Every person who knows the Hostinger password is listed by name, role and date granted, in the private layer, never in this repository. At most **five** individuals may be on it; the cap is a maximum, and access is granted only where needed. A person not on the register must not hold the password. A sixth holder is not permitted without a new Owner decision recorded as a superseding SDR |
| C2 | **Strong, unique password.** At least 20 random characters, generated by a password manager, and used for no other account or service |
| C3 | **Controlled distribution.** The password is shared only through a password manager's shared vault, never by chat, email, document, screenshot or ticket |
| C4 | **Rotation.** The password is rotated (a) before the first staging deployment under this exception, (b) within 24 hours of any holder leaving the register, (c) immediately on any suspected exposure, and (d) at least every 90 days. Each rotation is dated in the register |
| C5 | **Recovery mailbox with mandatory two-factor (D-4 = A).** The email address that controls Hostinger password reset is company-controlled, not a personal mailbox, and **must** have two-factor authentication enabled on the mail account. Every person who can read that mailbox is on the C1 register and counts toward its cap. Without this control the exception is not in force |
| C6 | **Staging secrets only.** A deployment under this exception holds only staging values: its own database, database user and password, application secret, mail key and backup-encryption key, none shared with production or with any other site in the account (SDR-0002 §14, §18). The configuration file stays outside the public web root (SDR-0002 §14), and secrets are never stored in hPanel notes, file-manager text files or the vault entry for the Hostinger login. **Keeping secrets outside the web root protects them from retrieval over public HTTP only; it does not protect them from anyone who controls the Hostinger account**, who can read that file, the database and the backups directly. The protection against an account takeover is that the staging secrets unlock nothing beyond fabricated staging data |
| C7 | **Deployment credential separated.** TAM OS deployment uses a dedicated SFTP (or, once enabled, key-based SSH) credential distinct from the hPanel password, held only by the maintainer. This keeps the routine deployment path off the shared login; it does **not** limit what a holder of the hPanel password can do, since hPanel can create, reset or bypass such credentials |
| C8 | **Monitoring where available.** Any login notification, login history or activity log hPanel offers is enabled and reviewed at each staging deployment and each 90-day review. If hPanel offers none, that absence is recorded as a gap; it is not treated as met |
| C9 | **Trusted devices only.** Holders sign in to hPanel only from their own maintained devices, never from shared or public computers, and each holder acknowledges C2–C9 when added to the register |

## 4. Evidence before staging deployment

Before the first staging deployment under this exception, and again at each 90-day review, the private
layer records — never the secret values — that each control is operational:

| # | Evidence | State at acceptance |
|---|---|---|
| X1 | C1 register exists, names at most five holders, and every current password holder is on it | Not yet evidenced |
| X2 | C2 and C3 met; the vault in use is named | Not yet evidenced |
| X3 | C4 rotation (a) performed and dated | Not yet evidenced |
| X4 | C5 recovery mailbox identified, company-controlled, two-factor enabled, readers on the register | Not yet evidenced |
| X5 | C6 staging database, user and secrets exist and are distinct from production and other sites | Not yet evidenced |
| X6 | C7 dedicated deployment credential exists; holder recorded | Not yet evidenced |
| X7 | C8 hPanel monitoring availability recorded, and enabled where available | Not yet evidenced |
| X8 | C9 acknowledged by every holder | Not yet evidenced |
| X9 | The account's two-factor state is recorded as found | Recorded by the Owner as disabled, 2026-10-26 |

Until X1–X8 are evidenced, the exception is **not in force** and no staging deployment relies on it.
These items are staging evidence only; they are not SDR-0002 §17 evidence and do not satisfy E10.

## 5. Residual risk (accepted by the Owner for staging only)

| # | Risk | Why the controls do not remove it |
|---|---|---|
| R1 | **Account takeover by one stolen password.** Phishing, malware on any holder's device, or a leaked vault gives full account access with no second factor | C2–C4 reduce likelihood; nothing blocks a correct stolen password |
| R2 | **No individual accountability.** Every action in hPanel appears as the same user. An incident cannot be attributed to a person, and insider misuse cannot be told apart from a holder's legitimate work | C1 lists who *could* have acted, not who *did* |
| R3 | **Exposure grows with each holder.** The compromise of any one holder's device or habits compromises the account for all | C1's cap and C9 limit the number and hygiene of holders; they do not isolate them |
| R4 | **Full staging impact on takeover.** The account can read the staging configuration file and database, replace the deployed staging frontend and backend, and restore old backups | C6 confines the loss to fabricated data and staging secrets; it does not prevent the access |
| R5 | **Slow or no detection.** Without per-user logins and with uncertain hPanel logging, a takeover may go unnoticed | C8 helps only where hPanel provides logs |
| R6 | **Revocation is coarse.** Removing one holder requires rotating the password for everyone | Inherent to a shared credential (C4) |
| R7 | **Recovery-path takeover.** Whoever controls the recovery mailbox can reset the account | C5 makes two-factor on the mailbox mandatory; it does not remove the path |

The shared account also serves the company's `reliabilityindonesia.com` web presence (SDR-0002 §18). The
risk an account takeover poses to that site exists independently of TAM OS and is **not** accepted or
assessed by this record. Off-host encrypted backups (SDR-0002 §16) protect availability and recovery;
they do not protect the confidentiality of anything an attacker has already read.

## 6. Revalidation triggers

Re-examine this exception, and treat it as **suspended** until the Owner re-confirms it, if:

- any compensating control lapses or any X-item is no longer true;
- a holder leaves, or a person outside the register is found to know the password;
- there is any suspected unauthorized hPanel access, unexplained file, database or DNS change, or
  unexplained password-reset mail;
- the account's recovery email address or mailbox changes;
- any real company data reaches a deployment covered by this exception (§2.6);
- Hostinger changes how two-factor authentication, sub-users or access delegation work;
- 90 days pass since the last review.

The exception **ends** when two-factor authentication is enabled on the Hostinger account. Production
readiness is governed by SDR-0002 §17 and is never reached through this record.

## 7. Consequences

- **SDR-0002 §14:** the two-factor requirement is unchanged for production; for synthetic-data staging it
  is replaced by §2–§4 of this record. The access limit is replaced by C1 (at most five named holders).
- **SDR-0002 E10:** unchanged and not satisfied. Production still requires two-factor authentication on
  the account with access holders listed.
- **SDR-0002 §18 and threat #20 (§21):** unchanged. "Hostinger account 2FA (E10)" remains a production
  control. During staging, R1–R7 above are the residual risk.
- **SDR-0002 §17 E12:** the external security review considers this exception and R1–R7 if it is still
  in force when the review runs.
- No other SDR-0002 control changes: secrets handling, the dedicated database and user, least privilege,
  HTTPS and headers, backups and restore rehearsal, and every other E-item stay as written.

---

*Lifecycle: Proposed → Accepted → (Superseded | Deprecated). See [`README.md`](README.md) for the
register.*
