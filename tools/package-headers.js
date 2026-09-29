/*
 * package-headers.js — TAM OS (Distribution-1)
 * -----------------------------------------------------------------
 * The single source of truth for the HTTP response headers the deployment
 * package expects in production (SDR-0002 §13, ADR-0004 §2.5). It is DATA:
 * tools/serve-package.js applies it locally, tools/verify-build.js asserts its
 * invariants, and docs/DEPLOYMENT.md points here instead of restating it.
 *
 * Nothing here configures Hostinger; applying these headers on the host is a
 * separate, authorized deployment step.
 */
'use strict';

// Content-Security-Policy, derived from the actual application:
//  - every script is a same-origin file (no inline script, no eval, no CDN);
//  - stylesheets are same-origin files; the UI still renders inline `style`
//    ATTRIBUTES (legacy templates), so ONLY style-src-attr allows them —
//    `<style>` elements and style URLs stay 'self' (style-src-elem falls back);
//  - fonts are base64 data: URIs inside css/fonts.css; the favicon is a data: PNG;
//  - the only network peer is this origin (the future same-origin /api/*).
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];
const CSP = CSP_DIRECTIVES.join('; ');

// Headers for every static package response.
const STATIC_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Package filenames are not content-hashed, so nothing may be cached as immutable:
  // every file (entry point included) is revalidated on each use.
  'Cache-Control': 'no-cache',
});

// Headers for every /api/* response (the backend is not implemented; the rule is fixed now).
const API_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store, private',
});

// Production-only: sent over HTTPS once HTTPS is stable on the hostname, starting short.
// No includeSubDomains / preload (SDR-0002 §13.1 — the apex site shares the domain).
const HSTS_PRODUCTION = 'max-age=31536000';

module.exports = { CSP, CSP_DIRECTIVES, STATIC_HEADERS, API_HEADERS, HSTS_PRODUCTION };
