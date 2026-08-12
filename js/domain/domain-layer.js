/* ============================================================
   DOMAIN LAYER — READ-ONLY REGISTRY FACADE (Enterprise Foundation, PR-5A)
   ------------------------------------------------------------
   A thin, frozen, READ-ONLY view over the domain registries. Its only
   capabilities are (a) exposing the descriptive registries and (b)
   RESOLVING — not invoking — the existing handler for a registered
   command/query name.

   TRUTHFUL SCOPE (PR-5C.1 — First Operational Command Slice):
     - The registries are DESCRIPTIVE METADATA about the existing system.
     - `query(name, ...args)` routes ONE read-only query (`employee.filtered`,
       PR-5B): resolves and calls the existing read-only handler, returns its
       typed result unchanged; no mutation/persistence/audit.
     - `command(name, ...args)` routes ONE state-changing command
       (`employee.contact.update`, PR-5C.1): resolves and calls the existing
       handler EXACTLY ONCE and returns its typed outcome. The handler remains
       the implementation authority (its own validation, mutation, persistence,
       and audit). This facade adds NO aggregate enforcement and NO
       authorization — those are explicitly not operational.
     - There is NO legacy dispatch/ask surface. `commandHandler`/`queryHandler`
       only RESOLVE (return) a handler; they never invoke it.
     - Every other read/write still calls the existing functions directly; only
       the one migrated query and the one migrated command are routed here.

   `commandHandler(name)` / `queryHandler(name)` RETURN the existing global
   function (or null) so callers — and the verifier — can confirm every
   registered handler name resolves to a real function. They never call it.
   ============================================================ */

const Domain = (function () {
  // Resolve a handler by name from the shared global scope. Returns the
  // function itself (never invokes it) or null if it is not a function.
  function resolve(name) {
    var g = (typeof window !== 'undefined') ? window : this;
    var fn = g ? g[name] : undefined;
    return (typeof fn === 'function') ? fn : null;
  }

  return Object.freeze({
    // Descriptive registries (single source of truth for the domain map).
    aggregates: DOMAIN_AGGREGATES,
    invariants: DOMAIN_INVARIANTS,
    commands: DOMAIN_COMMANDS,
    queries: DOMAIN_QUERIES,
    events: DOMAIN_EVENTS,

    // Read-only handler resolution: returns the existing handler function
    // for a registered command/query name, or null. Does NOT execute it.
    commandHandler: function (name) {
      var c = DOMAIN_COMMANDS[name];
      return c ? resolve(c.handler) : null;
    },
    queryHandler: function (name) {
      var q = DOMAIN_QUERIES[name];
      return q ? resolve(q.handler) : null;
    },

    // Operational query routing (PR-5B). Resolves and calls the registered
    // READ-ONLY handler and returns its typed result unchanged. Throws
    // clearly on an unknown query or missing handler — never a silent no-op.
    query: function (name) {
      var q = DOMAIN_QUERIES[name];
      if (!q) throw new Error('Unknown domain query: ' + name);
      var fn = resolve(q.handler);
      if (!fn) throw new Error('Domain query handler not found: ' + q.handler);
      return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    },

    // Operational command routing (PR-5C.1 + PR-5D + PR-5E + PR-5G). Resolves the
    // registered handler and calls it EXACTLY ONCE, returning its typed outcome
    // unchanged. PR-5D: if the command declares a `boundary` aggregate, that
    // aggregate is the BUSINESS AUTHORITY — it runs first and either returns a
    // typed business failure (the handler is then NOT called) or the sanitized
    // input passed on to the handler. The handler remains the IMPLEMENTATION
    // AUTHORITY (its own validation, mutation, persistence, and audit).
    //
    // PR-5G: the aggregate's decision method and its sanitized-payload key are
    // declared per command (`boundaryMethod` / `boundaryPayload`), defaulting to
    // `prepare` / `patch` so the existing contact and employment commands route
    // exactly as before. Throws only on an unknown command / missing handler /
    // missing aggregate (programmer errors).
    command: function (name) {
      var c = DOMAIN_COMMANDS[name];
      if (!c) throw new Error('Unknown domain command: ' + name);
      var fn = resolve(c.handler);
      if (!fn) throw new Error('Domain command handler not found: ' + c.handler);
      var args = Array.prototype.slice.call(arguments, 1);
      if (c.boundary) {
        // Aggregates are top-level const objects exposed on the global object.
        var agg = (typeof window !== 'undefined') ? window[c.boundary] : null;
        var method = c.boundaryMethod || 'prepare';
        if (!agg || typeof agg[method] !== 'function') throw new Error('Aggregate not found: ' + c.boundary);
        var decision = agg[method](args[0], args[1]);   // business authority decides
        if (!decision || decision.ok !== true) {
          return { success: false, error: (decision && decision.error) || 'InvalidCommand' };
        }
        args = [args[0], decision[c.boundaryPayload || 'patch']];   // sanitized command input
      }
      return fn.apply(null, args);   // implementation authority mutates
    }
  });
})();
