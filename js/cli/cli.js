#!/usr/bin/env node
'use strict';
/* ============================================================
   CLI TRANSPORT (PR-8B "The CLI")
   ------------------------------------------------------------
   The FIRST non-browser ingress into TAM OS. It proves the canonical
   Platform contract is transport-agnostic: a CLI reaches the Domain through the
   SAME boundary the browser uses, with NO change to Domain, Aggregates, Handlers,
   Repository, Platform, or StorageAdapter.

   Path:
     CLI.execute(argv)
       -> TransportAdapter.execute({ kind, name, args, meta? })   (canonical contract)
          -> ApplicationGateway.execute()
             -> Domain.query()  ->  Aggregate/handler read path

   READ-ONLY (SPR-067): only the aggregate-backed query `employee.filtered` is
   permitted. No command execution, no writes, no persistence. The CLI delegates
   EXCLUSIVELY to TransportAdapter.execute — it never calls ApplicationGateway,
   Domain, an Aggregate, a Handler, the Repository, or persistence directly. It
   owns no business rules, no rollback, no history, and no UI.

   RESPONSE: the canonical Platform response is printed VERBATIM (business results
   are never unwrapped or reinterpreted). The CLI classifies ONLY its own two
   failure modes — INVALID_CLI_INVOCATION and INVALID_CLI_ARGUMENTS — under
   { ok:false, error:{ source:'cli', ... } }; all Platform responses are unchanged.

   RUNTIME LOADING: the app is classic shared-global-scope scripts (no modules).
   The CLI reproduces the browser's single-scope load by concatenating the
   tools/module-order.js files — EXCLUDING core/app-bootstrap.js, the only module
   that executes the DOM path at load — and running them once in a Node `vm`
   context, then delegating through the resulting TransportAdapter.

   DESIGN NOTE (FAA-PR8B) — THE LOADER IS AN IMPLEMENTATION DETAIL, NOT ARCHITECTURE:
   - The Node `vm` loader and the inert browser stubs (`window`/`document`/
     `localStorage` no-ops) below are implementation details of the CURRENT classic
     shared-global module architecture. They exist SOLELY because the browser
     modules use a classic shared-global `<script>` model with no explicit exports,
     so the CLI must recreate that single scope and satisfy a few defensive
     load-time DOM references.
   - They are NOT part of the Platform architecture and NOT part of the Transport
     contract. The stubs are never USED to render or to reach a real DOM — they are
     inert plumbing that lets the modules load in Node.
   - A future migration to an explicit module system (ESM/CommonJS or equivalent)
     removes this loader concern entirely — without changing Platform, Transport,
     Gateway, Domain, Repository, or business semantics. The canonical contract the
     CLI consumes (`TransportAdapter.execute`) is unaffected by how the runtime is
     loaded.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Read-only allowlist for this sprint: aggregate-backed queries only.
const CLI_ALLOWED_QUERIES = ['employee.filtered'];

const CLI = {
  // Parse argv into a canonical request (or a typed CLI-level rejection). No
  // alternate request schema: kind/name/args map straight to the Platform contract.
  parse(argv){
    const raw = argv.slice(2);
    let meta, seed; const pos = [];
    for(let i=0;i<raw.length;i++){
      if(raw[i]==='--meta'){ try{ meta = JSON.parse(raw[++i]); }catch(e){ return { cliError:'INVALID_CLI_ARGUMENTS', message:'--meta must be valid JSON.' }; } }
      else if(raw[i]==='--seed'){ seed = raw[++i]; }               // optional read-only in-memory fixture (no persistence)
      else pos.push(raw[i]);
    }
    const kind = pos[0], name = pos[1];
    if(!kind || !name) return { cliError:'INVALID_CLI_INVOCATION', message:'Usage: cli.js query <name> [args...] [--meta JSON] [--seed file.json]' };
    if(kind !== 'query') return { cliError:'INVALID_CLI_INVOCATION', message:'Read-only CLI: only "query" is supported (no commands / no writes).' };
    if(CLI_ALLOWED_QUERIES.indexOf(name) === -1) return { cliError:'INVALID_CLI_ARGUMENTS', message:'Query not permitted in the read-only CLI: '+name };
    const request = { kind: kind, name: name, args: pos.slice(2) };
    if(meta !== undefined) request.meta = meta;                    // opaque; transported back by the Gateway verbatim
    return { request: request, seed: seed };
  },

  // Reproduce the browser's single shared global scope in a Node vm context,
  // EXCLUDING core/app-bootstrap.js (the only DOM-executing load-time module).
  // Returns the runtime handles the CLI needs (TransportAdapter + State).
  loadRuntime(){
    const root = path.resolve(__dirname, '..', '..');
    const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
    // Append an export shim: TransportAdapter/State are top-level `const` (not on
    // the global), so reference them by identifier (in scope) and hang them on the
    // global for retrieval. Function-declaration handlers (e.g. employeesFiltered)
    // DO attach to the global, so the Domain's window[handlerName] resolution works.
    const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
      + '\n;window.__TAM__ = { TransportAdapter: TransportAdapter, State: State };';
    // Inert browser stubs. The classic scripts register a few defensive top-level
    // DOM listeners at load (e.g. supplemental-engine.js); none run on the read
    // path. `window` IS the vm global (self-referential) so the Domain can resolve
    // handlers via window[name]. Storage is a memory shim — never exercised by a
    // read-only query (no persistence).
    const noop = function(){};
    const memStore = {}; const memStorage = { getItem:(k)=>Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null, setItem:(k,v)=>{memStore[k]=String(v);}, removeItem:(k)=>{delete memStore[k];} };
    const sandbox = {
      console: console, navigator: { userAgent:'tam-cli' }, setTimeout: setTimeout, clearTimeout: clearTimeout,
      localStorage: memStorage, storage: undefined,
      addEventListener: noop, removeEventListener: noop,
      matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
      document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({ style:{}, dataset:{}, addEventListener:noop, appendChild:noop, setAttribute:noop }), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
    };
    sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;  // window === the vm global
    const context = vm.createContext(sandbox);
    vm.runInContext(src, context, { filename: 'tam-cli-runtime.js' });
    return sandbox.__TAM__;
  },

  // The single CLI entry point: parse, DELEGATE through the Transport, return the
  // canonical response verbatim (or a typed CLI-level rejection before delegation).
  async execute(argv){
    const parsed = this.parse(argv);
    if(parsed.cliError){
      // CLI-level classification ONLY — never a Platform response.
      return { ok:false, error:{ source:'cli', code:parsed.cliError, message:parsed.message } };
    }
    const rt = this.loadRuntime();
    if(parsed.seed){
      // Optional read-only fixture: seed the in-memory collection so a query can
      // return real rows. This is NOT persistence — nothing is written to storage.
      try{ rt.State.employees = JSON.parse(fs.readFileSync(parsed.seed,'utf8')); }
      catch(e){ return { ok:false, error:{ source:'cli', code:'INVALID_CLI_ARGUMENTS', message:'--seed file could not be read/parsed.' } }; }
    }
    // DELEGATE exclusively through the Transport Adapter; return the canonical
    // Platform response VERBATIM (no unwrapping, no reinterpretation).
    return await rt.TransportAdapter.execute(parsed.request);
  }
};

if (require.main === module) {
  CLI.execute(process.argv).then(res => {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    process.exit(res && res.ok === true ? 0 : 1);
  }).catch(err => {
    process.stdout.write(JSON.stringify({ ok:false, error:{ source:'cli', code:'CLI_FAULT', message:String(err && err.message || err) } }, null, 2) + '\n');
    process.exit(1);
  });
}

module.exports = CLI;
