(function () {
  const root = document.documentElement;
  let selected = "dark";
  try {
    const saved = localStorage.getItem("snapshotter-theme");
    if (saved === "light" || saved === "dark") selected = saved;
  } catch { /* Theme switching works even when storage is unavailable. */ }
  root.dataset.theme = selected;
  function sync() {
    const dark = root.dataset.theme === "dark";
    const button = document.getElementById("theme-toggle");
    if (button) {
      button.setAttribute("aria-checked", String(dark));
      button.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a101b" : "#f5f7ff");
  }
  sync();
  document.addEventListener("DOMContentLoaded", () => {
    sync();
    document.getElementById("copyright-year").textContent = new Date().getFullYear();
    document.getElementById("theme-toggle").addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("snapshotter-theme", root.dataset.theme); } catch { /* Optional preference persistence. */ }
      sync();
    });
  });
})();
