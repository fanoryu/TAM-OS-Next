# Deployment & the Source-Core / Private-Company-Layer Split

This document explains how TAM Intelligence OS is structured for a **source core** with a
**separate private company layer**, and how PT Total Asset Manajemen keeps production data and
configuration outside this repository. It describes only what actually exists in the repo; for the
module map see [`ARCHITECTURE.md`](../ARCHITECTURE.md), for data rules see
[`DATA-SAFETY.md`](DATA-SAFETY.md), and for the release procedure see
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md).

## 1. Two layers

**Source core (this repository)** — application source (`index.html`, `css/`, `js/`, vendored
`vendor/`), the build/verify tooling (`tools/`), the committed package manifest
(`dist/package-manifest.json`) and frozen single-file releases (`dist/*.html`), the golden-master
reference HTML, documentation, CI/release workflows, and issue/PR templates. It contains **no company
data** and ships an **empty data seed** (a fresh install starts with zero records; the verifier
asserts the embedded `seed-data` JSON is `[]`).

**Private company layer (maintained separately, never in this repo)** — the real fund-usage / payroll
planning workbook, employee/payroll/finance records, Complete Backup exports, company branding, and any
deployment-specific configuration or secrets. A ready-to-use template for this layer
(`tam-company-private-template/`) is kept **outside** this repository with folders for
`company-config/`, `production-data/`, `workbooks/`, `exports/`, `backups/`, `branding/`, and
`deployment/`.

> **Rule:** No production or company-identifying data belongs in this repository — not in the working
> tree, not in Git history, not in issues or PRs, not in screenshots. Only clearly-fabricated sample
> values may ever appear, and the application does not require any seeded data to run.

## 2. Running the app

The app is a single-page, client-only application with **no backend, database or API**; its only
runtime dependency is the vendored, pinned SheetJS parser. It is distributed as the **deployment
package** (Distribution-1, [ADR-0002](03b-repository-adr/ADR-0002-canonical-distribution-architecture.md)
Model B) and runs **over HTTP**:

```bash
node tools/build-package.js     # dist/package/ + ZIP + dist/package-manifest.json
node tools/serve-package.js     # http://127.0.0.1:8765/ under the production header contract
```

`file://` is not a supported way to run TAM OS. Earlier single-file releases (`dist/*.html`) are
frozen history, kept byte-identical and never rebuilt.

All data is stored **locally** in the browser's `localStorage` (or the Claude Artifact storage
environment). Nothing is transmitted to a server. The page makes **no third-party network request**:
typography is embedded and the spreadsheet parser is served from the package itself. Two browsers —
including two visitors to the same hosted copy — hold two independent datasets.

## 3. Local / offline data handling

- Data is persisted under a fixed set of stable storage keys and a schema version; a fresh install is
  empty. See [`DATA-SAFETY.md`](DATA-SAFETY.md) for the enumerated keys and migration rules.
- **Recovery contract:** the Complete Backup JSON export/import is the supported recovery path;
  destructive actions snapshot data first and require typed confirmation. Complete Backups are company
  data — store them in the private layer (`backups/`), never in this repo.

## 4. Import / export boundaries

- **Import (in):** Smart Import reads spreadsheets locally in the browser to extract
  employees/contracts/transactions, with column mapping and duplicate prevention. Source spreadsheets
  are private data — keep them in the private layer's `workbooks/`.
- **Export (out):** CSV exports and Complete Backup JSON are generated locally and downloaded by the
  user. Employee bank-account numbers are masked in the general CSV export. Treat every export as
  confidential and keep it in the private layer.

## 5. Reporting read models (read-only)

Historical reporting is derived, never mutated:

- `payrollHistoricalSnapshot(pp)` is the immutable source of truth for a committed payroll row
  (Posted/Executed values come from committed evidence, never reconstructed from current master data).
- `payrollTotalCompensation(pp)` is a **read-only** aggregate over that snapshot plus committed
  (Posted/Executed) supplementals; it never mutates data and never redefines the base payroll total.

These read models are pure display logic; they do not change persistence, finance, or payroll state.

## 6. Release & verification

