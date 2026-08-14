# Security Policy

TAM Intelligence OS is proprietary internal software for **PT Total Asset Manajemen**. It stores
finance, payroll, employee, and contract data locally in the browser. Please treat security issues
with care.

This policy covers the canonical repository `fanoryu/TAM-OS-Next` and the application builds produced
from it.

## Reporting a vulnerability (private)

**Do not report a vulnerability through the issue tracker.**

### The current private route

Report suspected security vulnerabilities privately, by email, to the repository owner:

> **<fanoryu@gmail.com>**
>
> Suggested subject line: **`TAM-OS Security Report`**

This is the canonical vulnerability-reporting route for the current state of the repository.

GitHub **Private Vulnerability Reporting** is **enabled** on this repository — you may open a private
report from the repository's **Security** tab (**Report a vulnerability**). The security email above
remains an always-valid private alternative. Never report a suspected vulnerability through a public
surface (Issues, pull requests, commits, or discussions).

### Do not use these routes for a vulnerability

- The GitHub issue tracker. This repository is **publicly viewable**, so its Issues are visible to
  **anyone on the internet** — never disclose an unfixed vulnerability, credentials, infrastructure
  secrets, confidential data, or other sensitive security information there.
- Pull request titles, descriptions, or review comments.
- Commit messages or branch names.
- Any shared chat, group mailbox, or ticketing system not designated by the owner.

### What to include in a report

A useful report describes the problem without exposing real data:

- A clear description of the issue and its security impact.
- Steps to reproduce, using **fabricated placeholder** values only.
- Expected behavior versus actual behavior.
- Affected area/module and the application version (Settings → About) or build filename.
- Browser and operating system.
- A proof-of-concept **only if** it is safe and uses clearly fabricated data.

### Never include sensitive data in a report

When reporting, **redact and exclude** all of the following. Describe the behavior instead of
pasting the data:

- Payroll data (amounts, rates, totals)
- Employee personal data (names, IDs, contact details, bank details)
- Contract documents or contract numbers tied to real people
- Bank account information
- Credentials, passwords, API keys, or tokens (including GitHub tokens)
- Complete Backup JSON exports
- Uploaded evidence, workbooks, or attachments containing real company data

If a proof-of-concept requires data, use clearly fabricated placeholder values.

## What counts as a vulnerability

- Unauthorized disclosure, modification, or loss of stored finance/payroll/employee data
- Bypass of the application's authorization checks or read-scope by a means **other than** the
  documented local principal selector (see *Security model* below)
- Privilege escalation into an action the acting principal is not permitted to perform
- Exposure of sensitive data through an unintended surface — exports, logs, error text, URLs
- Cross-site scripting (XSS) or code injection via imported files, field values, or settings
- Bypass of the typed-confirmation / backup safeguards around destructive actions (Start Fresh,
  Reset, Restore)
- Corruption of persisted data (localStorage / Claude Artifact storage) or of backup exports
- Leakage of data to any third party, endpoint, or network destination
- Supply-chain risks in the build/verify tooling or GitHub workflows
- Secrets or real company data committed to the repository

## What should not use the security channel

The following are ordinary product work, not security reports. Use the normal
[bug report](.github/ISSUE_TEMPLATE/bug_report.yml) or
[feature request](.github/ISSUE_TEMPLATE/feature_request.yml) form:

- Functional defects with no confidentiality, integrity, or data-loss impact
- Feature requests and enhancement ideas
- Layout, styling, wording, or other UX issues
- Documentation errors and broken links
- Questions about how a workflow is meant to behave

If you are unsure whether something is security-sensitive, use the private route and say you are
unsure. Over-reporting privately is preferred to under-reporting publicly.

## Security model

Scope your report against what the software actually claims. TAM Intelligence OS is client-only:
there is no server, database, API, or account system.

- **There is no authentication.** The "Acting as" principal is a **local, trust-based application
  context**, not a login. It is spoofable by anyone who can open the application, and it is
  documented in-source as **not a security boundary**.
