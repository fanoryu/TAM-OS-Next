
/* ---------- init ---------- */
(async function init(){
  if(AUTH_MODE === AUTH_MODES.LOCAL){
    await loadState();
    applyTheme();               // reconcile the early pre-paint theme with loaded settings
    installGlobalUIHandlers();
    render();
    maybeShowFirstRunChoice();
    return;
  }
  // AFI-2 — SESSION (or an invalid) mode: the session is checked FIRST and nothing
  // local is loaded — no business state, no migration, no first-run choice, no shell.
  // The theme stays as theme-boot.js applied it before paint.
  AuthBoot.start();
})();