Releases are tag-driven and guarded; the tag must equal the source `APP_VERSION` or the workflow
publishes nothing. Every change is verified (`node tools/verify-build.js`) and built
(`node tools/build-package.js`) — the verifier enforces package determinism and fidelity, the frozen
historical releases, the strict-CSP shape, version identity, the schema version, the storage-key set,
the empty seed, and the reporting invariants. The release assets are the package ZIP and its
manifest. Full steps:
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md); QA gate: [`QA-CHECKLIST.md`](QA-CHECKLIST.md).

## 7. Maintaining the private layer (PT Total Asset Manajemen)

1. Keep the source core (this repo) and the private layer in **separate locations**. If the private
   layer becomes a Git repository, keep it **private** and never add this repository's remote to it.
2. Put the real workbook, exports, backups, branding, and deployment config in the private layer only.
3. To run against real data: open the app locally and load a Complete Backup, or import the private
   workbook — all locally, on a company-controlled device.
4. If any confidential file is ever committed to the source core by mistake, treat it as disclosed:
   purge it from history, rotate anything sensitive, and follow [`SECURITY.md`](../SECURITY.md).

## 8. Production hosting — target (not yet cut over)

**Target:** `https://finance.reliabilityindonesia.com`, on the company's existing **Hostinger Premium
Web Hosting** (hPanel), which it shares with the `reliabilityindonesia.com` web presence. It is **not**
a VPS. HOSTING-0 (2026-09-29) observed that the hostname already resolves to Hostinger with valid HTTPS
behind Hostinger's CDN, and that it serves the Hostinger default page — **TAM OS is not deployed
there.** A separately hosted TAM OS copy exists but is **pre-operational**: no real company data has
been entered, and none may be until the cutover gate below is met.

**Role — same origin, per [ADR-0004](03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md).**
The same host will serve both halves of TAM OS from one origin:

- `/` — the static TAM OS frontend;
- `/api/*` — a PHP 8.3 backend over MariaDB/MySQL (InnoDB).

The browser never reaches the database. **No separate managed backend service and no VPS are
required.** The backend is **not deployed** and only its foundation (HTTP, data layer, migration
machinery, the BF-3A authentication schema and session endpoints, and the BF-3B account lifecycle and
operator CLI — no authorization policy or business schema) exists in source; it is **not
production-ready**. See [`Milestones.md`](05-milestones/Milestones.md)
for Multi-User status. Supabase, selected by the superseded ADR-0003, is not the target.

**Deployment dependency — Overtime approval (owner decision D-BF4b2-5 = A).**
BF-4b2 and AFI-4b2 must be deployed together. BF-4b2 lets the CEO approve overtime (an `Approved`
status), and the AFI-4b1 SESSION Overtime client deliberately fails closed on that status, so there must
never be a production interval in which the backend can create Approved records while the deployed
frontend is AFI-4b1 only. AFI-4b2 is that frontend counterpart (it understands Approved and the
valuation projection); both halves now exist as source, neither is deployed, and they ship together.

**Deployment note — Payroll plans (BF-4c1).** BF-4c1 adds the payroll routes, migrations `0024`–`0026` and
no change to any existing response, so it carries no frontend pairing constraint of its own: it may be deployed
before a Payroll frontend exists. Its migrations must run before its routes are reachable. It is not deployed.

**Deployment note — SESSION Payroll (AFI-4c1).** AFI-4c1 calls the BF-4c1 payroll routes, so it needs BF-4c1 deployed
first (or with it). It changes no existing backend contract and adds no deploy-together constraint of its own: it
decodes every BF-4c1 status, Committed included (display-only). It is not deployed.

**Deployment note — Payroll Commit (BF-4c2).** BF-4c2 adds the commit and drift routes, migrations `0027`–`0028` and
lets an Employee read their own Committed plans through the existing reads. It keeps the CEO plan projection exactly as
BF-4c1 defined it, so it can be deployed behind AFI-4c1 (which shows Committed read-only) with no deploy-together
constraint; the Commit and My Payroll screens are AFI-4c2. Its migrations must run before its routes are reachable. It is
not deployed.

**Deployment note — SESSION Payroll Commit and My payroll (AFI-4c2).** AFI-4c2 calls the BF-4c2 commit and drift routes and
the Employee's self-read, so it needs BF-4c2 deployed first (or with it). It changes no backend contract and adds no
deploy-together constraint of its own. It is not deployed.

