
/* ---------- init ---------- */
(async function init(){
  await loadState();
  applyTheme();               // reconcile the early pre-paint theme with loaded settings
  installGlobalUIHandlers();
  render();
  maybeShowFirstRunChoice();
})();
