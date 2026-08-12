/* ============================================================
   TRANSPORT LAYER — TRANSPORT ADAPTER (PR-7A "The Transport")
   ------------------------------------------------------------
   The canonical application TRANSPORT boundary, immediately ABOVE the
   Application Gateway and the first operational Platform expansion of Milestone
   Delta. Every future transport (REST, CLI, background worker, AI agent / MCP,
   modern frontend, mobile) enters through here and reaches business behavior
   ONLY by delegating to the Application Gateway. It owns NO business behavior,
   NO persistence, NO rollback, NO history, and NO UI.

   Flow:  Browser
            ↓
          TransportAdapter        (this layer — canonical transport boundary)
            ↓
          ApplicationGateway      (the exclusive Platform boundary)
            ↓
          Domain → Aggregate → Handler → Persistence

   CONTRACT (delegates the canonical Platform contract; ATR-004 / SRD-062A):

     Request  — the canonical Gateway request, passed through UNCHANGED:
                { kind: 'command' | 'query', name, args: [ ... ], meta? }
                The Transport does NOT redefine Gateway request semantics.

     Response — the canonical Platform response, returned VERBATIM:
                { ok, kind, name, result?, error?: { source, code, message }, meta? }
                The Transport does NOT reinterpret business results and does NOT
                modify Domain responses.

   The Transport adds exactly ONE thing: a uniform, transport-level failure
   envelope for the two — and only two — outcomes it is permitted to classify:

     - INVALID_TRANSPORT_REQUEST → the call is not a usable request object.
                                   { ok:false, error.source:'transport' }.
                                   Never reaches the Gateway.
     - TRANSPORT_UNAVAILABLE     → the Application Gateway is not resolvable.
                                   { ok:false, error.source:'transport' }.

   All Platform and Domain outcomes (structural gateway rejections, business
   results, DOMAIN_FAULT) are returned EXACTLY as the Gateway produced them.
   `meta` is opaque and is carried by the Gateway; the Transport neither reads
   nor rewrites it.

   INVARIANTS (enforced by the verifier): the Transport is business-blind,
   stateless, deterministic (generates no ids/timestamps/randomness), and
   delegates SOLELY to ApplicationGateway — never to the Domain facade, an
   Aggregate, a Handler, or a Command/Query registry. The dependency is strictly
   one-way (Transport → Application Gateway → Domain); the Platform Layer never
   references the Transport Layer.

   DESIGN NOTE (FAA-PR7A): the Transport Layer INTENTIONALLY establishes the
   canonical transport boundary BEFORE any concrete transport implementation
   (REST, CLI, worker, AI/MCP, mobile) exists. This is a deliberate architectural
   design decision — the boundary is defined first so every future transport has a
   single, stable seam to delegate through — NOT dead code. It stays inert until a
   concrete transport is separately authorized to consume it.
   ============================================================ */

const TransportAdapter = (function () {
  // Resolve the single Platform boundary (top-level const, not on window). The
  // Transport loads AFTER application-gateway.js, so ApplicationGateway exists
  // at call time; the window fallback keeps it resolvable in any host.
  function resolveGateway() {
    if (typeof ApplicationGateway !== 'undefined') return ApplicationGateway;
    return (typeof window !== 'undefined') ? window.ApplicationGateway : null;
  }

  return Object.freeze({
    // The single application transport entry point. Structurally validates the
    // call, DELEGATES the canonical request to the Application Gateway, and
    // returns the canonical Platform response VERBATIM. It is async because the
    // Gateway is async (Domain command handlers return Promises); the Transport
    // AWAITS delegation so the resolved Platform envelope is what the caller
    // receives. Never bypasses the Gateway; owns no business behavior.
    execute: async function (request) {
      // TRANSPORT STRUCTURAL VALIDATION — only enough to hand off safely. The
      // Gateway owns request-FIELD validation (kind/name/args/meta); the
      // Transport rejects ONLY a call that is not a usable request object, so it
      // never redefines or duplicates Platform semantics.
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return { ok: false, error: { source: 'transport', code: 'INVALID_TRANSPORT_REQUEST', message: 'Transport request must be a plain object.' } };
      }
      var gateway = resolveGateway();
      if (!gateway || typeof gateway.execute !== 'function') {
        // TRANSPORT UNAVAILABLE — the Platform boundary is not reachable. Echo
        // the caller's own kind/name/meta for observability where safely available.
        var tu = { ok: false, error: { source: 'transport', code: 'TRANSPORT_UNAVAILABLE', message: 'Application Gateway is unavailable.' } };
        if (request.kind !== undefined) tu.kind = request.kind;
        if (request.name !== undefined) tu.name = request.name;
        if (request.meta !== undefined) tu.meta = request.meta;
        return tu;
      }
      // DELEGATE — the canonical request passes through UNCHANGED and the
      // canonical Platform response is returned VERBATIM. The Transport does not
      // read `result`, does not reinterpret a business outcome, and does not
      // rewrite the envelope. The Gateway already catches Domain faults, so its
      // fault/business/structural envelopes propagate through here unaltered.
      return await gateway.execute(request);
    }
  });
})();

// Expose on the global object so future transports resolve the single entry
// point by name. Classic shared global scope; no eval, no module system.
if (typeof window !== 'undefined') { window.TransportAdapter = TransportAdapter; }