**Deployment note — Supplemental Payroll (BF-4d).** BF-4d adds the nine Supplemental Payroll routes and migrations
`0029`–`0031` (two new tables and the audit vocabulary); it changes no existing table's rows, no existing route and no
existing DTO — the base payroll plan keeps exactly its thirteen keys — so it is safe to deploy before any Supplemental
frontend and behind the AFI-4c2 frontend, with no deploy-together constraint of its own. Its migrations must run before its
routes are reachable. AFI-4d, the Supplemental screens, will need it deployed first (or with it). It is not deployed.

**Deployment note — SESSION Supplemental Payroll (AFI-4d).** AFI-4d calls the nine BF-4d Supplemental routes (the CEO's
month list, detail, eligibility and writes; the Employee's own Committed reads), so BF-4d — its routes and migrations
`0029`–`0031` — must be deployed before AFI-4d or with it. It changes no backend contract and no existing frontend contract,
and adds no other deploy-together constraint. It is not deployed.

**Deployment note — Finance posting (BF-4e).** BF-4e adds the three Finance posting routes and migrations `0032`–`0033` (one
new table, `finance_postings`, and the `post` audit operation); it changes no existing table's rows, no existing route and no
existing DTO, so it can be deployed behind a frontend that does not call it (any release before AFI-4e) with no
deploy-together constraint of its own; AFI-4e calls it (below). Its migrations must run before its routes are reachable, and it posts only obligations committed by
BF-4c2 and BF-4d, which must already be deployed. It is not deployed.

**Deployment note — SESSION Finance posting (AFI-4e).** AFI-4e calls the three BF-4e Finance posting routes (the CEO's
month read and the two posting commands), so BF-4e — its routes and migrations `0032`–`0033` — must be deployed before
AFI-4e or with it. It changes no backend contract and no existing frontend contract, and adds no other deploy-together
constraint. It is not deployed.

**Deployment note — Finance execution (BF-4f).** BF-4f adds the two Finance execution routes and migrations `0034`–`0035`
(one new table, `finance_executions`, and the `finance.execute` / `execute` audit vocabulary); it changes no existing table's
rows, no existing route and no existing DTO, and no frontend calls it yet, so it can be deployed behind the current frontend
with no deploy-together constraint of its own. Its migrations must run before its routes are reachable, and it executes only
BF-4e postings, so BF-4e (`0032`–`0033`) must already be deployed. Before real payment records are entered, the backup
prerequisite and SDR-0002's pre-deployment evidence must be in place. It is not deployed.

**Deployment note — SESSION Record payment (AFI-4f).** AFI-4f calls the two BF-4f Finance execution routes (the CEO's month
read and the one execution command), so BF-4f — its routes and migrations `0034`–`0035`, and therefore BF-4e (`0032`–`0033`)
before it — must be deployed before AFI-4f or with it; the dependency chain is BF-4c2 / BF-4d → BF-4e → BF-4f → AFI-4f.
Against a backend without the BF-4f routes the payment status fails closed (it cannot be read, so Record payment is never
offered), but that is not a supported configuration. AFI-4f changes no backend contract and no existing frontend contract,
and adds no other deploy-together constraint. The same backup prerequisite and SDR-0002 evidence apply before real payment
records are entered. It is not deployed.

**Deployment note — SESSION Audit history (AFI-4g).** AFI-4g calls BF-4g's two audit reads (`GET /api/audit-events` and
`GET /api/audit-events/record`), so BF-4g must be deployed before AFI-4g or with it. BF-4g adds no migration (head **0035**)
and AFI-4g changes no backend contract. Against a backend without the BF-4g routes the Audit section shows a failure and
nothing else, but that is not a supported configuration. `tools/serve-e2e-proxy.js` is test-only and is never deployed. It
is not deployed.

Plan facts confirmed by the maintainer in hPanel (2026-09-29):

| Facility | State |
|---|---|
| PHP | 8.3, with PHP configuration and extensions in hPanel |
| Database facility | Available |
| SFTP | Available |
| SSH | Available but **inactive** |
| SSL / CDN | Active |
| Provider backups | **Weekly** |

**Source of truth.** Git `main` is canonical. Files on the host are deployment copies, never source;
nothing is edited on the server. A local copy of the artifact outside `dist/` is a convenience copy,
not a release input. Hosting credentials, database credentials, server paths and account details
belong in the private layer (§1), never in this repository.

