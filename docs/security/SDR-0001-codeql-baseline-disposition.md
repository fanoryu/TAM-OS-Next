# SDR-0001 — CodeQL Baseline Disposition

| Field | Value |
|---|---|
| **Record** | SDR-0001 |
| **Title** | CodeQL Baseline Disposition |
| **Status** | Accepted |
| **Codename** | The Ledger |
| **Season / Sprint / PR** | Season 2 · Sprint 2 · PR-2.3 |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Date created** | 2026-08-01 |
| **Next review** | 2027-08-01 |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | PR-2 (CodeQL setup), PR-2.1 (baseline triage), PR-2.2 "The Seal" (SheetJS SRI) |

> **Purpose.** This is the first Security Decision Record (SDR) for TAM Intelligence OS. It is the
> permanent engineering justification for the disposition of the CodeQL static-analysis baseline. It
> records *why* each remaining alert is left open, under what classification, and what future event
> would require it to be re-examined. It does **not** dismiss any GitHub alert, change CodeQL
> configuration, or modify application code — those are separate, individually-approved actions.

---

## 1. Executive Summary

CodeQL was introduced as a reporting-only static-analysis workflow (PR-2) and produced an initial
baseline of **6 alerts** against the modular source. Triage (PR-2.1) classified one — an un-pinned
SheetJS CDN `<script>` — as a **True Positive (P1)**; it was remediated with Subresource Integrity in
PR-2.2 and is now **fixed** on `main`.

The **5 remaining open alerts** are, on inspection, **not exploitable** in this application's
architecture: a proprietary, client-only, single-user, no-backend single-page app where all data
already resides in the same browser's `localStorage` in clear text by design, with no server, no
authentication, no session tokens, and no attacker-controlled network input path.

This record dispositions those 5 alerts as **4 False Positives** and **1 Accepted Risk**, each with a
rationale, a review date, and an explicit revalidation trigger. No alert is dismissed in GitHub; they
remain visible as an honest, documented baseline. The disposition is deliberately conservative:
if the architecture changes (a backend, authentication, or a storage redesign is introduced), several
of these classifications flip and the affected findings become real work.

---

## 2. Security Context

The disposition below is only valid within the documented architecture. The relevant invariants
(from `CLAUDE.md` §1, §4, §7 and `SECURITY.md`):

- **Client-only, no backend.** No server, database, or API. There is no remote endpoint to attack and
  no server-side trust boundary to cross.
- **Single-user, local storage.** All finance/payroll/employee/contract data is stored locally in the
  browser (`localStorage` / Artifact storage). Access to that data requires prior physical or OS-level
  access to the user's device.
- **No authentication / no session model.** There are no passwords, tokens, session identifiers, or
  authorization checks in the application. Nothing depends on a value being unpredictable to an
  attacker.
- **No untrusted network input.** The app makes no network calls that carry user data. The only
  external references are the XLSX parser and web fonts. Imported spreadsheets are user-supplied by the
  single local user, not attacker-delivered.
- **Escaping is enforced at DOM sinks.** User-supplied values rendered into the DOM are passed through
  `escapeHtml` (an invariant in `CLAUDE.md` §6.3).

Because there is no remote attacker and no authorization surface, the practical exploitability of the
remaining findings is governed almost entirely by "does this require prior local device access?" — and
in every remaining case, it does, or the finding is not reachable as a security issue at all.

---

## 3. CodeQL Baseline History

### 3.1 Initial alerts (6) — first default-branch scan, PR-2

| # | Severity | Rule | Location |
|---|---|---|---|
| 1 | High | `js/clear-text-storage-of-sensitive-data` | `js/ui/activity-log.js:31` |
| 2 | High | `js/incomplete-multi-character-sanitization` | `js/analytics/reports.js:89` |
| 3 | High | `js/insecure-randomness` | `js/ui/settings-about.js:426` |
| 4 | High | `js/insecure-randomness` | `js/finance/execution-center.js:222` |
| 5 | High | `js/insecure-randomness` | `js/core/onboarding-reset.js:146` |
| 6 | Medium | `js/functionality-from-untrusted-source` | `index.html:11` |

