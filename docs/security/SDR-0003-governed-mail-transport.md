# SDR-0003 — Governed Mail Transport

| Field | Value |
|---|---|
| **Record** | SDR-0003 |
| **Title** | Governed Mail Transport — transactional HTTPS API behind a provider-neutral boundary, delivered from a database outbox |
| **Status** | **Accepted** |
| **Author** | Maintainer |
| **Accountable approver** | Maintainer (`CLAUDE.md` §20) — owner decisions D-D1 and D-D3, 2026-10-01 |
| **Date created** | 2026-10-01 |
| **Next review** | Before the first real recovery mail (production cutover), then annually |
| **Supersedes** | — (refines the mail-transport detail of SDR-0002 §5 and §15; SDR-0002 stays Accepted and unchanged) |
| **Superseded by** | — |
| **Related** | [SDR-0002](SDR-0002-php-mariadb-security-architecture.md) §4, §5, §14, §15, §17, §20 (O5); [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md); [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8; `CLAUDE.md` §6.2, §17, §20 |

> **What this is.** The decision on *how* TAM OS sends its security mail (password recovery, BF-3D).
> SDR-0002 §5 says recovery mail goes through "governed SMTP" and §15 expects a maintained mailer
> library for it; owner item O5 left the provider open. This record resolves O5 and records why the
> transport is an HTTPS API instead of SMTP.
>
> **What it is not.** It creates no provider account, credential, DNS record or deployment, and it
> authorizes no production mail. Those are pre-deployment evidence (§7).

---

## 1. Decision

1. **Transport:** a transactional email provider's **HTTPS REST API**, called directly with PHP's
   bundled `curl` extension.
2. **Initial provider:** **Resend** (`POST https://api.resend.com/emails`).
3. **Boundary:** application and authentication code depend only on the provider-neutral
   `TamOs\Mail\MailTransport` interface. Exactly one class, `TamOs\Mail\ResendTransport`, knows
   the provider; it is the only production code allowed to perform network or mail I/O
   (`tools/verify-backend-boundary.js`).
4. **Delivery:** asynchronous, from a **database outbox** drained by a **cron-driven CLI worker**
   (`server/bin/mail.php`). No HTTP request ever talks to the provider.
5. **No dependency:** no SDK, no Composer package, no mailer library, no SMTP of any kind (including
   PHP `mail()` and the host's mailbox SMTP).
6. **Target sender:** `TAM OS <no-reply@reliabilityindonesia.com>` — a configuration value, not yet
   verified with the provider.

## 2. Why an HTTPS API, not SMTP

- SDR-0002 §15's concern is **hand-written SMTP**: TLS negotiation, authentication and header
  injection are easy to get wrong, which is why it expected a mailer library. An HTTPS JSON API
  removes the whole SMTP surface: one request, a JSON body built by `json_encode`, TLS verified by
  `curl`, no header lines composed by hand.
- It therefore needs **no Composer dependency** (SDR-0002 §15, `CLAUDE.md` §6.2). A mailer library
  would be the project's first runtime backend dependency, with its own supply-chain and update
  burden, to do what one HTTPS POST does.
- A provider API key can be **send-only and revocable** in isolation; a mailbox SMTP password is a
  login credential for a real mailbox on the same hosting account as the application and database
  (SDR-0002 §18).
- Transactional providers handle bounces, complaints and sender reputation; shared-hosting mail
  relays do not publish comparable guarantees.

## 3. Why an outbox and a worker

- **No enumeration by timing.** Sending inside the request would make a recovery request for a real
  account take the provider's latency (hundreds of milliseconds or more) while an unknown address
  answers at once. The request only writes delivery intent, so both paths do nearly the same
  database work (the residual is one INSERT, sub-millisecond; SDR-0002 §5 generic response).
- **No provider I/O in a transaction**, and provider failures never reach the requester.
- **Bounded retry.** A failed attempt is retried with backoff (1, 5, 15, 60 minutes; five attempts),
  then recorded as the `mail_fail` security event.
- **No secret at rest.** The outbox stores only the user, the kind of mail and its delivery state —
  never the address, the token, the link or the body. The worker issues a fresh token at send time,
  so the raw token exists only in the worker's memory and in the message.

## 4. Controls

| Control | Where |
|---|---|
| Provider code confined to one adapter; network and mail primitives nowhere else | `MailTransport`, `ResendTransport`, boundary rules |
| Only the documented contract is used: POST, Bearer key, JSON `{from, to, subject, text}`, `Idempotency-Key`, `200` + `id` = accepted; error bodies are never interpreted or logged | `ResendTransport`, `tests/Unit/ResendTransportTest.php` |
| TLS peer and host verification, HTTPS only, no redirects, 10-second timeout | `ResendTransport` |
| Plain-text mail; the link is `<configured origin>/#recovery=<token>` — origin from server configuration only, token in the fragment so no server, CDN, proxy or Referer sees it | `RecoveryMail` |
| One recovery link lives at a time; a failed attempt's token is revoked | `OutboxWorker`, `AccountTokenStore` |
| Outbox holds intent only; one writer | migration `0013`, `MailOutboxStore`, boundary rule |
| One worker at a time | `GET_LOCK('tamos_mail', 0)` |
| No token, link, address, key or provider response in logs, CLI output or events | `MailError` fixed codes, redacting `__debugInfo`, boundary rules |

## 5. Secrets

The API key is a secret under SDR-0002 §14. It lives only in the `mail` section of the configuration
file **outside the public web root** (`transport`, `from`, `api_key`), is validated only when the
worker needs it, and never appears in the repository, the frontend, the deployment package, a
migration, a log, a CLI output or an HTTP response. The boundary tool rejects a Resend-shaped key
anywhere under `server/`. Any exposure means immediate revocation at the provider and rotation
(`SECURITY.md`).

## 6. Consequences

- **Third-party processor.** The provider receives the recipient address and the one-time link for
  each recovery mail. No other personal or company data is sent. Whether this is acceptable under the
  company's data rules is part of the SDR-0002 §19 compliance gate owned by the owner.
- **Operational dependency.** Recovery mail depends on the provider's availability and on cron.
  Login, sessions and the rest of the API do not.
- **Portability.** Changing provider means one new `MailTransport` implementation and one
  configuration value; no application code changes.
- **Undetectable non-delivery.** A provider that accepts and then fails to deliver is not observed
  (no webhook in this scope); the user can request again.

## 7. Pre-deployment evidence (in addition to SDR-0002 §17)

| # | Evidence |
|---|---|
| M1 | Outbound HTTPS from the host to the provider API works, with a trusted CA bundle |
| M2 | The sender domain is verified with the provider; SPF, DKIM and DMARC are published, and it is recorded where the domain's DNS is managed |
| M3 | A delivery test to an owner-controlled mailbox, with fabricated content, succeeds |
| M4 | Cron can run `php server/bin/mail.php run` at a known interval; the interval is recorded |
| M5 | The provider key is send-only, stored only in the configuration file outside the web root (E1), and bounce/complaint handling is configured |
| M6 | `curl` and `openssl` are available to the PHP runtime (with E2) |

## 8. Revalidation triggers

A second mail kind beyond recovery; any provider change; any move to SMTP or to a mailer library;
sending mail containing business or personal data beyond an address and a link; a change of the
sender domain.