**Governed deployment flow:**

1. Canonical `main` at the release commit/tag (per [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md)).
2. A passing verifier, then `node tools/build-package.js`; the rebuilt `dist/package-manifest.json`
   must equal the committed one.
3. Take the package ZIP (or `dist/package/`) and confirm its SHA-256 equals the manifest's
   `zip.sha256`.
4. Upload the **contents** of the package over SFTP (currently via WinSCP) to the Hostinger document
   root, so `index.html` sits at `/`. Nothing else from the repository is uploaded.
5. Spot-check deployed files against the manifest's per-file SHA-256, then run a production smoke
   test.

**The package (Distribution-1).** Every file is a byte-identical copy of its source file at the same
relative path: `index.html`, the six stylesheets, the pre-paint `js/boot/theme-boot.js`, every
module-order script, vendored SheetJS, and the licence texts. It has no inline executable script and
no third-party request, so it runs under a strict Content-Security-Policy. The API base is the
relative same-origin `/api` — there is no runtime configuration file, key or absolute URL (ADR-0004
§2.5).

**Response-header contract.** The headers the host must send are defined once, in
[`tools/package-headers.js`](../tools/package-headers.js), which `tools/serve-package.js` applies
locally and the verifier checks. In summary:

- **CSP:** `script-src 'self'` with no `'unsafe-inline'` / `'unsafe-eval'`; `style-src 'self'`;
  `connect-src 'self'`; `object-src`, `base-uri`, `frame-ancestors` `'none'`; `data:` only for fonts and
  images.