### 3.2 Resolved alerts (1)

| Rule | Location | Resolution | Status |
|---|---|---|---|
| `js/functionality-from-untrusted-source` | `index.html:11` | SRI (`sha512`) + `crossorigin="anonymous"` added to the pinned cdnjs SheetJS v0.18.5 reference (PR-2.2 "The Seal"). Hash independently verified against downloaded bytes and cdnjs SRI metadata. | **Fixed** on `main` (CodeQL-confirmed, fixed 2026-07-31) |

### 3.3 Remaining alerts (5)

The five High alerts in §3.1 (#1–#5) remain open and are dispositioned in §4. Alert counts moved
**6 → 5** after PR-2.2; no new alerts were introduced by any subsequent change.

---

## 4. Alert Disposition

> Two severity columns are shown deliberately. **Tool Severity** is what CodeQL assigns from its
> generic query metadata. **Engineering Severity** is the contextual severity after accounting for this
> application's architecture (§2). Where they differ, the rationale explains why.

### Alert A — Clear-text storage of sensitive data

| Field | Value |
|---|---|
| **Rule** | `js/clear-text-storage-of-sensitive-data` |
| **Location** | `js/ui/activity-log.js:31` (`logActivity()` → `localStorage.setItem(AUDIT_LOG_KEY, …)`) |
| **Classification** | **Accepted Risk** (true positive in the literal sense; accepted by architecture) |
| **Engineering Severity** | Low |
| **Tool Severity** | High |
| **Business Impact** | Low — no incremental exposure |
| **Rationale** | The append-only audit log writes activity records (which may contain employee names and payroll actions) to `localStorage` as clear-text JSON. This is genuinely sensitive data, but it **mirrors data already stored in clear text** under other keys (`tam_employees_v1`, `tam_contracts_v1`, payroll stores) — it is not a new exposure. In a client-only app there is no server-side key custody, so any encryption key would ship to the same client and provide only illusory protection. Reading the data requires prior physical/OS-level access to the device; there is no remote or attacker-controlled path. |
| **Decision** | **Accept.** Do not encrypt (no meaningful protection in a browser-only app). If future reduction is desired, prefer **minimization/redaction** (store `entityId` references rather than full names in `desc`) over encryption. Left open and visible, not dismissed. |
| **Review Date** | 2027-08-01 (or on any trigger below) |
| **Revalidation Trigger** | A backend or server-side persistence is introduced; browser storage is redesigned; the app becomes multi-user; any real key-custody mechanism becomes available; or the audit log begins storing materially more sensitive fields than the data already stored elsewhere. |

### Alerts B, C, D — Insecure randomness

| Field | Value |
|---|---|
| **Rule** | `js/insecure-randomness` (×3) |
| **Locations** | `js/ui/settings-about.js:426` (bank-account record id via `uid('cacc')`) · `js/finance/execution-center.js:222` (transaction record id `t.id`) · `js/core/onboarding-reset.js:146` (demo contract id via `uid('ct')`) |
| **Common source** | `js/core/utils.js:2` — `uid(prefix) = prefix + '_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4)` |
| **Classification** | **False Positive** |
| **Engineering Severity** | Informational |
| **Tool Severity** | High |
| **Business Impact** | None |
| **Rationale** | `Math.random()` is used solely to generate **local record keys / DOM identifiers**. These are not security tokens, reset secrets, session identifiers, or transaction-authorization values. There is no authentication or server to guess against, and nothing in the application grants access or authorizes an action based on the unpredictability of an id. Predicting an id yields no capability. CodeQL flags these because an id later flows into an audit-log `entityId` field, which its heuristic treats as a "security context"; in this architecture it is an ordinary key. The `onboarding-reset.js` case additionally applies only to fabricated demo data. |
| **Decision** | **Classify as False Positive; leave open, undismissed.** No security fix required. Migrating `uid()` to `crypto.randomUUID()` is a reasonable *code-quality* change at a single chokepoint (`utils.js:2`) and would silence all three, but it is explicitly **out of scope** for this record and is **not** security-mandated. |
| **Review Date** | 2027-08-01 (or on any trigger below) |
| **Revalidation Trigger** | Any of these ids ever becomes a security-relevant value — e.g. authentication, session management, a password/token reset flow, capability URLs, or any authorization decision keyed on id unpredictability is introduced. At that point randomness would become security-sensitive and `crypto.getRandomValues` / `crypto.randomUUID` would be required. |

### Alert E — Incomplete multi-character sanitization

| Field | Value |
|---|---|
| **Rule** | `js/incomplete-multi-character-sanitization` |
| **Location** | `js/analytics/reports.js:89` (`md += i.text.replace(/<[^>]+>/g,'')` in `buildReportMarkdown`) |
| **Classification** | **False Positive** (practically unexploitable) |
| **Engineering Severity** | Informational |
| **Tool Severity** | High |
| **Business Impact** | None |
| **Rationale** | Two independent reasons defeat exploitability. (1) The input `i.text` is produced by `computeInsights()` (`js/core/domain-services.js:118`), where every interpolated user value (`category`, `uraian`) is already passed through **`escapeHtml`** — raw `<` cannot survive to line 89. (2) The output is written to a downloaded **Markdown file** via `downloadBlob(…, 'text/markdown')`; it is **never** assigned to `innerHTML` or any DOM sink. The regex is cosmetic tag-stripping for plain-text output, not a security sanitizer guarding an HTML sink. The classic multi-character bypass (e.g. `<scr<script>ipt>` reconstruction) is irrelevant because there is no HTML rendering step for this value. |
| **Decision** | **Classify as False Positive; leave open, undismissed.** No fix required. Not a DOM sink. |
| **Review Date** | 2027-08-01 (or on any trigger below) |
| **Revalidation Trigger** | The report-generation path changes so that `i.text` (or the assembled Markdown) is rendered as HTML into the DOM, or the upstream `escapeHtml` guarantee in `computeInsights()` is removed or bypassed. |

---

## 5. Accepted Risks

| ID | Finding | Why accepted | Compensating factors | Re-examine when |
|---|---|---|---|---|
| AR-1 | Alert A — clear-text audit storage (`activity-log.js:31`) | Browser-only architecture has no meaningful key custody; the data duplicates information already stored in clear text; access requires prior local device access | Client-only app, single-user, no network transmission of the data; audit store reuses an existing key with a 500-record cap | Backend/auth/multi-user/storage-redesign (see Alert A trigger) |

Accepted risks remain **visible** in GitHub Code Scanning (not dismissed) so the acceptance is
auditable and self-expiring at the review date.

---

## 6. False Positives

| ID | Finding(s) | Basis for false-positive classification |
|---|---|---|
| FP-1 | Alerts B, C, D — `insecure-randomness` (`settings-about.js:426`, `execution-center.js:222`, `onboarding-reset.js:146`) | `Math.random()` produces ordinary local record keys / DOM ids, never security tokens; no authorization depends on their unpredictability |
| FP-2 | Alert E — `incomplete-multi-character-sanitization` (`reports.js:89`) | Input is `escapeHtml`-escaped upstream; output is a downloaded `.md` file, never a DOM/HTML sink |

These are engineering false positives **for this architecture**, not assertions that the CodeQL query
is wrong in general. They are recorded here rather than dismissed in GitHub (see §7).

---

## 7. Dismissal Policy

This record makes **classification decisions**; it does **not** dismiss any GitHub Code Scanning alert.
Dismissal is a separate, individually-approved action governed by the following policy:

1. **No alert is dismissed as part of PR-2.3.** All 5 alerts remain open and visible.
2. **Dismissal requires Atlas (CTO) approval** referencing this SDR, per the `CLAUDE.md` §20 approval
   matrix (a security-model change requires explicit approval).
3. **Approved dismissal reasons and written justifications**, if Atlas later elects to dismiss:
   - Alerts B, C, D → GitHub reason **"Used in tests" is *not* appropriate**; use **"Won't fix / False positive"** with justification: *"`uid()` generates local record keys/DOM ids, not security tokens; no authorization depends on id unpredictability. See SDR-0001 FP-1."*
   - Alert E → reason **"False positive"** with justification: *"Input is `escapeHtml`-escaped upstream and output is a downloaded Markdown file, not a DOM sink. See SDR-0001 FP-2."*
   - Alert A → reason **"Won't fix (accepted risk)"** with justification: *"Client-only architecture; audit data mirrors data already stored in clear text; browser-side encryption offers no real key custody. See SDR-0001 AR-1."*
4. **Preferred posture:** keep the alerts open and visible so the baseline stays honest and the
   acceptances self-expire at their review dates. Dismissal is optional and reversible; it should only
   be used to reduce noise if the open baseline begins obscuring genuinely new findings.
5. **Never** dismiss an alert to make a build or scan pass, and never dismiss a finding whose
   classification here is anything other than False Positive or Accepted Risk.

---

## 8. Future Revalidation Events

The entire disposition in this record is **conditional on the current architecture**. Any of the
following events invalidates one or more classifications and requires this SDR to be revisited (and a
successor SDR issued if dispositions change):

- **Backend or API introduced** — creates a remote trust boundary and network input paths. Re-examine
  clear-text storage (data may now transit or be centrally stored), sanitization (values may be
  rendered server-side or cross-user), and randomness (ids may become server-visible references).
- **Authentication / session model added** — randomness immediately becomes security-sensitive
  (session ids, tokens); FP-1 flips to a real finding requiring `crypto.getRandomValues` /
  `crypto.randomUUID`.
- **Browser storage redesign** — e.g. encryption-at-rest, IndexedDB, or a shared/synced store.
  Re-examine AR-1 (clear-text storage) and whether new key-custody makes encryption meaningful.
- **Multi-user or multi-tenant operation** — introduces cross-user trust boundaries; escaping,
  storage, and id-guessing all gain new attack surface.
- **Change to the security model** — any new authorization decision, capability URL, password/reset
  flow, or trust boundary. Re-examine all randomness findings and any value now used to gate access.
- **Report/render path change** — if generated Markdown/report text is ever rendered as HTML into the
  DOM, FP-2 (Alert E) must be re-examined as a genuine sink.
- **`escapeHtml` invariant removed or weakened** — invalidates FP-2 and potentially other findings that
  rely on DOM-sink escaping.
- **CodeQL query-suite change** — enabling `security-extended`, upgrading the CodeQL Action, or a new
  query version may change or add findings; re-baseline and update this record.

---

## 9. Ownership

| Role | Owner | Responsibility |
|---|---|---|
| **Accountable (approves dispositions & dismissals)** | Atlas — Chief Technology Officer | Approves this SDR and any alert dismissal; owns the security model |
| **Responsible (maintains this record)** | Forge (engineering) | Keeps dispositions, review dates, and triggers current; issues successor SDRs |
| **Repository owner** | @fanoryu (PT Total Asset Manajemen) | Final authority; private security contact per `SECURITY.md` |
| **Data owner** | PT Total Asset Manajemen | Owns the confidential data whose exposure these findings are assessed against |

---

## 10. Review Cycle

- **Scheduled review:** annually. Next scheduled review **2027-08-01**.
- **Light-touch check:** at the start of each season/sprint that touches security tooling, confirm the
  baseline count and that no new alert is silently folded into "the known 5."
- **Event-driven review:** immediately upon any §8 revalidation event, regardless of the annual date.
- **On CodeQL change:** re-baseline and amend this record whenever the CodeQL Action, query suite, or
  configuration changes (note: two non-blocking deprecation advisories are currently outstanding —
  Node 20 runtime, and CodeQL Action `v3 → v4` before December 2026).
- **Amendment model:** this record is versioned in git. Material changes to a disposition are made by a
  successor SDR (e.g. SDR-0002) that supersedes the affected section; the historical record is never
  rewritten.

---

*SDR-0001 is a governance record. It changes no code, no CodeQL configuration, and dismisses no alert.
It is proposed for Atlas CTO review.*
