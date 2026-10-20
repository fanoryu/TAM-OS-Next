
/* ---------- init ---------- */
(async function init(){
  if(AUTH_MODE === AUTH_MODES.LOCAL){
    // AFI-5b (D-01) — LOCAL is development and testing only. Without a ready
    // development identity nothing local boots: one fixed notice, then stop.
    if(!localDevReady()){
      const mount = document.getElementById('app');
      if(mount) mount.textContent = 'Development identity not installed';
      return;
    }
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