- **Security headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`; HSTS only per SDR-0002 §13.1.
- **Documented exception — inline style attributes.** `style-src-attr 'unsafe-inline'` is the one
  relaxation. About 457 `style="…"` attributes in UI templates across 33 modules (420 static layout
  values, 37 runtime-computed) predate Distribution-1. Moving them into classes is a broad UI and
  CSS-golden-master change, so it is **tracked follow-up work**, not part of this package change.
  `<style>` elements and style URLs stay restricted to `'self'`, and scripts are unaffected.

Applying these headers on Hostinger (for example via `.htaccess`) is a deployment step for the backend
readiness milestones; nothing here configures the host.

**Cache model.**

| Path | Cache-Control | Why |
|---|---|---|
| `/` and every package file | `no-cache` (revalidate) | Filenames are not content-hashed, so no file may be cached as immutable; a stale script beside a fresh `index.html` must be impossible |
| `/api/*` | `no-store, private` | Never cached by the browser or the CDN (SDR-0002 §13.3) |

The Hostinger CDN must honour both before real data (SDR-0002 E5). Content-hashed filenames with
long-lived caching are a possible later optimization, not a requirement.

**Schema changes.** The database schema changes only through `php server/bin/migrate.php apply`
(`status` reports without changing anything); there is no migration endpoint and nothing migrates at
start-up. `/api/ready` answers 503 until the schema is exactly current. How that command will be run on
Hostinger — SSH is currently inactive — is a pre-deployment decision, as is whether migrations use
separate database credentials from the runtime API.

**Mandatory pre-deployment verifications (backend):**

- backend configuration and secrets can live **outside the public web root**;
- `/api/*` responses are never publicly cached by the CDN (for example `Cache-Control: no-store,
  private`);
- the required PHP extensions are present;
- cron is available for the nightly database dump and for the BF-3D mail worker
  (`php server/bin/mail.php run`, at a recorded interval);
- (BF-3D) the governed-mail evidence of [SDR-0003](security/SDR-0003-governed-mail-transport.md) §7:
  outbound HTTPS to the provider with a trusted CA bundle, the sender domain verified with SPF, DKIM
  and DMARC published, a delivery test to an owner-controlled mailbox with fabricated content, and the
  send-only key stored only in the configuration file outside the web root;
- database transactions (InnoDB) behave as designed;
- (BF-3A) the server engine and version enforce the schema's CHECK constraints; Argon2id is available
  (or the bcrypt fallback is recorded) and its 64 MiB per verification fits the host's limits; the
  `__Host-tamos_session` cookie (`Secure`, `HttpOnly`, `SameSite=Strict`) passes LiteSpeed and the CDN
  unchanged; which client address `REMOTE_ADDR` carries behind the CDN (a shared edge address would
  make the per-IP login limit global); and whether the runtime database user can be denied
  `UPDATE`/`DELETE` on `auth_events`;
- (BF-3B) the server engine applies `0008` (`ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT …`) and
  honours `GET_LOCK`; how `php server/bin/account.php` (the first-CEO bootstrap and break-glass reset) is
  run on the host, by whom, and how its one-time activation token reaches the CEO out of band without
  being stored in a log or ticket.

**Backup target:**

1. Hostinger's automatic backup (currently Weekly) as the provider baseline.
2. A nightly cron database dump, encrypted, with an off-host copy in the private layer.
3. Periodic restore rehearsal, with row counts and monetary totals reconciled.

Target RPO is about 24 hours; PITR is not required initially.

**Deployment note — Encrypted database backup (OPS-1).** OPS-1 implements item 2 as operator tooling,
`server/bin/backup.php` (see `ARCHITECTURE.md` → Encrypted database backup — OPS-1). It adds no route, migration, Action or
package file and changes no existing behaviour, so it has no deploy-together constraint; it needs the database schema it
backs up (any head; pending migrations are allowed). Restore and the rehearsal are OPS-2. It is not deployed.
The runbook, with every value kept in the private layer:

1. **Keys, off-host, once.** On the owner's machine (never the host):
   `php server/bin/backup.php keygen --secret-key-file=<private layer>/tamos-backup.key`. Keep two copies of that file in
   the private layer; losing every copy makes every backup unreadable. Put the printed `public_key` into the host
   configuration.
2. **Host configuration.** Add the `backup` section (`dir`: an existing directory outside the public web root and outside the
   application, writable only by the account's PHP; `public_key`) to the configuration file outside the web root.
3. **Schedule.** An hPanel cron job runs `php <app root>/bin/backup.php create` nightly, after the business day; it prints the
   backup id and counts and writes one line to the API log. A run that finds another backup or a migration in progress
   exits 1 without writing anything.
4. **Pull off-host.** The owner copies each new `tamos-backup-<id>.tamosbk` **and** its `.sha256` over SFTP into the private
   layer, then runs `php server/bin/backup.php verify --file=<backup> --secret-key-file=<key> --previous=<the last verified
   backup>`; exit 0 is required. Off-host retention: 30 daily and 12 monthly backups. The host keeps the newest 7 by itself.
5. **Watch.** `php <app root>/bin/backup.php status` exits 1 when there is no backup, the newest is older than 26 hours, or
   any backup is damaged.
6. **Before every migration on a database that holds real data:** run `create`, pull and `verify` the new backup, and only
   then `php server/bin/migrate.php apply` (D-AB-13). The first deployment applies the migrations to an empty database, so it
   needs no prior backup; the first backup is taken and verified before real data is entered.

Host evidence still needed (SDR-0002 E2, E4, E7): the PHP CLI that hPanel cron runs, with the `sodium` and `zlib`
extensions; its time and memory limits for a full backup; and an off-host restore rehearsal with reconciled row counts and
money totals (OPS-2) before PILOT-1 (D-AB-14).

**Deployment note — Restore and restore rehearsal (OPS-2).** OPS-2 implements item 3 as operator tooling,
`server/bin/backup.php restore` and `verify-restore` (see `ARCHITECTURE.md` → Database restore — OPS-2). It adds no route,
migration, Action or package file and nothing runs on the host, so it has no deploy-together constraint. It is not
deployed. Restore runs **off-host only** (D-OPS2-1 = A): the backup secret key never goes to the production host, and both
commands refuse where the default configuration is the production one. Every value — key file, target configuration,
evidence — stays in the private layer.

**Restore rehearsal (D-AB-14, SDR-0002 E7) — required before PILOT-1.** CI and the test suites prove the tool, not the
recovery; E7 stays open until this rehearsal passes with an actual encrypted host backup:

1. **Machine.** The owner's machine with PHP 8.3 (`pdo_mysql`, `sodium`, `zlib`) and a clean checkout of the merged commit
   that is being relied on; record `git rev-parse HEAD`.
2. **Separate, disposable database.** A MariaDB server on that machine (record its version — ideally the host's major
   version) with a new, empty database used for nothing else, and a target configuration file for it in the private layer
   (`env` development, `db` pointing at it).
3. **Migrate it:** `TAMOS_CONFIG=<rehearsal config> php server/bin/migrate.php apply` → `migrations: current`.
4. **An actual backup.** Take the newest backup pulled from the host and verify it with its chain:
   `php server/bin/backup.php verify --file=<backup> --secret-key-file=<key> --previous=<the last verified backup>` → exit 0.
5. **Restore:** `php server/bin/backup.php restore --file=<backup> --secret-key-file=<key> --target-config=<rehearsal config>`
   → exit 0, `restore: PASS`. Keep the standard output: it is the evidence.
6. **Prove it independently:** `php server/bin/backup.php verify-restore` with the same arguments → exit 0.
7. **Tear down:** drop the rehearsal database and delete its configuration file.

**Evidence to keep** (none of it is a secret or a business value): the backup id; the manifest SHA-256; the key
fingerprint; the source and target fingerprints and environments; the backup, target and code migration heads; each
table's row count with "ok", "decimal totals: matched", "excluded: 4 empty", the verification stages; start, finish and
duration; both exit codes and the final PASS / FAIL; the git commit and the MariaDB version. Never keep or paste row
values, money totals, the key, the configuration or any credential. Repeat the rehearsal periodically and after real data
is entered.

**Production restore (disaster recovery).** Only from the owner's machine, never on the host:

1. Put the site into maintenance so the API writes nothing; provision a new, empty production database (or empty the
   damaged one by the provider's tools — restore itself never truncates) and run `php server/bin/migrate.php apply` on the
   host so its schema is at the backup's head. A backup taken before a migration (D-AB-13) is restored with the code at its
   own migration head and migrated forward afterwards.
2. Open an **SSH tunnel** from the owner's machine to the database (`ssh -L <local port>:<database host>:3306 <account>`)
   and write an off-host target configuration with `env` production and `db.host` 127.0.0.1 and the local port. Direct
   remote MySQL is not authorized under the current PDO/TLS model. If the hosting cannot forward the port, stop: the key
   is never moved to the host — the question returns to the owner, and the provider restore is the fallback.
3. Choose a backup that was pulled and verified off-host, with its `--previous` chain recorded, from before the incident —
   the public key is not secret, so a backup's origin rests on that custody.
4. Run `restore` with that configuration. It shows the backup id, key, source and target and asks for the exact line
   `RESTORE <backup id> INTO <target fingerprint>`; anything else writes nothing. A backup of a non-production database is
   refused for a production target.
5. Exit 0 is the only success. Exit 1 committed nothing — fix the cause and retry. Exit 3 (`restore_unproven`) means the
   restore committed but was not proven: run `verify-restore`; if it fails, empty and recreate the database and restore again.
6. Run `verify-restore`, end maintenance, and keep the evidence. Everyone signs in again; passwords are unchanged. Take
   and verify a new backup.

Host evidence still needed for production restore: whether Hostinger allows SSH port forwarding to the database (before
PILOT-1). E7 remains open until the restore rehearsal above passes.

**Cutover gate.** TAM OS replaces the default page at `finance.reliabilityindonesia.com` — and real
company data may be entered — only when **all** of the following hold. A visible login form is not
readiness.

- [ ] Canonical production build verified; deployed hash matches the release artifact
- [ ] HTTPS valid on the production hostname
- [ ] Authentication operational: sign-in, session rotation, logout, password recovery/reset, rate
      limiting
- [ ] Disabled and unauthorized accounts are denied
- [ ] User → membership → employee mapping verified
- [ ] Shared persistence verified across separate browsers/devices
- [ ] Server-side authorization and data scope verified with hostile-principal tests that bypass the UI
- [ ] `/api/*` is never publicly cached
- [ ] No "Acting as" selector in production
- [ ] No secret in the frontend, the repository or the public web root
- [ ] Nightly encrypted off-host database dump running, and a restore rehearsed
- [ ] External security review completed, with findings resolved or explicitly accepted
- [ ] Authenticated end-to-end tests pass
- [ ] Production smoke test passes

## 9. Responsible disclosure

Security issues must be reported **privately** by email to <fanoryu@gmail.com> (subject
`TAM-OS Security Report`) — see [`SECURITY.md`](../SECURITY.md). Do not file a vulnerability as an
issue, and never include real company data in a report.