- **Authorization and read-scope are product-integrity behaviour** under that trust model. They
  prevent accidental cross-principal actions; they do not defend against a local adversary.
- **Anyone with access to the device, browser profile, or portable HTML file has access to the
  data.** Device and file custody is the actual control.

Consequently, "I selected a different principal in the UI and then saw that principal's data" is a
documented property of the current design, not a vulnerability. A defect that exposes or alters data
**without** changing the selector — or that survives the intended authorization path — is.

## Supported versions

Only the current codebase receives security fixes. Older builds are not maintained.

| Version | Supported |
|---|---|
| Current `main` of `fanoryu/TAM-OS-Next` (`APP_VERSION` **2.11.0**) | ✅ |
| Any earlier build or release | ❌ |

> **Provenance.** `fanoryu/TAM-OS-Next` is the canonical repository going forward. v2.10.0 was
> **originally published** from the predecessor repository `fanoryu/TAM-OS`, which is retained as a
> read-only archive, and the same byte-identical artifact is **canonically re-published** from this
> repository under the tag `v2.10.0`. It is the same version, not a new one. The portable artifact for
> the current codebase is tracked here as `dist/tam-os-v2.10.0.html`.

## Response expectations

This is a small, single-owner project. The following are **best-effort intentions, not a service
level agreement**, and carry no remediation deadline:

- Acknowledgement: within a few business days.
- Initial assessment / triage: shortly after acknowledgement.
- Fix and release: prioritized by severity and data-safety impact.

There is no bug bounty, no compensation, and no safe-harbor commitment attached to this policy.

## Responsible disclosure

We ask reporters to:

- Give a reasonable opportunity to remediate before any public or wider discussion.
- Access, modify, or copy **only** the minimum needed to demonstrate the issue.
- Avoid destructive testing — do not delete, reset, or corrupt data belonging to anyone else.
- Test against fabricated sample data rather than real company data wherever possible.

Good-faith research reported privately is welcomed. Disclosure is coordinated with the repository
owner and PT Total Asset Manajemen.

## Credential & data rotation guidance

If credentials or tokens are ever exposed (in a report, a commit, a log, or a screenshot):

1. **Rotate immediately** — revoke and reissue the affected GitHub token / credential.
2. Remove the exposed value from any issue, PR, or comment.
3. If it was committed, report it to the repository owner. Purging it from history is a **history
   rewrite** and requires explicit owner approval under [`CLAUDE.md`](CLAUDE.md) §20 — do not
   force-update a shared branch on your own initiative. Assume the old value is compromised and
   rotate again after any purge.
4. If real company/backup data was exposed, notify the data owner at PT Total Asset Manajemen and
   follow internal data-handling procedures.

## Data-handling expectations

TAM Intelligence OS is client-only. Understanding its data posture helps scope reports correctly:

- All finance/payroll/employee/contract data is stored **locally** (browser `localStorage` or the
  Claude Artifact storage environment). There is no server, database, or API.
- The app makes **no network calls that carry user data**. Typography is self-contained (fonts are
  bundled, not fetched from a CDN); the only external reference is the XLSX parser (CDN). Exports
  (CSV/JSON) are generated locally and downloaded by the user.
- Real company data must never be committed to the repository or pasted into issues, PRs, logs, or
  screenshots. See [`docs/DATA-SAFETY.md`](docs/DATA-SAFETY.md) and
  [`CONTRIBUTING.md`](CONTRIBUTING.md).
- This repository is **publicly viewable** (source-available, not open source) and holds no company
  data. Production data and configuration are maintained separately in a private layer (see
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).

## Security Decision Records (SDR)

Engineering justifications for standing security decisions — such as the disposition of static-analysis
(CodeQL) findings — are recorded as versioned Security Decision Records. See the
[SDR register](docs/security/README.md) for the full list, status, and review dates:

- [`SDR-0001 — CodeQL Baseline Disposition`](docs/security/SDR-0001-codeql-baseline-disposition.md) (Accepted)

An SDR documents *why* a finding is accepted or classified as a false positive and what future change
would require it to be re-examined. An SDR does not, by itself, dismiss any alert.
