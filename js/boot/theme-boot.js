/* ============================================================
   THEME BOOT (Distribution-1) — js/boot/theme-boot.js
   ------------------------------------------------------------
   The pre-paint appearance script, moved VERBATIM out of index.html so the
   page carries no inline executable script (strict CSP: script-src 'self').
   It is NOT an application module and is NOT in tools/module-order.js: it
   loads synchronously at the top of <body>, before any content paints.
   ============================================================ */
/* Apply the saved appearance BEFORE first paint to avoid a theme flash (Part 15). */
(function(){
  try{
    var raw = localStorage.getItem('tam_settings_v1');
    var pref = 'system';
    if(raw){ var s = JSON.parse(raw); if(s && s.appearance) pref = s.appearance; }
    var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var eff = pref==='light' ? 'light' : pref==='dark' ? 'dark' : (sysDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = eff;
  }catch(e){ document.documentElement.dataset.theme = 'dark'; }
})();
