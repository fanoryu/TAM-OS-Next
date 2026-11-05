# Backend Deployment Runbook — Staging First (WP-2)

| Field | Value |
|---|---|
| **Status** | Governed procedure. **It authorizes nothing**: Gate D and Gate R stay on **HOLD**; every deployment, host change, SSH enablement, tag and release needs its own Owner authorization (`CLAUDE.md` §20) |
| **Scope** | The first deployment of the frontend package **and** the PHP backend to Hostinger, as **staging with fabricated data only** (Owner direction 2026-11-05), then the requirements that remain mandatory before production |
| **Governing records** | [ADR-0004](03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md), [SDR-0002](security/SDR-0002-php-mariadb-security-architecture.md) (§13–§19, §22), [SDR-0003](security/SDR-0003-governed-mail-transport.md), [SDR-0006](security/SDR-0006-hostinger-account-access-risk-exception.md), [SDR-0007](security/SDR-0007-recovery-mailbox-two-factor-exception.md), [`DEPLOYMENT.md`](DEPLOYMENT.md) §8 |
| **Header source of truth** | [`tools/package-headers.js`](../tools/package-headers.js), rendered for the host by [`tools/hostinger-htaccess.js`](../tools/hostinger-htaccess.js) |

Where this runbook and an SDR could be read differently, the SDR governs. Nothing here relaxes a control:
it only says how each control is met on the host and what evidence proves it.

**Conventions.** `<docroot>` is the staging hostname's document root, `<app>` its parent directory, and
`<private layer>` the owner's off-host store (`DEPLOYMENT.md` §1). Every real value — hostname, account
path, database name, user, password, key, token — lives in the private layer and **never** in this
repository, a ticket, a chat or a screenshot. The examples below use placeholders only.

---

## 1. Preconditions — stop if any is missing

