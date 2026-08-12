/* ============================================================
   PLATFORM LAYER — APPLICATION GATEWAY (PR-6A "The Gateway")
   ------------------------------------------------------------
   The FIRST Platform Layer boundary and the beginning of Milestone Delta. It is
   the single, permanent application entry point that future platform integrations
   (REST, CLI, background workers, AI agents, MCP, modern frontends, mobile) call.
   It sits ABOVE the Domain facade and does exactly three things: normalize a
   platform request, DELEGATE it to the Domain, and return a uniform envelope. It
   owns NO business behavior.

   CANONICAL CONTRACT (ATR-004 approved; SRD-062A):

   Request envelope:
     { kind: 'command' | 'query',   // default 'command'
       name: '<domain operation id>',
       args: [ ...positional args ], // canonical positional carrier (default [])
       meta?: { ... }                // OPTIONAL, extensible, OPAQUE cross-cutting context
     }

   Response envelope (uniform, always returned):
     { ok: <gateway execution status only>,
       kind, name,
       result?: <Domain result VERBATIM>,   // present when ok:true
       error?:  { source, code, message },  // present when ok:false
       meta?:   <request meta, transported back> }

   Error classes:
     - Structural  → malformed/invalid request. { ok:false, error.source:'gateway' }.
                     Never reaches the Domain.
     - Business    → the Domain result is returned UNCHANGED under `result` with
                     ok:true. The Gateway NEVER reinterprets a business outcome.
     - Fault       → an unexpected Domain exception is CAUGHT at the boundary.
                     { ok:false, error.source:'domain', code:'DOMAIN_FAULT' }.
                     No unhandled exception escapes the Platform boundary.

   INVARIANTS (enforced by the verifier): the Gateway is business-blind, stateless,
   deterministic (it generates no ids/timestamps — that is a transport-adapter
   concern), and transport-agnostic. It never owns business rules, authorization,
   persistence, history, rollback, Aggregate routing, or a Command registry. It
   transports and MAY carry `meta` but NEVER interprets it.
   ============================================================ */

const ApplicationGateway = (function () {
  // Structural request normalization ONLY (no business validation). Returns a
  // canonical { ok, kind, name, args, meta } or a typed structural rejection code.
  function normalize(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, code: 'INVALID_REQUEST', message: 'Request must be a plain object.' };
    var kind = (request.kind == null) ? 'command' : String(request.kind);
    if (kind !== 'command' && kind !== 'query') return { ok: false, code: 'INVALID_KIND', message: 'kind must be "command" or "query".' };
    if (typeof request.name !== 'string' || request.name.trim() === '') return { ok: false, code: 'INVALID_NAME', message: 'name must be a non-empty string.' };
    var args = (request.args === undefined) ? [] : request.args;
    if (!Array.isArray(args)) return { ok: false, code: 'INVALID_ARGS', message: 'args must be an array.' };
    // meta is OPTIONAL and OPAQUE; when present it must be a plain object. The
    // Gateway validates only its shape — it never inspects meta contents.
    var meta = request.meta;
    if (meta !== undefined && (meta === null || typeof meta !== 'object' || Array.isArray(meta))) return { ok: false, code: 'INVALID_META', message: 'meta, when present, must be a plain object.' };
    return { ok: true, kind: kind, name: request.name.trim(), args: args, meta: meta };
  }

  // Resolve the Domain facade (top-level const, not on window). The Gateway loads
  // after domain-layer.js, so Domain exists at call time.
  function resolveDomain() {
    if (typeof Domain !== 'undefined') return Domain;
    return (typeof window !== 'undefined') ? window.Domain : null;
  }

  return Object.freeze({
    // The single application entry point. Normalizes, DELEGATES to the Domain, and
    // resolves to the uniform response envelope. It is async because Domain command
    // handlers are async (return Promises); the Gateway AWAITS delegation so that
    // `result` is the resolved Domain outcome (verbatim), `ok` reflects actual
    // completion, and both synchronous throws and async rejections are caught as a
    // fault — nothing escapes the Platform boundary. Never bypasses the Domain;
    // owns no business behavior.
    execute: async function (request) {
      var n = normalize(request);
      if (!n.ok) {
        // STRUCTURAL error — never reaches the Domain. Echo the caller's own
        // kind/name/meta for observability where safely available.
        var se = { ok: false, error: { source: 'gateway', code: n.code, message: n.message } };
        if (request && typeof request === 'object' && !Array.isArray(request)) {
          if (request.kind !== undefined) se.kind = request.kind;
          if (request.name !== undefined) se.name = request.name;
          if (request.meta !== undefined) se.meta = request.meta;
        }
        return se;
      }
      var domain = resolveDomain();
      if (!domain) {
        var du = { ok: false, kind: n.kind, name: n.name, error: { source: 'gateway', code: 'DOMAIN_UNAVAILABLE', message: 'Domain facade is unavailable.' } };
        if (n.meta !== undefined) du.meta = n.meta;
        return du;
      }
      try {
        // DELEGATE — never bypass. Await so an async handler's resolved value (or
        // rejection) is handled here; the Domain's typed result is returned VERBATIM.
        var result = (n.kind === 'command')
          ? await domain.command.apply(domain, [n.name].concat(n.args))
          : await domain.query.apply(domain, [n.name].concat(n.args));
        var ok = { ok: true, kind: n.kind, name: n.name, result: result };
        if (n.meta !== undefined) ok.meta = n.meta;   // transport meta back, verbatim (opaque)
        return ok;
      } catch (err) {
        // FAULT — an unexpected Domain exception (synchronous throw OR async
        // rejection) is caught at the boundary and enveloped so nothing escapes.
        var fe = { ok: false, kind: n.kind, name: n.name, error: { source: 'domain', code: 'DOMAIN_FAULT', message: (err && err.message) ? String(err.message) : 'Domain fault.' } };
        if (n.meta !== undefined) fe.meta = n.meta;
        return fe;
      }
    }
  });
})();

// Expose on the global object so future platform clients can resolve the single
// entry point by name. Classic shared global scope; no eval, no module system.
if (typeof window !== 'undefined') { window.ApplicationGateway = ApplicationGateway; }
