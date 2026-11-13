// Applies the theme saved by the last visit before the app loads, so the page never
// flashes the default look first. A separate file rather than an inline script so the
// server's Content-Security-Policy (script-src 'self') allows it. Written by applyTheme
// in client/src/context/ThemeContext.tsx; keep the two in step.
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('wrkbench.theme') || 'null');
    if (!saved || typeof saved !== 'object') return;
    var dark = saved.mode === 'dark' || (saved.mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    if (saved.mode === 'light' || saved.mode === 'dark') root.setAttribute('data-theme', saved.mode);
    var vars = (dark ? saved.dark : saved.light) || {};
    for (var name in vars) {
      if (name.indexOf('--color-') === 0) root.style.setProperty(name, vars[name]);
    }
  } catch (e) {
    /* storage unavailable or unreadable: the default theme applies */
  }
})();