| # | Precondition | Source |
|---|---|---|
| S-1 | A separate Owner authorization for a **staging** deployment (Gate D, staging scope) naming the commit to deploy | `CLAUDE.md` §20 |
| S-2 | SDR-0006 X1–X8 (and SDR-0007 M1–M3) evidenced in the private layer; otherwise the staging exception is **not in force** | SDR-0006 §4, SDR-0007 §3 |
| S-3 | A **staging hostname** with valid HTTPS, whose `<docroot>` parent `<app>` is **not** inside any web root (not inside the apex site's `public_html`) | §2, SDR-0002 E1 |
| S-4 | A **dedicated** staging database and database user, used by nothing else; staging-only secrets (SDR-0006 C6) | SDR-0002 §18 |
| S-5 | A dedicated SFTP deployment credential distinct from the hPanel password (SDR-0006 C7) | SDR-0006 |
| S-6 | A way to run the PHP CLI on the host: key-based SSH (preferred — separate Owner approval and host-capability check) **or** the no-SSH path of §5.2 for this staging deployment | §5 |
| S-7 | Only **clearly fabricated** data will be entered. Real company data voids the staging exception (SDR-0006 §2.6) | `CLAUDE.md` §12.5 |

## 2. What goes where (web root versus private files)

Three artifacts, all from the **same** authorized commit, are deployed — nothing else from the repository.

```
<app>/                              NOT web-served (the parent of the document root)
├── src/                            server/src/**            (the backend; required by api/index.php)
├── bin/                            server/bin/*.php         (operator CLIs: migrate, account, backup, mail)
├── migrations/                     server/migrations/*.sql
├── config/config.local.php         the real configuration (§3) — mode 0600, never in <docroot>
├── logs/                           the API log (`log_path`)
├── backups/                        the encrypted backup directory (`backup.dir`, OPS-1)
└── <docroot>/                      web-served
    ├── .htaccess                   rendered by tools/hostinger-htaccess.js (§6)
    ├── index.html, css/, js/, vendor/, …   the Distribution-1 package, byte-identical to its manifest
    └── api/
        ├── index.php               server/public/api/index.php (requires <docroot>/../src/bootstrap.php)
        └── .htaccess               server/public/api/.htaccess (routes /api/* to index.php)
```

The layout is not a preference: `api/index.php` loads `dirname(__DIR__, 2) . '/src/bootstrap.php'`, every CLI
loads `dirname(__DIR__) . '/src/bootstrap.php'`, and `ConfigLoader::resolvePath()` defaults to
`<app>/config/config.local.php` (or `TAMOS_CONFIG`). The API refuses a configuration file, log or backup
directory **inside** the document root it is served from.

**Never uploaded:** `server/tests/`, `server/dev/` (the development router is test-only), `server/config/`
(the example holds placeholders only), `tools/`, `docs/`, `.github/`, `dist/*.html`, any `config.local.*`.

**Hostinger pitfall.** A sub-domain's document root can be created *inside* the apex site's `public_html`
(for example `public_html/<sub>/`). Then `<app>` would be web-served and `src/`, `bin/` and `config/` would be
reachable over HTTP. Such a placement fails S-3: choose a document root whose parent is private, or stop.

### 2.1 Assemble the upload set off-host

On the owner's machine, from a clean checkout of the authorized commit (record `git rev-parse HEAD`):

```bash
node tools/verify-build.js                     # must pass
node tools/build-package.js                    # rebuilds dist/package/ and the ZIP
git diff --exit-code dist/package-manifest.json   # the rebuilt manifest equals the committed one
sha256sum dist/tam-os-v<version>-package.zip   # must equal the manifest's zip.sha256
git archive HEAD server/src server/bin server/migrations server/public/api | tar -x -C <upload dir>
node tools/hostinger-htaccess.js > <upload dir>/docroot.htaccess
node tools/hostinger-htaccess.js --sha256      # record it; it must match the uploaded file
```

The archive keeps the `server/` prefix: `server/src`, `server/bin` and `server/migrations` go to `<app>/src`,
`<app>/bin` and `<app>/migrations`; `server/public/api/` goes to `<docroot>/api/`.

Record in the private layer: the commit, the package digest, the ZIP SHA-256, the `.htaccess` SHA-256 and a
SHA-256 list of the backend files (`find <upload dir> -type f -exec sha256sum {} +`).

## 3. Configuration and secret isolation

The configuration is one PHP file, `<app>/config/config.local.php`, written from
[`server/config/config.example.php`](../server/config/config.example.php) in the private layer and uploaded
over SFTP with mode `0600`. The loader rejects unknown keys and any value still containing `CHANGE_ME`.

| Key | Staging value | Rule |
|---|---|---|
| `env` | `production` (recommended — Owner decision OD-W2-1) | `production` demands an `https://` origin, sends HSTS on `/api/*` over HTTPS (`Kernel.php`), omits stack traces from the log, and makes `backup.php keygen/verify/restore` refuse to run on the host. It also labels every staging backup `source.env = production` — see §7.1. `development` would log redacted traces and send no HSTS |
| `origin` | `https://<staging hostname>` exactly | State-changing requests must come from exactly this origin (SDR-0002 §3.4) |
| `log_path` | `<app>/logs/api.log` | Absolute; outside the document root |
| `db` | the dedicated staging database and user | The password is a staging secret (SDR-0006 C6) |
| `mail` | **omitted** for the CEO-only staging (Owner decision 5) | Without it recovery requests queue and nothing is sent. Adding it needs the SDR-0003 §7 evidence first |
| `backup` | `dir`: `<app>/backups`; `public_key`: from an off-host `keygen` with a **staging** key pair | The secret key file never comes to the host (D-AB-9, D-OPS2-1) |

Secrets are generated in the password manager, held in the private layer, transferred only over SFTP, and
never pasted into hPanel fields that echo them, chat, email or a ticket. The repository and the document
root never hold one (SDR-0002 §14, invariant 15). Staging secrets are never reused for production.

## 4. PHP and MariaDB prerequisites (host evidence)

Record each result in the private layer before the first migration. Where SSH is unavailable, run the
command once through an hPanel cron job whose output is redirected to a private file (§5.2) and read over SFTP.

| # | Requirement | How to check | SDR-0002 |
|---|---|---|---|
| H-1 | PHP **8.3** for both the web SAPI of the staging host and the CLI that cron (or SSH) runs — they can differ on shared hosting | `php -v`; the hPanel PHP version of the hostname | E2 |
| H-2 | Extensions `pdo_mysql`, `openssl`, `mbstring`, `sodium`, `zlib` (backup), `curl` (only once mail is configured) | `php -m` | E2 |
| H-3 | Argon2id available, or the bcrypt fallback recorded; 64 MiB per verification fits `memory_limit` | `php -r 'var_dump(defined("PASSWORD_ARGON2ID"));'`; `php -i \| grep memory_limit` | E2 |
| H-4 | MariaDB/MySQL version recorded; InnoDB; CHECK constraints enforced; `ALTER TABLE … DROP CONSTRAINT` (migration 0008) and `GET_LOCK` work | the migration run itself (§5) fails closed otherwise | E3 |
| H-5 | Whether the runtime database user can be denied `UPDATE`/`DELETE` on `auth_events` and `audit_events` (least privilege) | hPanel database-user privileges | E9 |
| H-6 | Cron available, its time and memory limits recorded (nightly backup; later the mail worker) | hPanel cron | E4 |
| H-7 | The physical location of the hosting data recorded (hPanel server location) | hPanel | E8 |

## 5. Migrations and first CEO provisioning — without assuming SSH

The schema changes **only** through `php <app>/bin/migrate.php apply` (`status` is read-only); nothing
migrates at start-up and there is no migration endpoint. `/api/ready` answers 503 until the schema is
exactly current. The first CEO comes into existence **only** through
`php <app>/bin/account.php create-ceo --email=<address>`, which prints a one-time 72-hour activation token on
standard output exactly once (the database keeps only its SHA-256).

### 5.1 Path A — key-based SSH (preferred; Owner decision 4)

Only after the Owner approves enabling SSH and the host's support for key-based login is verified. The key
is the deployment holder's (SDR-0006 C7); no password login.

```bash
cd <app> && TAMOS_CONFIG=<app>/config/config.local.php php bin/migrate.php status
TAMOS_CONFIG=<app>/config/config.local.php php bin/migrate.php apply    # -> "migrations: current"
TAMOS_CONFIG=<app>/config/config.local.php php bin/account.php create-ceo --email=<staging CEO address>
```

The token is read from the terminal, never copied into a file, log, ticket or chat. The operator gives the
CEO the link `https://<staging hostname>/#activation=<token>` **out of band** (spoken, or typed on the CEO's
device); the CEO sets a password there (no auto-login) and then signs in. If the token expires or its
custody is in doubt: `php bin/account.php reset-credentials --email=<address>` issues a new one and revokes
the old.

### 5.2 Path B — no SSH: one-shot hPanel cron jobs

`migrate.php` prints migration versions and reason codes only — never a credential, DSN, SQL or value — so its
output may be kept as evidence. Create a cron job, let it run once, then **delete the cron job**:

```
php <app>/bin/migrate.php apply > <app>/logs/migrate-<date>.txt 2>&1
```

(`TAMOS_CONFIG` is not needed when the configuration sits at its default `<app>/config/config.local.php`.)
Disable any cron e-mail notification first: cron output must go only to the redirected private file.

`create-ceo` is different: its standard output **is** a credential. `DEPLOYMENT.md` §8 requires that the token
reach the CEO out of band "without being stored in a log or ticket". A cron run necessarily writes it to a
file on the host first. That is therefore **not** part of the default procedure; it is Owner decision
**OD-W2-2**, offered for **synthetic staging only** and only with every control below:

1. The output goes to a new file under `<app>/` (never `<docroot>/`), created by the cron run itself with
   `umask 077`: `umask 077; php <app>/bin/account.php create-ceo --email=<address> > <app>/ceo-activation.txt 2>&1`.
2. The cron job is deleted immediately after its single run.
3. The file is pulled over SFTP, deleted from the host at once, and the token is used within the hour.
4. If any step deviates (the cron ran twice, the file was not deleted, the token was seen by anyone else),
   run `reset-credentials` and repeat.
5. Production never uses this path unless the Owner decides so separately; SSH (Path A) is the production path.

Without SSH and without OD-W2-2, CEO provisioning is **BLOCKED** — there is no HTTP bootstrap and none may be added.

## 6. Static and API security headers

**Static files** get their headers from `<docroot>/.htaccess`, rendered by `node tools/hostinger-htaccess.js`
(staging: no HSTS). It sets every header of `STATIC_HEADERS` once with `Header always set`, excludes
`/api/*` (`SetEnvIf Request_URI "^/api(/|$)" TAMOS_API` + `env=!TAMOS_API` on every line), has no
`<IfModule>` wrapper (a host without `mod_headers` fails with 500 rather than serving the package without its
Content-Security-Policy), turns off directory listings and serves `.js` / `.css` with explicit UTF-8 types
(the package is served under `nosniff`). `tools/verify-build.js` (WP-2) pins all of this — but only a probe on
the host proves that LiteSpeed applies it (SDR-0002 E6).

**`/api/*`** gets its headers from PHP (`server/src/Http/ApiHeaders.php`, mirroring `API_HEADERS`):
`Cache-Control: no-store, private`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
`nosniff`, `Referrer-Policy`, and HSTS when `env` is `production` and the request is HTTPS.

**HSTS.** Static HSTS is only in the `--production` rendering and only after production Gate D (SDR-0002
§13.1: start once HTTPS is stable, no `includeSubDomains`, no preload — the apex site shares the domain).

### 6.1 Host probe (E1, E5, E6) — after upload, before the first sign-in

| # | Request | Expected |
|---|---|---|
| HP-1 | `curl -sI https://<host>/` and `/index.html` | 200; the exact `Content-Security-Policy` of `package-headers.js`; `X-Content-Type-Options: nosniff`; `Referrer-Policy`; `Permissions-Policy`; `Cross-Origin-Opener-Policy: same-origin`; `Cache-Control: no-cache`; no HSTS (staging) |
| HP-2 | `curl -sI https://<host>/js/core/constants.js` and `/css/shell.css` | 200; `Content-Type: text/javascript; charset=utf-8` / `text/css; charset=utf-8`; the static headers |
| HP-3 | `curl -si https://<host>/api/health` | 200 JSON; `Cache-Control: no-store, private`; `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; **not** the static CSP or `no-cache` (proves the `/api` exclusion) |
| HP-4 | `curl -si https://<host>/api/ready` | 200 once migrated (503 before) |
| HP-5 | `/api/health` twice, then `/api/auth/me` | no CDN cache hit on any `/api/*` answer (record the CDN's cache headers); `/api/auth/me` 401 |
| HP-6 | `curl -sI https://<host>/src/bootstrap.php`, `/config/config.local.php`, `/bin/migrate.php`, `/migrations/0001_create_companies.sql`, `/api/` directory listing, `/js/` directory listing | 404 or 403 — never a file body, never a listing (proves the placement of §2) |
| HP-7 | Sign in with the fabricated staging CEO | the `__Host-tamos_session` cookie arrives with `Secure; HttpOnly; SameSite=Strict; Path=/` unchanged through the CDN; record which client address the API sees for the per-IP login limit (a shared CDN edge address would make it global) |

The page itself must load with **zero** console errors and **zero** CSP violations (`CLAUDE.md` §19).

## 7. Staging deployment procedure

Each step has a recorded result in the private layer; any unexpected result stops the deployment.

1. Confirm S-1 … S-7. Restate the authorized commit; verify §2.1 off-host.
2. Generate the staging backup key pair **off-host** (`backup.php keygen`, two copies of the secret key in the
   private layer); put only the public key into the configuration.
3. Create `<app>/config`, `<app>/logs`, `<app>/backups` (private, outside `<docroot>`); upload
   `config.local.php` (`0600`).
4. Upload the backend tree (`src/`, `bin/`, `migrations/`) to `<app>/`, then `api/index.php` and `api/.htaccess`
   to `<docroot>/api/`; spot-check SHA-256 values against §2.1.
5. Upload the package contents to `<docroot>/` and the rendered `.htaccess` as `<docroot>/.htaccess`; spot-check
   the manifest's per-file SHA-256 values.
6. Record §4 (H-1 … H-7).
7. Migrate (§5): `migrations: current`; `/api/ready` 200.
8. Run the host probe (§6.1).
9. Provision the CEO (§5), activate, sign in (fabricated identity only).
10. Smoke test: sign-in and sign-out; Account security — Change password (the other session ends) and Sign out
    all devices; Employees list; an Audit month; Overtime and Payroll pages open; a wrong password is refused;
    reload keeps the session; zero console errors and CSP violations.
11. Backups: schedule `php <app>/bin/backup.php create` nightly; after the first run pull the backup and its
    `.sha256` over SFTP and `verify` off-host (`DEPLOYMENT.md` §8, OPS-1).
12. Record the deployment: commit, digests, probe results, smoke-test results, time, operator.

### 7.1 Staging backups under `env = production` (F-1)

With `env = production` the staging API records **`source.env = production`** in every backup manifest it
creates. The restore tool's environment check (`BackupRestorer::requireConfirmation`) refuses a *non*-production
backup for a production target, so it **cannot tell a staging backup from a production one**. Nothing in the
backup or restore implementation changes for this; the following operating rules close the gap and are mandatory:

1. **Separate key pairs.** Staging and production each have their own off-host backup key pair, generated
   separately, stored separately and labelled with their environment; a key pair is never shared or copied between
   them (SDR-0006 C6). A staging backup is sealed to the staging public key, so the production secret key refuses it
   (`WRONG_KEY`) — this is the cryptographic guard, and it holds only while the keys stay separate.
2. **Record the fingerprints.** At key generation and at each environment's first backup, record the staging and
   production key fingerprints and database fingerprints in the deployment record.
3. **Verify before every restore.** The operator compares the confirmation screen against that record before typing
   the phrase: the backup's **key fingerprint** and **source database fingerprint** must be those of the intended
   source environment, and the **target** shown must be the intended restore environment. Any mismatch stops the
   restore; it is not overridden.
4. **Never staging into production.** Restoring a staging backup into production is not an operational procedure
   under any circumstance (staging holds fabricated data only). Production restores use production backups only.

The existing safeguards stay in force unchanged: restore and verify-restore refuse to run where the configuration
is the production one, take their target only from `--target-config`, and require the typed confirmation phrase
for a production target.

## 8. Staging rollback

| Situation | Action |
|---|---|
| A probe (§6.1) or smoke test (§7.10) fails before any data | Stop. Replace `<docroot>/api/.htaccess` with a single `Require all denied` line to close the API, fix, redeploy from §7.4. Fabricated data only, so nothing needs saving |
| The new frontend or backend misbehaves after a successful earlier staging deployment | Close the API (as above), re-upload the **previous** verified package and backend tree from the private layer (same §2.1 checks), restore the previous `.htaccess`, reopen the API |
| A migration ran | Migrations are forward-only. Either keep the new schema with the previous code only if that code's head equals it (it will not, after a new migration), or — staging — drop and recreate the staging database and run the previous code's migrations; with a verified pre-migration backup, restore it **off-host** per `DEPLOYMENT.md` §8 (D-AB-13, D-OPS2-1) |
| A secret may be exposed | Rotate it (database password, backup key pair, hPanel/SFTP per SDR-0006 C4), then redeploy the configuration; treat as an incident under `SECURITY.md` |
| Real company data reached staging | Stop. The SDR-0006 exception no longer applies (§2.6): handle as a production deployment and an incident |

After any rollback everyone signs in again; passwords are unchanged unless the database was recreated.

## 9. Mandatory before production (not satisfied by staging)

Staging evidence is host-capability evidence. None of the following is met by a staging deployment:

- [ ] Separate production Gate D authorization, on a tagged release (`RELEASE-PROCESS.md`), deployed hash = release artifact.
- [ ] **E10:** two-factor authentication on the Hostinger account and its access holders listed (SDR-0006/0007 exceptions end).
- [ ] **E12:** the external security review completed, findings resolved or explicitly accepted by the Owner.
- [ ] **E8:** hosting data location recorded and accepted by the Owner (company compliance gate, SDR-0002 §19).
- [ ] **E7:** an off-host restore rehearsal of an actual **production** encrypted backup, reconciled (`DEPLOYMENT.md` §8).
- [ ] E1–E6 and E9 re-recorded on the production hostname and database (they are per host and per database user).
- [ ] Production-only secrets, database and backup key pair, never shared with staging (SDR-0006 C6); the staging and
      production key and database fingerprints recorded, and the §7.1 restore rules in force.
- [ ] Governed mail (SDR-0003 §7: provider account, SPF/DKIM/DMARC, delivery test) before password recovery or Employee onboarding is relied on — the cutover gate requires password recovery/reset to be operational.
- [ ] O4 backup retention set; nightly backup running and pulled off-host.
- [ ] Production HSTS rendering (`--production`) applied only after HTTPS is stable.
- [ ] CEO provisioning through Path A (SSH) unless the Owner decides otherwise for production.
- [ ] Every box of the `DEPLOYMENT.md` §8 cutover gate, and SDR-0002 §22 items 1 and 8 on the production host for Gate R.

## 10. Owner decisions this runbook depends on

| # | Decision | Recommended |
|---|---|---|
| OD-W2-1 | `env` on staging: `production` or `development` | `production` (production posture; HSTS on `/api/*` for the staging hostname only; staging backups labelled production, so the §7.1 rules are mandatory) |
| OD-W2-2 | CEO provisioning without SSH: allow the controlled cron-to-private-file path (§5.2) for synthetic staging | Prefer SSH (Path A); allow OD-W2-2 only if SSH cannot be enabled in time |
| OD-W2-3 | The staging hostname and its document root (must satisfy S-3) | A dedicated sub-domain whose document root's parent is private |
